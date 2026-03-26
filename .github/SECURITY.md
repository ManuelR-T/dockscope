# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in DockScope, please report it responsibly:

1. **Do NOT open a public issue**
2. Email the maintainer or use [GitHub's private vulnerability reporting](https://github.com/ManuelR-T/dockscope/security/advisories/new)
3. Include steps to reproduce and potential impact

## Scope

DockScope runs locally and connects to your Docker daemon. Security concerns include:

- Container action endpoints (start/stop/kill/remove) have no authentication
- Log streaming exposes container output
- Environment variable inspection may expose secrets (masked by default)

**DockScope is designed for local development use.** Do not expose it to the public internet without adding authentication.
