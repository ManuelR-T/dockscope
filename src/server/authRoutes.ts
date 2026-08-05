import type { Express, NextFunction, Request, Response } from 'express';
import {
  AttemptLimiter,
  AuthConfig,
  MIN_TOKEN_LENGTH,
  ProxyAuthConfig,
  SessionStore,
  SESSION_COOKIE,
  VerifiedTokenCache,
  buildSessionCookie,
  canSetToken,
  clearedSessionCookie,
  isAuthorized,
  isPublicApiPath,
  parseCookies,
  proxyAuthenticatedUser,
  setupAvailability,
  tokenIsValid,
} from './auth.js';
import { AuthStore } from './authStore.js';

/** Slows online guessing without needing any state about who is guessing. */
const FAILED_ATTEMPT_DELAY_MS = 250;

function wantsSecureCookie(req: Request): boolean {
  // Behind a reverse proxy the hop to us is plain HTTP, so trust the forwarded
  // scheme; marking the cookie Secure over plain HTTP would silently break it.
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  return req.protocol === 'https' || forwarded === 'https';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AuthRuntime {
  /** Current config, replaced in place when setup completes. */
  current(): AuthConfig;
  proxy: ProxyAuthConfig;
  sessions: SessionStore;
  verified: VerifiedTokenCache;
  attempts: AttemptLimiter;
}

export function createAuthRuntime(
  initial: AuthConfig,
  proxy: ProxyAuthConfig = { enabled: false, header: '', trustedProxies: [] },
): AuthRuntime & { set(next: AuthConfig): void } {
  let config = initial;
  return {
    current: () => config,
    set(next: AuthConfig) {
      config = next;
    },
    proxy,
    sessions: new SessionStore(),
    verified: new VerifiedTokenCache(),
    attempts: new AttemptLimiter(),
  };
}

export function setupAuth(
  app: Express,
  runtime: ReturnType<typeof createAuthRuntime>,
  store: AuthStore,
  startedAt: number = Date.now(),
): void {
  const authorized = (req: Request): boolean =>
    isAuthorized({
      config: runtime.current(),
      sessions: runtime.sessions,
      cookieHeader: req.headers.cookie,
      authorization: req.headers.authorization,
      verified: runtime.verified,
      proxy: runtime.proxy,
      headers: req.headers,
      remoteAddress: req.socket.remoteAddress ?? undefined,
    });

  /** Guessing is rate limited per source, since a shared secret has no account to lock. */
  const attemptKey = (req: Request): string => req.socket.remoteAddress ?? 'unknown';

  const issueSession = (req: Request, res: Response) => {
    const id = runtime.sessions.create();
    res.setHeader('Set-Cookie', buildSessionCookie(id, { secure: wantsSecureCookie(req) }));
  };

  const availability = async (req: Request) =>
    setupAvailability({
      config: runtime.current(),
      declined: (await store.read()).declined === true,
      remoteAddress: req.socket.remoteAddress ?? undefined,
      uptimeMs: Date.now() - startedAt,
      proxyEnabled: runtime.proxy.enabled,
    });

  /**
   * The one shape every auth endpoint answers with, complete on every route, so
   * the client never has to fill a missing field with a default.
   */
  const statusPayload = async (req: Request, override?: { authenticated: boolean }) => {
    const config = runtime.current();
    const viaProxy = Boolean(
      runtime.proxy.enabled &&
      proxyAuthenticatedUser({
        config: runtime.proxy,
        headers: req.headers,
        remoteAddress: req.socket.remoteAddress ?? undefined,
      }),
    );
    return {
      // A proxy in front means credentials are needed even with no token set.
      required: config.enabled || runtime.proxy.enabled,
      // A session issued by this very response is not on the request yet, so a
      // route that just signed someone in has to say so itself.
      authenticated: override?.authenticated ?? authorized(req),
      managedByEnv: config.source === 'env',
      // A proxy already handled the login, so the dashboard must not offer a
      // token prompt on top of it.
      viaProxy,
      setup: viaProxy ? ('configured' as const) : await availability(req),
      minTokenLength: MIN_TOKEN_LENGTH,
    };
  };

  // Doubles as an unauthenticated liveness probe: it answers 200 whenever the
  // server is up, while revealing nothing beyond how it is configured.
  app.get('/api/auth', (req: Request, res: Response) => {
    void (async () => {
      res.json(await statusPayload(req));
    })();
  });

  /**
   * Set the access token, either claiming an unconfigured instance or changing
   * the one already in place.
   *
   * Two different gates, because the two cases are different: an unclaimed
   * instance is protected by the setup window, while changing an existing token
   * simply requires already holding it.
   */
  app.post('/api/auth/setup', (req: Request, res: Response) => {
    void (async () => {
      const config = runtime.current();

      if (config.source === 'env') {
        res.status(409).json({
          error: 'The token is pinned by DOCKSCOPE_TOKEN and cannot be changed from here.',
        });
        return;
      }

      if (config.enabled) {
        if (!authorized(req)) {
          res.status(401).json({ error: 'Authentication required' });
          return;
        }
      } else {
        const state = await availability(req);
        if (!canSetToken(state)) {
          res.status(409).json({
            error:
              state === 'window-closed'
                ? 'The setup window has closed. Restart DockScope, or set DOCKSCOPE_TOKEN.'
                : 'Authentication is already handled for this instance.',
            setup: state,
          });
          return;
        }
      }

      const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      if (token.length < MIN_TOKEN_LENGTH) {
        res.status(400).json({
          error: `Choose a token of at least ${MIN_TOKEN_LENGTH} characters.`,
        });
        return;
      }

      const stored = await store.setToken(token);
      runtime.verified.clear();
      // Anyone holding a session issued under the previous token loses it. A
      // rotation is usually a response to that token being exposed, so letting
      // the old sessions keep working would defeat the point.
      runtime.sessions.revokeAll();
      runtime.set({ enabled: true, token: '', stored, source: 'file' });
      // Sign the person who just set it up straight in, so enabling auth never
      // locks them out of the page they are looking at.
      issueSession(req, res);
      res.json(await statusPayload(req, { authenticated: true }));
    })();
  });

  /** Remove the token, returning the instance to an open state. */
  app.delete('/api/auth/token', (req: Request, res: Response) => {
    void (async () => {
      const config = runtime.current();
      if (config.source === 'env') {
        res.status(409).json({
          error: 'The token is pinned by DOCKSCOPE_TOKEN and cannot be removed from here.',
        });
        return;
      }
      // Only someone who currently holds the token may give it up.
      if (config.enabled && !authorized(req)) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      await store.clearToken();
      runtime.verified.clear();
      runtime.sessions.revokeAll();
      runtime.set({ enabled: false, token: '', source: 'none' });
      res.setHeader('Set-Cookie', clearedSessionCookie());
      res.json(await statusPayload(req));
    })();
  });

  /**
   * Whether to keep offering the setup screen on this instance. The flag is
   * reversible: the security panel can turn the reminder back on.
   */
  app.post('/api/auth/reminder', (req: Request, res: Response) => {
    void (async () => {
      const config = runtime.current();
      if (config.enabled && !authorized(req)) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const declined = req.body?.declined === true;
      await store.setDeclined(declined);
      res.json(await statusPayload(req));
    })();
  });

  app.post('/api/auth/session', (req: Request, res: Response) => {
    void (async () => {
      const config = runtime.current();
      if (!config.enabled) {
        res.json(await statusPayload(req));
        return;
      }

      const key = attemptKey(req);
      const retryAfter = runtime.attempts.retryAfterMs(key);
      if (retryAfter > 0) {
        const seconds = Math.ceil(retryAfter / 1000);
        res.setHeader('Retry-After', String(seconds));
        res
          .status(429)
          .json({ error: `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).` });
        return;
      }

      const supplied = typeof req.body?.token === 'string' ? req.body.token : '';
      if (!supplied || !tokenIsValid(supplied, config)) {
        runtime.attempts.recordFailure(key);
        await sleep(FAILED_ATTEMPT_DELAY_MS);
        res.status(401).json({ error: 'Invalid token' });
        return;
      }

      runtime.attempts.recordSuccess(key);
      issueSession(req, res);
      res.json(await statusPayload(req, { authenticated: true }));
    })();
  });

  app.delete('/api/auth/session', (req: Request, res: Response) => {
    void (async () => {
      runtime.sessions.revoke(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
      res.setHeader('Set-Cookie', clearedSessionCookie());
      // Computed after the revoke, so `authenticated` reflects the sign-out:
      // the cookie header is still on the request.
      res.json(await statusPayload(req));
    })();
  });

  // Everything else under /api needs credentials. Registered after the routes
  // above so those stay reachable, and before the API routes so it guards them.
  //
  // The gate is open only when nothing is configured at all. A proxy counts as
  // configured even with no token, so a request that went around it is still
  // refused.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const gated = runtime.current().enabled || runtime.proxy.enabled;
    if (!gated || isPublicApiPath(req.path) || authorized(req)) {
      next();
      return;
    }
    res.status(401).json({ error: 'Authentication required' });
  });
}
