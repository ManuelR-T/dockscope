import { describe, expect, it } from 'vitest';
import {
  AttemptLimiter,
  MIN_TOKEN_LENGTH,
  NETWORK_SETUP_WINDOW_MS,
  addressMatches,
  proxyAuthenticatedUser,
  readProxyAuthConfig,
  SESSION_COOKIE,
  SessionStore,
  VerifiedTokenCache,
  bearerToken,
  buildSessionCookie,
  hashToken,
  isAuthorized,
  isExposedWithoutAuth,
  isLoopbackAddress,
  isPublicApiPath,
  parseCookies,
  readAuthConfig,
  secretsMatch,
  setupAvailability,
  tokenIsWeak,
  tokenMatchesStored,
  type AuthConfig,
} from '../auth';

const TOKEN = 'a-sufficiently-long-token';

function config(token = TOKEN) {
  return readAuthConfig({ DOCKSCOPE_TOKEN: token } as NodeJS.ProcessEnv);
}

/** A token that came from the setup screen, so only its hash is known. */
function storedConfig(token = TOKEN): AuthConfig {
  return { enabled: true, token: '', stored: hashToken(token), source: 'file' };
}

describe('readAuthConfig', () => {
  it('is disabled when no token is set', () => {
    expect(readAuthConfig({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      token: '',
      source: 'none',
    });
  });

  it.each(['', '   '])('treats %o as no token at all', (value) => {
    expect(readAuthConfig({ DOCKSCOPE_TOKEN: value } as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  it('enables auth when a token is set', () => {
    expect(config()).toEqual({ enabled: true, token: TOKEN, source: 'env' });
  });
});

describe('secretsMatch', () => {
  it('accepts an identical secret', () => {
    expect(secretsMatch(TOKEN, TOKEN)).toBe(true);
  });

  // Hashing before comparing is what lets differing lengths be compared at all:
  // timingSafeEqual throws on a length mismatch.
  it.each([['wrong'], [`${TOKEN} `], [TOKEN.slice(0, -1)], [`${TOKEN}x`], ['']])(
    'rejects %o',
    (candidate) => {
      expect(secretsMatch(candidate, TOKEN)).toBe(false);
    },
  );
});

describe('parseCookies', () => {
  it('reads a single cookie', () => {
    expect(parseCookies('dockscope_session=abc')).toEqual({ dockscope_session: 'abc' });
  });

  it('reads several and trims the padding', () => {
    expect(parseCookies('a=1; b=2;  c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('percent-decodes values', () => {
    expect(parseCookies('x=a%20b')).toEqual({ x: 'a b' });
  });

  it('keeps a value that is not valid percent-encoding rather than throwing', () => {
    expect(parseCookies('x=100%')).toEqual({ x: '100%' });
  });

  it.each([undefined, '', 'nonsense', '=novalue'])('survives the header %o', (header) => {
    expect(() => parseCookies(header)).not.toThrow();
  });

  it('keeps an equals sign inside the value', () => {
    expect(parseCookies('x=a=b')).toEqual({ x: 'a=b' });
  });
});

describe('bearerToken', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['Bearer   abc  ', 'abc'],
  ])('reads %o', (header, expected) => {
    expect(bearerToken(header)).toBe(expected);
  });

  it.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer   '])('ignores %o', (header) => {
    expect(bearerToken(header)).toBeUndefined();
  });
});

describe('buildSessionCookie', () => {
  it('is HttpOnly and SameSite=Strict so no other site can send it', () => {
    const cookie = buildSessionCookie('abc', { secure: false });
    expect(cookie).toContain(`${SESSION_COOKIE}=abc`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
  });

  // Marking it Secure over plain HTTP would stop the browser sending it at all.
  it('only adds Secure when the connection is HTTPS', () => {
    expect(buildSessionCookie('abc', { secure: false })).not.toContain('Secure');
    expect(buildSessionCookie('abc', { secure: true })).toContain('Secure');
  });
});

describe('SessionStore', () => {
  it('accepts a session it issued', () => {
    const store = new SessionStore();
    expect(store.verify(store.create())).toBe(true);
  });

  it('issues a distinct id each time', () => {
    const store = new SessionStore();
    expect(store.create()).not.toBe(store.create());
  });

  it.each([undefined, '', 'not-a-session'])('rejects %o', (id) => {
    expect(new SessionStore().verify(id)).toBe(false);
  });

  it('expires a session once its lifetime passes, and forgets it', () => {
    let now = 1000;
    const store = new SessionStore(500, () => now);
    const id = store.create();

    now += 499;
    expect(store.verify(id)).toBe(true);

    now += 2;
    expect(store.verify(id)).toBe(false);
    expect(store.size).toBe(0);
  });

  it('revokes on sign-out', () => {
    const store = new SessionStore();
    const id = store.create();
    store.revoke(id);
    expect(store.verify(id)).toBe(false);
  });

  // Sessions are checked by id alone, so they survive the token they were
  // issued under unless something clears them.
  it('drops every session at once', () => {
    const store = new SessionStore();
    const first = store.create();
    const second = store.create();

    store.revokeAll();

    expect(store.verify(first)).toBe(false);
    expect(store.verify(second)).toBe(false);
    expect(store.size).toBe(0);
  });

  // A browser closed without signing out never comes back to be verified, so
  // nothing else would ever evict its session.
  it('sweeps expired sessions when a new one is issued', () => {
    let now = 0;
    const store = new SessionStore(1000, () => now);
    store.create();
    store.create();
    expect(store.size).toBe(2);

    now = 1001;
    store.create();
    expect(store.size).toBe(1);
  });
});

describe('isAuthorized', () => {
  it('lets everything through when no token is configured', () => {
    expect(
      isAuthorized({
        config: readAuthConfig({} as NodeJS.ProcessEnv),
        sessions: new SessionStore(),
      }),
    ).toBe(true);
  });

  it('refuses a request with no credentials', () => {
    expect(isAuthorized({ config: config(), sessions: new SessionStore() })).toBe(false);
  });

  it('accepts the token as a bearer header, for non-browser clients', () => {
    expect(
      isAuthorized({
        config: config(),
        sessions: new SessionStore(),
        authorization: `Bearer ${TOKEN}`,
      }),
    ).toBe(true);
  });

  it('refuses the wrong bearer token', () => {
    expect(
      isAuthorized({
        config: config(),
        sessions: new SessionStore(),
        authorization: 'Bearer nope',
      }),
    ).toBe(false);
  });

  it('accepts a session cookie, which is how the WebSocket authenticates', () => {
    const sessions = new SessionStore();
    const id = sessions.create();
    expect(
      isAuthorized({
        config: config(),
        sessions,
        cookieHeader: `${SESSION_COOKIE}=${id}`,
      }),
    ).toBe(true);
  });

  it('refuses a session that was revoked', () => {
    const sessions = new SessionStore();
    const id = sessions.create();
    sessions.revoke(id);
    expect(
      isAuthorized({ config: config(), sessions, cookieHeader: `${SESSION_COOKIE}=${id}` }),
    ).toBe(false);
  });

  it('refuses a made-up session id', () => {
    expect(
      isAuthorized({
        config: config(),
        sessions: new SessionStore(),
        cookieHeader: `${SESSION_COOKIE}=00000000-0000-0000-0000-000000000000`,
      }),
    ).toBe(false);
  });
});

describe('isPublicApiPath', () => {
  it('exposes only the status check and the token exchange', () => {
    expect(isPublicApiPath('/auth')).toBe(true);
    expect(isPublicApiPath('/auth/session')).toBe(true);
  });

  it.each(['/graph', '/entities/abc/exec', '/plugins', '/health', '/auth/session/extra'])(
    'gates %s',
    (path) => {
      expect(isPublicApiPath(path)).toBe(false);
    },
  );
});

describe('isExposedWithoutAuth', () => {
  // The published image sets DOCKSCOPE_BIND=0.0.0.0, so this is the default
  // situation for anyone who publishes the port.
  it.each(['0.0.0.0', '::', '192.168.1.10'])('warns when bound to %s with no token', (bind) => {
    expect(isExposedWithoutAuth(bind, readAuthConfig({} as NodeJS.ProcessEnv))).toBe(true);
  });

  it.each(['127.0.0.1', 'localhost', '::1'])('stays quiet on %s', (bind) => {
    expect(isExposedWithoutAuth(bind, readAuthConfig({} as NodeJS.ProcessEnv))).toBe(false);
  });

  it('stays quiet when a token is configured', () => {
    expect(isExposedWithoutAuth('0.0.0.0', config())).toBe(false);
  });
});

describe('tokenIsWeak', () => {
  it('flags a short token', () => {
    expect(tokenIsWeak(config('short'))).toBe(true);
  });

  it('accepts one of the minimum length', () => {
    expect(tokenIsWeak(config('x'.repeat(MIN_TOKEN_LENGTH)))).toBe(false);
  });

  it('says nothing when auth is off', () => {
    expect(tokenIsWeak(readAuthConfig({} as NodeJS.ProcessEnv))).toBe(false);
  });

  // A stored token is only ever a hash, so its length cannot be judged.
  it('says nothing about a token it can only see hashed', () => {
    expect(tokenIsWeak(storedConfig('short'))).toBe(false);
  });
});

describe('hashToken', () => {
  it('never stores the token itself', () => {
    const stored = hashToken(TOKEN);
    expect(stored.hash).not.toContain(TOKEN);
    expect(stored.salt).not.toContain(TOKEN);
  });

  it('salts each hash, so the same token stores differently twice', () => {
    expect(hashToken(TOKEN).hash).not.toBe(hashToken(TOKEN).hash);
  });

  it('reproduces the hash when given the original salt', () => {
    const stored = hashToken(TOKEN);
    expect(hashToken(TOKEN, stored.salt).hash).toBe(stored.hash);
  });
});

describe('tokenMatchesStored', () => {
  const stored = hashToken(TOKEN);

  it('accepts the original token', () => {
    expect(tokenMatchesStored(TOKEN, stored)).toBe(true);
  });

  it.each(['wrong', '', `${TOKEN}x`, TOKEN.slice(0, -1)])('rejects %o', (candidate) => {
    expect(tokenMatchesStored(candidate, stored)).toBe(false);
  });

  it('rejects rather than throwing on a corrupt record', () => {
    expect(tokenMatchesStored(TOKEN, { salt: 'x', hash: 'not-hex' })).toBe(false);
  });
});

describe('isLoopbackAddress', () => {
  // Node reports IPv4 peers on a dual-stack socket in this mapped form.
  it.each(['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', '::FFFF:127.0.0.1'])(
    'treats %s as local',
    (address) => {
      expect(isLoopbackAddress(address)).toBe(true);
    },
  );

  it.each([undefined, '', '192.168.1.4', '10.0.0.1', '::ffff:192.168.1.4', '172.17.0.1'])(
    'treats %o as remote',
    (address) => {
      expect(isLoopbackAddress(address)).toBe(false);
    },
  );
});

describe('setupAvailability', () => {
  const open = readAuthConfig({} as NodeJS.ProcessEnv);

  it('offers setup on an unconfigured instance from the machine itself', () => {
    expect(
      setupAvailability({
        config: open,
        declined: false,
        remoteAddress: '127.0.0.1',
        uptimeMs: 0,
      }),
    ).toBe('available');
  });

  // Local access already implies control of the machine, so there is nothing
  // for a deadline to protect against.
  it('keeps offering setup locally long after startup', () => {
    expect(
      setupAvailability({
        config: open,
        declined: false,
        remoteAddress: '::1',
        uptimeMs: 30 * 24 * 60 * 60 * 1000,
      }),
    ).toBe('available');
  });

  it('offers setup from the network shortly after startup', () => {
    expect(
      setupAvailability({
        config: open,
        declined: false,
        remoteAddress: '192.168.1.4',
        uptimeMs: NETWORK_SETUP_WINDOW_MS - 1,
      }),
    ).toBe('available');
  });

  // Otherwise an instance left running could be claimed by whoever finds it.
  it('closes the network window once it has elapsed', () => {
    expect(
      setupAvailability({
        config: open,
        declined: false,
        remoteAddress: '192.168.1.4',
        uptimeMs: NETWORK_SETUP_WINDOW_MS + 1,
      }),
    ).toBe('window-closed');
  });

  it('never offers setup once a token exists', () => {
    expect(
      setupAvailability({
        config: config(),
        declined: false,
        remoteAddress: '127.0.0.1',
        uptimeMs: 0,
      }),
    ).toBe('configured');
  });

  it('stops asking once the operator has declined', () => {
    expect(
      setupAvailability({
        config: open,
        declined: true,
        remoteAddress: '127.0.0.1',
        uptimeMs: 0,
      }),
    ).toBe('declined');
  });
});

describe('VerifiedTokenCache', () => {
  it('remembers a token so scrypt is not repeated on every request', () => {
    const cache = new VerifiedTokenCache();
    expect(cache.has(TOKEN)).toBe(false);
    cache.remember(TOKEN);
    expect(cache.has(TOKEN)).toBe(true);
    expect(cache.has('other')).toBe(false);
  });

  it('forgets everything when the token changes', () => {
    const cache = new VerifiedTokenCache();
    cache.remember(TOKEN);
    cache.clear();
    expect(cache.has(TOKEN)).toBe(false);
  });
});

describe('readProxyAuthConfig', () => {
  it('is off when nothing is configured', () => {
    expect(readProxyAuthConfig({} as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  // Either half alone is useless, and a header with no trusted source is worse
  // than useless: anyone could set it themselves.
  it('is off when only the header is set', () => {
    expect(
      readProxyAuthConfig({ DOCKSCOPE_AUTH_PROXY_HEADER: 'Remote-User' } as NodeJS.ProcessEnv)
        .enabled,
    ).toBe(false);
  });

  it('is off when only the trusted proxies are set', () => {
    expect(
      readProxyAuthConfig({ DOCKSCOPE_TRUSTED_PROXIES: '172.18.0.0/16' } as NodeJS.ProcessEnv)
        .enabled,
    ).toBe(false);
  });

  it('lowercases the header, because Node lowercases incoming header names', () => {
    expect(
      readProxyAuthConfig({
        DOCKSCOPE_AUTH_PROXY_HEADER: 'Remote-User',
        DOCKSCOPE_TRUSTED_PROXIES: '172.18.0.5',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({ enabled: true, header: 'remote-user', trustedProxies: ['172.18.0.5'] });
  });

  it('splits and trims a proxy list', () => {
    expect(
      readProxyAuthConfig({
        DOCKSCOPE_AUTH_PROXY_HEADER: 'X-User',
        DOCKSCOPE_TRUSTED_PROXIES: ' 10.0.0.1 , 172.18.0.0/16 ,',
      } as NodeJS.ProcessEnv).trustedProxies,
    ).toEqual(['10.0.0.1', '172.18.0.0/16']);
  });
});

describe('addressMatches', () => {
  it.each([
    ['10.0.0.5', '10.0.0.5'],
    ['::ffff:10.0.0.5', '10.0.0.5'],
    ['172.18.0.7', '172.18.0.0/16'],
    ['172.18.255.254', '172.18.0.0/16'],
    ['192.168.1.9', '192.168.1.0/24'],
    ['8.8.8.8', '0.0.0.0/0'],
    ['::1', '::1'],
  ])('%s matches %s', (address, pattern) => {
    expect(addressMatches(address, pattern)).toBe(true);
  });

  it.each([
    ['10.0.0.6', '10.0.0.5'],
    ['172.19.0.7', '172.18.0.0/16'],
    ['192.168.2.9', '192.168.1.0/24'],
    [undefined, '10.0.0.5'],
    ['10.0.0.5', 'not-an-address'],
    ['10.0.0.5', '10.0.0.0/33'],
    ['10.0.0.999', '10.0.0.0/8'],
  ])('%s does not match %s', (address, pattern) => {
    expect(addressMatches(address, pattern)).toBe(false);
  });
});

describe('proxyAuthenticatedUser', () => {
  const config = readProxyAuthConfig({
    DOCKSCOPE_AUTH_PROXY_HEADER: 'Remote-User',
    DOCKSCOPE_TRUSTED_PROXIES: '172.18.0.0/16',
  } as NodeJS.ProcessEnv);

  it('reads the user a trusted proxy vouched for', () => {
    expect(
      proxyAuthenticatedUser({
        config,
        headers: { 'remote-user': 'manuel' },
        remoteAddress: '172.18.0.4',
      }),
    ).toBe('manuel');
  });

  // Without this the header would be an open door: anyone able to reach the
  // port could simply claim to be an authenticated user.
  it('ignores the header from an untrusted source', () => {
    expect(
      proxyAuthenticatedUser({
        config,
        headers: { 'remote-user': 'attacker' },
        remoteAddress: '203.0.113.9',
      }),
    ).toBeUndefined();
  });

  it('ignores an empty or missing header from a trusted proxy', () => {
    expect(
      proxyAuthenticatedUser({ config, headers: {}, remoteAddress: '172.18.0.4' }),
    ).toBeUndefined();
    expect(
      proxyAuthenticatedUser({
        config,
        headers: { 'remote-user': '   ' },
        remoteAddress: '172.18.0.4',
      }),
    ).toBeUndefined();
  });

  it('takes the first value when the header is repeated', () => {
    expect(
      proxyAuthenticatedUser({
        config,
        headers: { 'remote-user': ['first', 'second'] },
        remoteAddress: '172.18.0.4',
      }),
    ).toBe('first');
  });

  it('stays off entirely when proxy auth is not configured', () => {
    expect(
      proxyAuthenticatedUser({
        config: readProxyAuthConfig({} as NodeJS.ProcessEnv),
        headers: { 'remote-user': 'manuel' },
        remoteAddress: '172.18.0.4',
      }),
    ).toBeUndefined();
  });
});

describe('isAuthorized behind a proxy', () => {
  const proxy = readProxyAuthConfig({
    DOCKSCOPE_AUTH_PROXY_HEADER: 'Remote-User',
    DOCKSCOPE_TRUSTED_PROXIES: '172.18.0.0/16',
  } as NodeJS.ProcessEnv);

  it('accepts a proxy-authenticated request with no token at all', () => {
    expect(
      isAuthorized({
        config: config(),
        sessions: new SessionStore(),
        proxy,
        headers: { 'remote-user': 'manuel' },
        remoteAddress: '172.18.0.4',
      }),
    ).toBe(true);
  });

  it('still refuses a spoofed header from elsewhere', () => {
    expect(
      isAuthorized({
        config: config(),
        sessions: new SessionStore(),
        proxy,
        headers: { 'remote-user': 'manuel' },
        remoteAddress: '203.0.113.9',
      }),
    ).toBe(false);
  });

  // Configuring a proxy makes authentication mandatory, so reaching the port
  // directly is refused rather than falling through the "no token" branch.
  it('refuses an unproxied request even when no token is set', () => {
    const open = readAuthConfig({} as NodeJS.ProcessEnv);
    expect(isAuthorized({ config: open, sessions: new SessionStore(), proxy, headers: {} })).toBe(
      false,
    );
    expect(
      isAuthorized({
        config: open,
        sessions: new SessionStore(),
        proxy,
        headers: { 'remote-user': 'manuel' },
        remoteAddress: '172.18.0.4',
      }),
    ).toBe(true);
  });

  it('still lets a bearer token through for scripts behind the proxy', () => {
    expect(
      isAuthorized({
        config: config(),
        sessions: new SessionStore(),
        proxy,
        headers: {},
        authorization: `Bearer ${TOKEN}`,
      }),
    ).toBe(true);
  });

  // Nothing to claim when a proxy is already doing the authenticating.
  it('offers no setup while a proxy is configured', () => {
    expect(
      setupAvailability({
        config: readAuthConfig({} as NodeJS.ProcessEnv),
        declined: false,
        remoteAddress: '127.0.0.1',
        uptimeMs: 0,
        proxyEnabled: true,
      }),
    ).toBe('configured');
  });
});

describe('AttemptLimiter', () => {
  it('allows attempts up to the limit', () => {
    const limiter = new AttemptLimiter(3, 1000, () => 0);
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.retryAfterMs('a')).toBe(0);
      limiter.recordFailure('a');
    }
    expect(limiter.retryAfterMs('a')).toBeGreaterThan(0);
  });

  it('limits each source independently', () => {
    const limiter = new AttemptLimiter(1, 1000, () => 0);
    limiter.recordFailure('a');
    expect(limiter.retryAfterMs('a')).toBeGreaterThan(0);
    expect(limiter.retryAfterMs('b')).toBe(0);
  });

  it('lets the source back in once the lockout expires', () => {
    let now = 0;
    const limiter = new AttemptLimiter(1, 1000, () => now);
    limiter.recordFailure('a');
    expect(limiter.retryAfterMs('a')).toBe(1000);

    now = 1001;
    expect(limiter.retryAfterMs('a')).toBe(0);
  });

  // Someone who mistypes twice and then gets it right should not stay counted.
  it('forgets the failures after a success', () => {
    const limiter = new AttemptLimiter(2, 1000, () => 0);
    limiter.recordFailure('a');
    limiter.recordSuccess('a');
    limiter.recordFailure('a');
    expect(limiter.retryAfterMs('a')).toBe(0);
  });

  // A scan from many addresses would otherwise leave one entry behind each,
  // for the life of the process.
  it('drops expired counters instead of keeping one per source forever', () => {
    let now = 0;
    const limiter = new AttemptLimiter(5, 1000, () => now);

    for (let i = 0; i < 50; i += 1) {
      limiter.recordFailure(`10.0.0.${i}`);
    }
    expect(limiter.size).toBe(50);

    now = 1001;
    limiter.recordFailure('10.1.0.1');
    expect(limiter.size).toBe(1);
  });

  it('keeps counters that are still within their lockout', () => {
    let now = 0;
    const limiter = new AttemptLimiter(5, 1000, () => now);
    limiter.recordFailure('a');

    now = 500;
    limiter.recordFailure('b');
    expect(limiter.size).toBe(2);
  });
});

describe('isAuthorized with a stored token', () => {
  it('accepts the token behind the stored hash', () => {
    expect(
      isAuthorized({
        config: storedConfig(),
        sessions: new SessionStore(),
        authorization: `Bearer ${TOKEN}`,
      }),
    ).toBe(true);
  });

  it('refuses a different token', () => {
    expect(
      isAuthorized({
        config: storedConfig(),
        sessions: new SessionStore(),
        authorization: 'Bearer nope',
      }),
    ).toBe(false);
  });

  it('caches a token it has already verified', () => {
    const verified = new VerifiedTokenCache();
    const params = {
      config: storedConfig(),
      sessions: new SessionStore(),
      authorization: `Bearer ${TOKEN}`,
      verified,
    };
    expect(isAuthorized(params)).toBe(true);
    expect(verified.has(TOKEN)).toBe(true);
    expect(isAuthorized(params)).toBe(true);
  });
});
