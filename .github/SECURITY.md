# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in DockScope, please report it responsibly:

1. **Do NOT open a public issue**
2. Email the maintainer or use [GitHub's private vulnerability reporting](https://github.com/ManuelR-T/dockscope/security/advisories/new)
3. Include steps to reproduce and potential impact

## Scope

DockScope connects to your Docker daemon and, through plugins, to Kubernetes clusters. It can exec into containers and pods, run lifecycle actions, and read environment variables, so treat access to it as equivalent to access to those systems.

## Access control

Two independent layers, both worth understanding because they protect against different things:

- **Origin checks (always on).** The API and WebSocket reject cross-origin browser requests, so a page you visit cannot drive a DockScope instance on your machine. Configure extra origins with `DOCKSCOPE_ALLOWED_ORIGINS`. This only constrains browsers.
- **Access tokens (opt-in).** Shared secrets required on every API request and WebSocket handshake. This is what protects against non-browser clients: curl, scripts, or any host that can reach the port. The dashboard holds an HttpOnly, SameSite=Strict session cookie once unlocked; other clients send `Authorization: Bearer <token>`.

The full-access operator token can be set two ways:

- **`DOCKSCOPE_TOKEN`** in the environment. Takes precedence over anything stored, and disables the setup screen. Use this for deployments that configure themselves.
- **The dashboard.** With no token set, the first-run screen offers to choose one, and the Security panel in the status bar can set, change or remove it at any time afterwards. It is stored as a salted scrypt hash in `~/.dockscope/auth.json` (mode 0600); the file is enough to verify a token, never to recover it. In the Docker image this lives under `/data`, which must be a mounted volume to survive the container being recreated.

  Changing or removing a token requires already holding it. Silencing the first-run reminder never prevents setting one later.

- **`DOCKSCOPE_READ_ONLY_TOKEN`** adds an environment-only reader credential.
  Readers can inspect graphs, stats, logs, environment/configuration data,
  history, diagnostics and system health, but server-side policy rejects
  workload actions, exec, plugin commands, connection changes, access settings,
  and configuration or secret writes. Browser sessions retain the token's role.

  It requires a full-access token from `DOCKSCOPE_TOKEN` or the dashboard;
  DockScope refuses to start if the reader token is configured alone. Use two
  distinct random values. If they match, the value receives operator access.

Failed attempts are rate limited per source address: 10 failures trigger a 5 minute lockout, cleared by a success.

- **Reverse-proxy authentication (opt-in).** `DOCKSCOPE_AUTH_PROXY_HEADER` plus `DOCKSCOPE_TRUSTED_PROXIES` lets an identity proxy (Authelia, Authentik, oauth2-proxy, Cloudflare Access) do the authenticating, which is the arrangement to prefer if you already run one. The header is only trusted when the connection came from a declared proxy address, so it cannot be forged by a direct caller.

  Enabling it makes authentication **mandatory**: a request that bypasses the proxy is refused even when no token is configured, and first-run setup is switched off. Keep the port unpublished so the proxy is the only route in.

  Proxy-authenticated users are operators. Mapping proxy identities or groups
  to the reader role is not supported yet.

### Claiming an unconfigured instance

While no token is set there is no authentication, so whoever reaches the instance first could set one. To bound that:

- From the machine running DockScope, setup is always available. Local access already implies control of the host.
- From the network, setup is only available during the **first 15 minutes** after startup. After that it refuses and asks you to restart or set `DOCKSCOPE_TOKEN`.

Without a token there is no authentication at all. Bound to loopback that is fine, and it stays the default so local use needs no configuration. The published Docker image sets `DOCKSCOPE_BIND=0.0.0.0`, so **publishing the port without a token exposes container and cluster exec to anything that can reach it.** DockScope prints a warning at startup when it detects this.

Use long random tokens (`openssl rand -hex 32`). They are bearer secrets, and
the per-source lockout above slows online guessing but is no substitute for
length. An operator token grants full control.

Read-only is authorization, not redaction or public access. A reader can still
see sensitive application logs, raw API inspection data, process arguments,
filesystem changes, and environment values. The dashboard masks likely secret
values initially. DockScope removes its configured access-token values and
their environment entries from reader API and WebSocket responses, but it does
not promise to identify or remove unrelated application secrets.

Remaining considerations:

- Log streaming exposes container and pod output
- Environment variable inspection may expose secrets (masked by default in the UI; Kubernetes secret references are shown as references, never resolved)

**DockScope is designed for local development use.** Do not expose it to the public internet, even with a token, without putting it behind TLS and a reverse proxy you trust.
