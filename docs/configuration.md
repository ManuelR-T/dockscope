# Configuration

Everything DockScope reads at startup: command-line flags, environment
variables, and where it keeps state. Nothing here is required to run it.

- [Commands](#commands)
- [`dockscope up` options](#dockscope-up-options)
- [Environment variables](#environment-variables)
- [Where state lives](#where-state-lives)
- [Access control](#access-control)
- [Plugin file locations](#plugin-file-locations)

## Commands

| Command                            | Description                                                   |
| ---------------------------------- | ------------------------------------------------------------- |
| `dockscope up`                     | Start the server and open the dashboard                       |
| `dockscope scan`                   | Print the graph as JSON and exit, with no UI                  |
| `dockscope plugin:init`            | Scaffold a plugin directory                                   |
| `dockscope plugin:dev`             | Run DockScope with local plugin development defaults          |
| `dockscope plugin:validate`        | Validate external plugin manifests                            |
| `dockscope plugin:watch`           | Continuously validate manifests while you edit                |
| `dockscope plugin:test`            | Validate and import external plugins                          |
| `dockscope plugin:doctor`          | Check plugin paths and catalog configuration                  |
| `dockscope plugin:keys`            | Generate Ed25519 plugin package signing keys                  |
| `dockscope plugin:pack`            | Create a hash-verified plugin package                         |
| `dockscope plugin:verify`          | Verify a plugin package signature                             |
| `dockscope plugin:install`         | Install a directory or package into the local plugin registry |
| `dockscope plugin:list`            | List locally installed plugins                                |
| `dockscope plugin:update`          | Update an installed plugin from its recorded source           |
| `dockscope plugin:uninstall`       | Remove an installed plugin                                    |
| `dockscope plugin:catalog`         | List plugins from a catalog                                   |
| `dockscope plugin:catalog:entry`   | Generate a catalog entry from a signed package                |
| `dockscope plugin:catalog:sign`    | Sign a catalog JSON file                                      |
| `dockscope plugin:catalog:install` | Install a signed package from a catalog                       |

The `plugin:*` commands are covered in [Writing a plugin](plugins.md) and
[Publishing a plugin](plugin-publishing.md).

## `dockscope up` options

`dockscope up --help` is always the authoritative list.

### Server

| Option                 | Default        | Description                                                           |
| ---------------------- | -------------- | --------------------------------------------------------------------- |
| `-p, --port <port>`    | `4681`         | Server port. Auto-increments if the port is already in use            |
| `-H, --host <url>`     | `$DOCKER_HOST` | Docker host to inspect, e.g. `ssh://user@remote` or `tcp://host:2375` |
| `-b, --bind <address>` | `127.0.0.1`    | Listen address. `0.0.0.0` inside a container                          |
| `--no-open`            | -              | Do not open a browser on startup                                      |
| `--no-port-check`      | -              | Use the requested port as-is, without conflict detection              |

`-H` is how you point DockScope at a Docker daemon somewhere else:

```bash
dockscope up -H ssh://user@homelab
```

### Plugins

| Option                               | Default                | Description                                           |
| ------------------------------------ | ---------------------- | ----------------------------------------------------- |
| `--plugins <paths>`                  | -                      | Load external plugins from a path list                |
| `--plugin-permissions <permissions>` | installed grants       | Add globally allowed external plugin permissions      |
| `--plugin-registry <dir>`            | `~/.dockscope/plugins` | Local plugin registry directory                       |
| `--no-external-plugins`              | -                      | Disable external plugin loading entirely              |
| `--allow-unsigned-plugins`           | -                      | Allow unsigned catalog entries, for local development |

### Plugin state files

Each of these overrides one file. See [Plugin file locations](#plugin-file-locations).

| Option                      | Description                      |
| --------------------------- | -------------------------------- |
| `--plugin-config <file>`    | Plugin configuration values      |
| `--plugin-state <file>`     | Enabled and disabled state       |
| `--plugin-secrets <file>`   | Plugin secrets                   |
| `--plugin-secret-key <key>` | Encrypt secrets with a local key |
| `--plugin-events <file>`    | Event history                    |
| `--plugin-approvals <file>` | Approvals                        |

### Plugin catalogs

| Option                               | Description                                               |
| ------------------------------------ | --------------------------------------------------------- |
| `--plugin-catalog <sources>`         | Extra catalogs (files or URLs), added to the official one |
| `--plugin-catalog-public-key <file>` | Verify the configured catalog signature                   |
| `--plugin-catalog-trust <file>`      | Catalog signer rotation and revocation trust store        |
| `--no-official-plugin-catalog`       | Disable the default signed DockScope catalog              |

## Environment variables

| Variable                      | Default                 | Purpose                                                      |
| ----------------------------- | ----------------------- | ------------------------------------------------------------ |
| `DOCKSCOPE_STATE_DIR`         | `~/.dockscope`          | Where all persistent state lives                             |
| `DOCKSCOPE_TOKEN`             | -                       | Full-access token. Overrides the dashboard's and hides setup |
| `DOCKSCOPE_READ_ONLY_TOKEN`   | -                       | Additional environment-only token for observational access   |
| `DOCKSCOPE_AUTH_FILE`         | `<state dir>/auth.json` | Move only the token file, leaving the rest in place          |
| `DOCKSCOPE_BIND`              | `127.0.0.1`             | Listen address                                               |
| `DOCKSCOPE_ALLOWED_ORIGINS`   | -                       | Extra browser origins allowed to reach the API and WebSocket |
| `DOCKSCOPE_AUTH_PROXY_HEADER` | -                       | Header carrying the user your identity proxy authenticated   |
| `DOCKSCOPE_TRUSTED_PROXIES`   | -                       | Addresses or CIDRs that header is believed from              |
| `DOCKSCOPE_NO_COMPOSE`        | -                       | Disable Compose project management. Set in the Docker image  |

`DOCKER_HOST` is honoured too, as the fallback for `-H, --host`.

Most plugin flags have an environment equivalent, for deployments that cannot
pass arguments:

| Variable                                    | Flag                           |
| ------------------------------------------- | ------------------------------ |
| `DOCKSCOPE_PLUGIN_PATHS`                    | `--plugins`                    |
| `DOCKSCOPE_PLUGIN_PERMISSIONS`              | `--plugin-permissions`         |
| `DOCKSCOPE_PLUGIN_SECRET_KEY`               | `--plugin-secret-key`          |
| `DOCKSCOPE_PLUGIN_CATALOG`                  | `--plugin-catalog`             |
| `DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY`       | `--plugin-catalog-public-key`  |
| `DOCKSCOPE_PLUGIN_CATALOG_TRUST`            | `--plugin-catalog-trust`       |
| `DOCKSCOPE_PLUGIN_ALLOW_UNSIGNED`           | `--allow-unsigned-plugins`     |
| `DOCKSCOPE_DISABLE_EXTERNAL_PLUGINS`        | `--no-external-plugins`        |
| `DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG` | `--no-official-plugin-catalog` |

## Where state lives

Everything persistent sits under one directory, `~/.dockscope` by default:

```text
~/.dockscope/
  auth.json              dashboard-set full-access token hash and setup state
  plugin-config.json     plugin configuration values
  plugin-state.json      which plugins are enabled
  plugin-secrets.json    plugin secrets
  plugin-approvals.json  approved plugin fingerprints
  plugin-events.json     plugin event history
  catalogs.json          user-added catalogs and their pinned signing keys
  plugins/               installed plugin packages
```

`DOCKSCOPE_STATE_DIR` moves all of it at once. This is the one that matters in a
container: the published image sets it to `/data` and declares that a volume, so

```bash
-v dockscope-data:/data
```

is what keeps a dashboard-set full-access token and installed plugins across
restarts. `DOCKSCOPE_READ_ONLY_TOKEN` is environment-only and is never written
to this volume.

Without that volume the state sits in the container's writable layer, which goes
away whenever the container is recreated rather than merely restarted: an image
update, `docker compose down`, `docker rm`, or `docker run --rm`. The instance
then comes back unclaimed and offers first-run setup again, so anyone who can
reach it could claim it.

## Access control

Two independent layers. [SECURITY.md](../.github/SECURITY.md) explains the
threat model; this is the operational summary.

**Origin checks** are always on. Browsers cannot reach DockScope cross-origin,
so a website you visit cannot drive your Docker daemon. Behind a reverse proxy
or a custom domain, list the browser-facing origins:

```bash
DOCKSCOPE_ALLOWED_ORIGINS=https://dock.example.com
```

**Access tokens** stop everything that is not a browser: curl, a script, or
another host on the network. Authentication is optional and off by default,
since the default bind is loopback. Authenticated requests have one of two
roles:

| Role       | Access                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `operator` | Every observation workflow plus workload actions, exec, connection and plugin administration, configuration and secret writes |
| `reader`   | Graph, stats, logs, inspect, history, diagnostics, systems, health and other observation workflows                            |

Readers receive `403` from mutation and exec operations. Plugin commands are
operator-only until the plugin contract can declare their effects. Catalog
preview is also operator-only because it makes an outbound request to a
user-supplied location.

Set it from the dashboard, which offers on first load and keeps a **Security**
button in the status bar to change or remove it later. Or pin it in the
environment, which overrides the stored one and hides the setup screen:

```bash
-e DOCKSCOPE_TOKEN="$(openssl rand -hex 32)"
```

Add a distinct, environment-only reader token when you want to share a view:

```bash
-e DOCKSCOPE_TOKEN="$(openssl rand -hex 32)" \
-e DOCKSCOPE_READ_ONLY_TOKEN="$(openssl rand -hex 32)"
```

For Compose, require both secrets from the deployment environment rather than
committing them:

```yaml
environment:
  DOCKSCOPE_TOKEN: '${DOCKSCOPE_TOKEN:?set a full-access token}'
  DOCKSCOPE_READ_ONLY_TOKEN: '${DOCKSCOPE_READ_ONLY_TOKEN:?set a distinct read-only token}'
```

`DOCKSCOPE_READ_ONLY_TOKEN` is additive and requires either
`DOCKSCOPE_TOKEN` or a dashboard-stored full-access token. DockScope refuses to
start when the reader token is configured alone. `DOCKSCOPE_TOKEN` wins over a
stored operator token. If both environment values are identical, that value is
an operator token. Remove the reader variable before removing a dashboard-set
operator token. Trusted reverse-proxy users are operators; mapping proxy groups
to roles is not supported yet.

Browsers get a session cookie once unlocked. Scripts send a header:

```bash
curl -H "Authorization: Bearer $DOCKSCOPE_TOKEN" localhost:4681/api/graph
```

Use `$DOCKSCOPE_READ_ONLY_TOKEN` for scripts that only observe. A mutation with
that credential returns `403 {"error":"Operator access required"}`.

**Reverse proxy authentication** hands the job to an identity provider you
already run:

```bash
-e DOCKSCOPE_AUTH_PROXY_HEADER=Remote-User \
-e DOCKSCOPE_TRUSTED_PROXIES=172.18.0.0/16
```

The header is only believed when the connection came from one of those
addresses. Setting this makes authentication mandatory: requests that go around
the proxy are refused even with no token configured. Keep the port unpublished
so the proxy is the only way in.

Two limits worth knowing. Failed attempts are rate limited per source: 10
failures, then a 5 minute lockout. And an instance reachable over the network
can only be claimed through the setup screen during the first 15 minutes after
startup, so nobody can claim one you left running. From the machine itself there
is no time limit. If the window closes, restart or set `DOCKSCOPE_TOKEN`.

## Plugin file locations

Each plugin store defaults to a file inside the state directory and can be
redirected individually, by flag or by environment variable:

| File                    | Flag                 | Variable                     |
| ----------------------- | -------------------- | ---------------------------- |
| `plugin-config.json`    | `--plugin-config`    | `DOCKSCOPE_PLUGIN_CONFIG`    |
| `plugin-state.json`     | `--plugin-state`     | `DOCKSCOPE_PLUGIN_STATE`     |
| `plugin-secrets.json`   | `--plugin-secrets`   | `DOCKSCOPE_PLUGIN_SECRETS`   |
| `plugin-approvals.json` | `--plugin-approvals` | `DOCKSCOPE_PLUGIN_APPROVALS` |
| `plugin-events.json`    | `--plugin-events`    | `DOCKSCOPE_PLUGIN_EVENTS`    |
| `catalogs.json`         | -                    | `DOCKSCOPE_PLUGIN_CATALOGS`  |
| `plugins/`              | `--plugin-registry`  | `DOCKSCOPE_PLUGIN_REGISTRY`  |

Setting `DOCKSCOPE_STATE_DIR` is usually enough; these exist for deployments
that need to split state across mounts.

Two similar names worth keeping apart: `DOCKSCOPE_PLUGIN_CATALOGS` is the file
above, holding catalogs you trusted from the UI. `DOCKSCOPE_PLUGIN_CATALOG`
(singular) is the `--plugin-catalog` flag's variable, listing extra catalog
sources to read at startup.
