// Optional access control for exposed instances.
//
// DockScope drives a Docker daemon and, through plugins, whole Kubernetes
// clusters: the API can exec into a container or a pod, delete workloads and
// read environment variables. The origin checks in `origin.ts` stop a random
// web page from doing that, but they do nothing against anything that can open
// a socket to the port -- curl, a script, another host on the LAN.
//
// An access token turns on a shared-secret gate in front of the API and the
// WebSocket. It is off by default so the local-only workflow keeps working with
// no configuration, and can be set either through `DOCKSCOPE_TOKEN` or through
// the first-run setup screen (see `authStore.ts`).

import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'dockscope_session';

/**
 * How long an instance reachable over the network can still be claimed through
 * the first-run setup screen.
 *
 * While no token is set, whoever reaches an exposed instance first could set
 * one and lock the owner out. Bounding the window to shortly after startup
 * means an instance left running for weeks cannot be claimed by a passer-by,
 * while the person who just started it has time to walk over to a browser.
 * Requests from the same machine are never subject to it.
 */
export const NETWORK_SETUP_WINDOW_MS = 15 * 60 * 1000;

/** How long a browser session stays valid before the token is asked for again. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Tokens shorter than this are too weak to survive being exposed. */
export const MIN_TOKEN_LENGTH = 16;

/** A token hashed for storage on disk. */
export interface StoredToken {
  salt: string;
  hash: string;
}

export interface AuthConfig {
  enabled: boolean;
  /** Plain token, only ever from the environment. */
  token: string;
  /** Hashed token loaded from the state file. */
  stored?: StoredToken;
  /**
   * Where the token came from. `env` is immutable at runtime; `file` was set
   * through the setup screen and can be changed there.
   */
  source: 'env' | 'file' | 'none';
}

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const token = (env.DOCKSCOPE_TOKEN ?? '').trim();
  return token
    ? { enabled: true, token, source: 'env' }
    : { enabled: false, token: '', source: 'none' };
}

const SCRYPT_KEY_LENGTH = 32;

/**
 * Hash a token for storage. Tokens land in a file on disk, so a stolen file
 * should not hand over the token itself; scrypt also keeps a weak,
 * human-chosen token from falling to a quick dictionary run.
 */
export function hashToken(token: string, salt = randomBytes(16).toString('hex')): StoredToken {
  return { salt, hash: scryptSync(token, salt, SCRYPT_KEY_LENGTH).toString('hex') };
}

export function tokenMatchesStored(token: string, stored: StoredToken): boolean {
  let candidate: Buffer;
  try {
    candidate = scryptSync(token, stored.salt, SCRYPT_KEY_LENGTH);
  } catch {
    return false;
  }
  const expected = Buffer.from(stored.hash, 'hex');
  if (expected.length !== candidate.length) {
    return false;
  }
  return timingSafeEqual(candidate, expected);
}

/** Whether a supplied token satisfies whichever source is configured. */
export function tokenIsValid(token: string, config: AuthConfig): boolean {
  if (config.source === 'env') {
    return secretsMatch(token, config.token);
  }
  return config.stored ? tokenMatchesStored(token, config.stored) : false;
}

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * `timingSafeEqual` throws on length mismatch, and comparing lengths first
 * would itself leak the token's length, so both sides are hashed to a fixed
 * width before the comparison.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

/** Parse a `Cookie` header. Values are percent-decoded; malformed pairs are skipped. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    if (!name) {
      continue;
    }
    const raw = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

/**
 * The bearer token on a request, if it carries one. Non-browser clients (the
 * CLI, curl, CI) authenticate this way instead of holding a session.
 */
export function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const match = /^Bearer[ ]+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || undefined;
}

