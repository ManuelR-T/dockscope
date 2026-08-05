# DockScope HTTP API

DockScope's UI is a client of this API, so everything the dashboard does is
available over HTTP. The server listens on `127.0.0.1:4681` by default.

Endpoints are grouped below. Paths marked `:id` take an entity id, which for the
Docker source is the container id.

## Quick examples

```bash
# the whole graph, nodes and links
curl -s localhost:4681/api/graph | jq '.nodes[].name'

# live stats for one container
curl -s localhost:4681/api/entities/<id>/stats | jq

# restart a container through its owning plugin
curl -X POST localhost:4681/api/entities/<id>/actions/core.docker/restart
```

The WebSocket at `/ws` pushes graph, stats, event, log, exec, anomaly and
diagnostic messages. It is the same data the dashboard renders.

> Cross-origin browser requests are rejected. See the security note in the
> [README](../README.md#quick-start) if you serve DockScope behind a proxy.

## Authentication

With no access token configured there is none, and every endpoint below answers
directly. Once a token is set, everything under `/api` and the `/ws` handshake
returns `401` without credentials.

Scripts send the token as a bearer header:

```bash
curl -s -H "Authorization: Bearer $DOCKSCOPE_TOKEN" localhost:4681/api/graph
```

The dashboard instead exchanges the token for an HttpOnly session cookie, since
a browser cannot set headers on a WebSocket handshake.

`GET /api/auth` needs no credentials and doubles as a liveness probe. It
reports whether a token is required, whether you currently hold one, whether it
is pinned by `DOCKSCOPE_TOKEN`, whether a reverse proxy authenticated you, and
whether first-run setup is still on offer.

| Method | Path                 | Description                                                     |
| ------ | -------------------- | --------------------------------------------------------------- |
| GET    | `/api/auth`          | Current auth status. Never requires credentials                 |
| POST   | `/api/auth/setup`    | Claim an unconfigured instance, or change the token you hold    |
| POST   | `/api/auth/session`  | Exchange a token for a session cookie                           |
| DELETE | `/api/auth/session`  | Sign out                                                        |
| DELETE | `/api/auth/token`    | Remove the token, reopening the instance. Requires holding it   |
| POST   | `/api/auth/reminder` | Turn the first-run setup prompt on or off                       |

Claiming an unconfigured instance is only possible from the machine itself, or
from the network within 15 minutes of startup. Failed attempts are rate limited
per source: 10 failures, then a 5 minute lockout. See
[SECURITY.md](../.github/SECURITY.md) for the full model.

## Endpoints

| Method | Path                                  | Description                                                        |
| ------ | ------------------------------------- | ------------------------------------------------------------------ |
| GET    | `/api/graph`                          | Full graph (nodes + links)                                         |
| GET    | `/api/sources`                        | Registered data sources                                            |
| GET    | `/api/features`                       | Which optional features this instance has (Compose)                |
| GET    | `/api/entities/:id/operations`        | Matching plugin operation descriptors                              |
| GET    | `/api/entities/:id/actions`           | Contextual plugin-owned actions                                    |
| POST   | `/api/entities/:id/actions/:pluginId/:actionId` | Run an exact entity action                              |
| GET    | `/api/entities/:id/{stats,logs,inspect,history,top,diff,diagnostic}` | Generic entity reads          |
| GET    | `/api/projects`                       | Plugin-owned project inventory                                     |
| POST   | `/api/projects/:name/{action}`        | Run a project action with owner query parameters                   |
| GET    | `/api/systems`                        | Plugin-owned runtime/system inventory                              |
| GET    | `/api/connections/providers`          | Typed connection provider forms                                    |
| GET    | `/api/connections`                    | Configured source connections                                      |
| POST   | `/api/connections/:pluginId/:providerId` | Add a provider connection                                       |
| DELETE | `/api/connections/:pluginId/:providerId/:connectionId` | Remove a provider connection                   |
| GET    | `/api/health`                         | Aggregate plugin source health                                     |
| GET    | `/api/version`                        | Current + latest version                                           |
| GET    | `/api/plugins`                        | Runtime plugin registry                                            |
| GET    | `/api/plugins/errors`                 | External plugin load/register failures                             |
| GET    | `/api/plugins/warnings`               | External plugin manifest deprecation warnings                      |
| GET    | `/api/plugins/ui`                     | Frontend plugin extension descriptors                              |
| GET    | `/api/plugins/:pluginId/frontend`     | Sandboxed frontend bundle source                                   |
| POST   | `/api/plugins/:pluginId/ui/:id/action` | Run a declared plugin UI action                                  |
| GET    | `/api/plugins/commands`               | Plugin command descriptors                                         |
| POST   | `/api/plugins/:pluginId/commands/:id` | Run a plugin command                                               |
| GET    | `/api/plugins/events`                 | Recent plugin event bus entries                                    |
| GET    | `/api/plugins/review`                 | Plugin permission/capability review reports                        |
| GET    | `/api/plugins/catalog`                | Configured plugin catalog entries                                  |
| GET    | `/api/plugins/marketplace`            | Catalog entries merged with local install state                    |
| POST   | `/api/plugins/marketplace/:pluginId/install` | Install from the configured catalog                         |
| POST   | `/api/plugins/marketplace/:pluginId/update` | Update an installed catalog plugin                            |
| DELETE | `/api/plugins/marketplace/:pluginId`  | Uninstall a local marketplace plugin                              |
| GET    | `/api/plugins/catalogs`               | User-added catalogs with their pinned key fingerprints              |
| POST   | `/api/plugins/catalogs/preview`       | Inspect a catalog and its signing key without trusting it           |
| POST   | `/api/plugins/catalogs`               | Trust and add a catalog (pins its signing key)                      |
| DELETE | `/api/plugins/catalogs?source=`       | Remove a user-added catalog                                         |
| GET    | `/api/plugins/approvals`              | Persisted plugin approvals                                         |
| GET    | `/api/plugins/compatibility`          | Plugin compatibility warnings and migration metadata               |
| POST   | `/api/plugins/:pluginId/migrate`      | Run a declared plugin compatibility migration                      |
| POST   | `/api/plugins/:pluginId/approve`      | Approve the current plugin fingerprint                             |
| POST   | `/api/plugins/:pluginId/revoke-approval` | Revoke plugin approval                                          |
| GET    | `/api/plugins/config`                 | Plugin config schemas and values                                   |
| PUT    | `/api/plugins/:pluginId/config`       | Update plugin config                                               |
| POST   | `/api/plugins/:pluginId/reload`       | Reload an external plugin from disk                                |
| GET    | `/api/plugins/secrets`                | Declared plugin secret status                                      |
| PUT    | `/api/plugins/:pluginId/secrets/:key` | Store a declared plugin secret                                     |
| POST   | `/api/plugins/:pluginId/enable`       | Enable an external plugin                                          |
| POST   | `/api/plugins/:pluginId/disable`      | Disable an external plugin                                         |
| WS     | `/ws`                                 | Real-time graph, stats, events, logs, exec, anomalies, diagnostics |
