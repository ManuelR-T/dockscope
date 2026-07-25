// Cross-origin access control for the API and WebSocket.
//
// Browsers do NOT apply the same-origin policy to WebSocket connections: any
// page a user visits can open `ws://localhost:4681/ws` and drive privileged
// operations (exec into containers, lifecycle actions). Browsers always attach
// an `Origin` header to those handshakes, so the server can — and must — reject
// origins that are not its own. See also `DOCKSCOPE_ALLOWED_ORIGINS` for
// reverse-proxy / custom-domain deployments.

/** Parse the `DOCKSCOPE_ALLOWED_ORIGINS` env var into a lowercased set. */
export function parseAllowedOrigins(env: NodeJS.ProcessEnv): Set<string> {
  return new Set(
    (env.DOCKSCOPE_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Loopback is the same machine, hence the same trust domain. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' || host === '::1' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/**
 * Whether a WebSocket handshake with the given `Origin` header should be
 * accepted. `host` is the request's `Host` header, used to recognise
 * same-origin connections (the page was served by this very server, so its
 * Origin authority equals the Host it connected to — covers exposed-IP and
 * reverse-proxy access without any configuration).
 */
export function isAllowedWsOrigin(params: {
  origin: string | undefined;
  host: string | undefined;
  allowedOrigins: Set<string>;
}): boolean {
  const { origin, host, allowedOrigins } = params;

  // Non-browser clients (the CLI, curl, native WebSocket tools) don't send an
  // Origin. The drive-by threat is browser-only, so a missing Origin is trusted.
  if (!origin) {
    return true;
  }

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // malformed Origin — reject
  }

  if (allowedOrigins.has(origin.toLowerCase())) {
    return true;
  }
  if (isLoopbackHost(url.hostname)) {
    return true;
  }
  // Same-origin: Origin authority matches the Host the request was sent to.
  if (host && url.host.toLowerCase() === host.toLowerCase()) {
    return true;
  }
  return false;
}

/**
 * Whether a cross-origin REST request from the given `Origin` may read
 * responses. Same-origin requests (no Origin header) never need CORS headers,
 * so they are always fine; cross-origin reads are limited to loopback and the
 * explicit allow-list.
 */
export function isAllowedCorsOrigin(params: {
  origin: string | undefined;
  allowedOrigins: Set<string>;
}): boolean {
  const { origin, allowedOrigins } = params;
  if (!origin) {
    return true;
  }
  if (allowedOrigins.has(origin.toLowerCase())) {
    return true;
  }
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}