export function buildSessionCookie(
  id: string,
  options: { secure: boolean; maxAgeMs?: number } = { secure: false },
): string {
  const maxAge = Math.floor((options.maxAgeMs ?? SESSION_TTL_MS) / 1000);
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(id)}`,
    'Path=/',
    // The session id is never read by page scripts, so keep it away from XSS.
    'HttpOnly',
    // Belt and braces with the origin checks: the browser will not attach this
    // to requests initiated by another site at all.
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/**
 * Browser sessions issued after a successful token exchange.
 *
 * Held in memory on purpose: a restart invalidates every session, which is the
 * behaviour you want from a debugging tool, and it keeps the real token out of
 * browser storage entirely.
 */
export class SessionStore {
  private readonly sessions = new Map<string, number>();

  constructor(
    private readonly ttlMs = SESSION_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  create(): string {
    // Sessions were only dropped when the same id came back to be verified, so
    // a browser closed without signing out left one behind until restart.
    this.prune();
    const id = randomUUID();
    this.sessions.set(id, this.now() + this.ttlMs);
    return id;
  }

  private prune(): void {
    const now = this.now();
    for (const [id, expiry] of this.sessions) {
      if (expiry <= now) {
        this.sessions.delete(id);
      }
    }
  }

  verify(id: string | undefined): boolean {
    if (!id) {
      return false;
    }
    const expiry = this.sessions.get(id);
    if (expiry === undefined) {
      return false;
    }
    if (expiry <= this.now()) {
      this.sessions.delete(id);
      return false;
    }
    return true;
  }

  revoke(id: string | undefined): void {
    if (id) {
      this.sessions.delete(id);
    }
  }

  /**
   * Drop every session.
   *
   * Sessions are checked by id alone, so they outlive the token they were
   * issued under unless they are cleared explicitly. Rotating a token is
   * normally a response to it being exposed, and leaving the old sessions
   * working would make that rotation worthless.
   */
  revokeAll(): void {
    this.sessions.clear();
  }

  get size(): number {
    return this.sessions.size;
  }
}

/**
 * Remembers tokens that already verified, so a script polling with a bearer
 * header does not pay for scrypt on every request. Only ever holds values that
 * were proven correct, and is dropped when the process exits.
 */
export class VerifiedTokenCache {
  private readonly accepted = new Set<string>();

  private key(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  has(token: string): boolean {
    return this.accepted.has(this.key(token));
  }

  remember(token: string): void {
    this.accepted.add(this.key(token));
  }

  clear(): void {
    this.accepted.clear();
  }
}

/**
 * Whether a request carries valid credentials: either a session cookie issued
 * after a token exchange, or the token itself as a bearer header.
 */
export function isAuthorized(params: {
  config: AuthConfig;
  sessions: SessionStore;
  cookieHeader?: string | undefined;
  authorization?: string | undefined;
  verified?: VerifiedTokenCache;
  proxy?: ProxyAuthConfig;
  headers?: Record<string, string | string[] | undefined>;
  remoteAddress?: string | undefined;
}): boolean {
  const { config, sessions, cookieHeader, authorization, verified, proxy, headers } = params;

  if (proxy?.enabled) {
    // An identity proxy in front has already authenticated the user, and is the
    // preferred arrangement, so it is honoured whether or not a token is set.
    if (
      proxyAuthenticatedUser({
        config: proxy,
        headers: headers ?? {},
        remoteAddress: params.remoteAddress,
      })
    ) {
      return true;
    }
    // Configuring a proxy declares that authentication is required. Without
    // this, a request that went around the proxy straight to the port would be
    // waved through whenever no token happened to be set.
    if (!config.enabled) {
      return false;
    }
  } else if (!config.enabled) {
    return true;
  }

  // Sessions first: it is the common path and the cheapest.
  if (sessions.verify(parseCookies(cookieHeader)[SESSION_COOKIE])) {
    return true;
  }

  const bearer = bearerToken(authorization);
  if (!bearer) {
    return false;
  }
  if (verified?.has(bearer)) {
    return true;
  }
  if (tokenIsValid(bearer, config)) {
    verified?.remember(bearer);
    return true;
  }
  return false;
}

/**
 * Paths served without credentials. The UI bundle has to load before it can
 * ask for a token, and the token exchange itself obviously cannot require one.
 */
export function isPublicApiPath(path: string): boolean {
  // `/auth/setup` and `/auth/reminder` authorise themselves: both are reachable
  // on an unclaimed instance and require credentials on a configured one.
  return (
    path === '/auth' ||
    path === '/auth/session' ||
    path === '/auth/setup' ||
    path === '/auth/reminder'
  );
}

/** Whether a socket address belongs to the machine DockScope runs on. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  // Node reports IPv4 peers on a dual-stack socket as ::ffff:127.0.0.1.
  const normalized = address.replace(/^::ffff:/i, '').toLowerCase();
  return normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

export type SetupAvailability = 'available' | 'configured' | 'declined' | 'window-closed';

/**
 * Whether first-run setup may still be offered.
 *
 * From the machine itself there is no hurry: only someone with local access can
 * reach it. From the network the window closes shortly after startup so an
 * instance left running cannot be claimed later by whoever finds it.
 */
export function setupAvailability(params: {
  config: AuthConfig;
  declined: boolean;
  remoteAddress: string | undefined;
  uptimeMs: number;
  windowMs?: number;
  proxyEnabled?: boolean;
}): SetupAvailability {
  const {
    config,
    declined,
    remoteAddress,
    uptimeMs,
    windowMs = NETWORK_SETUP_WINDOW_MS,
    proxyEnabled = false,
  } = params;
  // A proxy is already handling authentication, so there is nothing to claim
  // and no prompt to show.
  if (config.enabled || proxyEnabled) {
    return 'configured';
  }
  // The window is checked before the reminder, because the two answer different
  // questions: the window decides whether a token may be set at all, while
  // declining only silences the prompt. Checking `declined` first would let a
  // remote caller past a closed window.
  if (!isLoopbackAddress(remoteAddress) && uptimeMs > windowMs) {
    return 'window-closed';
  }
  return declined ? 'declined' : 'available';
}

/**
 * Whether a token may be set right now.
 *
 * Declining the reminder hides the first-run screen but must not prevent
 * setting a token later from the security panel: that was exactly the dead end
 * the reminder used to create.
 */
export function canSetToken(state: SetupAvailability): boolean {
  return state === 'available' || state === 'declined';
}

/**
 * Whether exposing this instance without a token deserves a warning: binding
 * anything other than loopback puts the API on the network. The published
 * Docker image sets `DOCKSCOPE_BIND=0.0.0.0`, so containers hit this by default.
 */
export function isExposedWithoutAuth(bind: string, config: AuthConfig): boolean {
  if (config.enabled) {
    return false;
  }
  const address = bind.trim().toLowerCase();
  return address !== '127.0.0.1' && address !== 'localhost' && address !== '::1';
}

/** Only the environment token is visible in plain text, so only it can be judged. */
export function tokenIsWeak(config: AuthConfig): boolean {
  return config.source === 'env' && config.token.length < MIN_TOKEN_LENGTH;
}

// --- Reverse-proxy authentication -------------------------------------------
//
// The usual way to put a homelab dashboard behind real accounts is an identity
// proxy: Authelia, Authentik, oauth2-proxy or Cloudflare Access terminate the
// login and pass the resulting user down in a header. Honouring that header
// lets DockScope inherit an existing SSO setup instead of asking people to
// manage a second, weaker secret.

export interface ProxyAuthConfig {
  enabled: boolean;
  header: string;
  trustedProxies: string[];
}

export function readProxyAuthConfig(env: NodeJS.ProcessEnv): ProxyAuthConfig {
  const header = (env.DOCKSCOPE_AUTH_PROXY_HEADER ?? '').trim().toLowerCase();
  const trustedProxies = (env.DOCKSCOPE_TRUSTED_PROXIES ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  // Both halves are required. A header with no trusted source would let anyone
  // who can reach the port set it themselves and walk straight in.
  return { enabled: header.length > 0 && trustedProxies.length > 0, header, trustedProxies };
}

function ipv4ToInt(address: string): number | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) {
    return undefined;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return undefined;
    }
    const octet = Number(part);
    if (octet > 255) {
      return undefined;
    }
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/** Normalise the mapped form Node reports for IPv4 peers on a dual-stack socket. */
function normalizeAddress(address: string): string {
  return address.replace(/^::ffff:/i, '').toLowerCase();
}

/** Whether an address matches a literal address or an IPv4 CIDR range. */
export function addressMatches(address: string | undefined, pattern: string): boolean {
  if (!address) {
    return false;
  }
  const peer = normalizeAddress(address);
  const target = normalizeAddress(pattern.trim());

  const slash = target.indexOf('/');
  if (slash === -1) {
    return peer === target;
  }

  const bits = Number(target.slice(slash + 1));
  const network = ipv4ToInt(target.slice(0, slash));
  const candidate = ipv4ToInt(peer);
  if (network === undefined || candidate === undefined || !Number.isInteger(bits)) {
    return false;
  }
  if (bits < 0 || bits > 32) {
    return false;
  }
  if (bits === 0) {
    return true;
  }
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (network & mask) === (candidate & mask);
}

export function isTrustedProxy(address: string | undefined, config: ProxyAuthConfig): boolean {
  return config.trustedProxies.some((pattern) => addressMatches(address, pattern));
}

/**
 * The user a trusted proxy has already authenticated, if any.
 *
 * The header is only believed when the connection itself came from a declared
 * proxy: otherwise it is just an attacker-supplied string.
 */
export function proxyAuthenticatedUser(params: {
  config: ProxyAuthConfig;
  headers: Record<string, string | string[] | undefined>;
  remoteAddress: string | undefined;
}): string | undefined {
  const { config, headers, remoteAddress } = params;
  if (!config.enabled || !isTrustedProxy(remoteAddress, config)) {
    return undefined;
  }
  const raw = headers[config.header];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const user = value?.trim();
  return user ? user : undefined;
}

// --- Brute-force throttling --------------------------------------------------

export const MAX_FAILED_ATTEMPTS = 10;
export const LOCKOUT_MS = 5 * 60 * 1000;

/**
 * Per-source failure counter for the token endpoints.
 *
 * A shared secret has no account to lock, so the limit is applied to whoever is
 * guessing. Successful authentication clears the count, so a legitimate user
 * who mistypes a few times is not punished for long.
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly maxAttempts = MAX_FAILED_ATTEMPTS,
    private readonly lockoutMs = LOCKOUT_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Milliseconds left before this source may try again, or 0 when allowed. */
  retryAfterMs(key: string): number {
    const entry = this.failures.get(key);
    if (!entry || entry.count < this.maxAttempts) {
      return 0;
    }
    const remaining = entry.until - this.now();
    if (remaining <= 0) {
      this.failures.delete(key);
      return 0;
    }
    return remaining;
  }

  recordFailure(key: string): void {
    const entry = this.failures.get(key) ?? { count: 0, until: 0 };
    entry.count += 1;
    entry.until = this.now() + this.lockoutMs;
    this.failures.set(key, entry);
    this.prune();
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }

  /**
   * Drop expired counters.
   *
   * Entries are keyed by source address and were only ever removed when that
   * same address came back, so a scan from many addresses left one entry each,
   * for the life of the process. Pruning on write keeps that bounded without a
   * timer.
   */
  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.failures) {
      if (entry.until <= now) {
        this.failures.delete(key);
      }
    }
  }

  get size(): number {
    return this.failures.size;
  }
}
