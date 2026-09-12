# Endpoint Monitoring

Monitor HTTP and HTTPS health endpoints directly from DockScope, without another
server or runtime dependency. This plugin uses the new `ui.query` host capability;
it requires a build containing the generic entity and read-only panel interfaces.

## Setup

Install Endpoint Monitoring from a catalog containing this plugin, approve its
network permissions, and enable it. Under **Connections**, select **HTTP / HTTPS
endpoints** and enter a name and URL. Select the resulting graph node to see its
health, response time, HTTP status, last check, and HTTPS certificate expiry.
Connections survive plugin restarts and upgrades. Removing a connection removes its graph node
on the next graph refresh.

For local development from this repository, after `npm run build`:

```sh
node dist/cli.js plugin:dev --plugins ./plugins/official/endpoints
```

## Check semantics

- Up to 16 endpoints, at most four requests in parallel, approximately every 30
  seconds. Every request has a three-second wall-clock deadline, including DNS
  lookup and TLS handshake.
- Checks send `GET`, measure time to response headers, and close the response
  without downloading its body. Configure observational health URLs: do not use
  URLs where a GET causes a mutation.
- HTTP 200–399 is healthy. Redirects count as a response from the configured URL;
  they are **not followed**, so this does not check the redirect destination.
- HTTP errors, connection failures and invalid/untrusted TLS certificates are
  unhealthy. Missing or more-than-90-second-old observations are unknown.
- HTTPS uses Node's normal certificate and hostname verification. There is no
  “ignore TLS errors” switch. Certificate expiry is available only after a
  successful verified handshake. Self-signed certificates are not automatically
  trusted. Expiry is informational; approaching expiry does not change health.
- `response_time` is measured in milliseconds; `certificate_remaining` in whole
  days. Each metric carries its observation timestamp. HTTP endpoints have no
  certificate metric, and failed probes have no successful-response metric.

The request and TLS behavior follows the [Node HTTPS interface](https://nodejs.org/api/https.html)
and [peer-certificate interface](https://nodejs.org/api/tls.html#tlssocketgetpeercertificatedetailed).

## Access and limitations

Operators configure targets; Readers only see cached observations. Panel queries
read the cache; plugin startup and worker-crash recovery also restart monitoring.
URLs with embedded credentials, query
parameters, or fragments are rejected. URL paths and labels are visible to
Readers, so do not put secrets in them. Authentication headers and per-endpoint
trust roots are not supported in this first version.

The plugin intentionally has local-network access for homelab targets. It runs
inside DockScope's existing plugin process isolation, which is not an operating
system network sandbox. Only install trusted plugins.

Recordings preserve entity identity and the metric observations carried in graph
frames. Live panel queries pause during replay; panel responses themselves are
not recorded. This is a lightweight availability check, not a replacement for a
long-term uptime database, alerting system, or certificate manager.
