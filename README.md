# DockScope

[![npm version](https://img.shields.io/npm/v/dockscope?color=cb3837&logo=npm)](https://www.npmjs.com/package/dockscope)
[![Docker Image](https://img.shields.io/badge/ghcr.io-dockscope-blue?logo=docker)](https://github.com/ManuelR-T/dockscope/pkgs/container/dockscope)
[![CI](https://img.shields.io/github/actions/workflow/status/ManuelR-T/dockscope/ci.yml?branch=main&label=CI&logo=github)](https://github.com/ManuelR-T/dockscope/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/dockscope?color=417e38&logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**Visual, interactive Docker infrastructure debugger.**

A browser-based 3D dependency graph of your Docker services with live health, logs, metrics, and container actions. Mission control for your Docker Compose stacks.

![DockScope demo](assets/demo.gif)

## Table of Contents

- [Quick Start](#quick-start)
- [CLI](#cli)
- [What you can do with it](#what-you-can-do-with-it)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Plugins](#plugins)
- [Development](#development)
- [API](#api)
- [Tech Stack](#tech-stack)
- [Contributing](#contributing)

## Quick Start

> **Prerequisites:** [Node.js](https://nodejs.org/) (v20+) and [Docker](https://docs.docker.com/get-docker/) must be installed and running. Kubernetes support is provided by the official external Kubernetes plugin.

```bash
npx dockscope up
```

Opens `http://localhost:4681`.

Or install globally:

```bash
npm install -g dockscope
dockscope up
```

### Docker (no Node.js needed)

```bash
docker run --rm --pull always -p 4681:4681 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v dockscope-data:/data \
  ghcr.io/manuelr-t/dockscope
```

> `-v dockscope-data:/data` keeps the access token (and other state) across restarts. Without it, `--rm` throws it away and the instance is claimable again every time it starts.

> **Note:** The Docker image does not include Compose project management (up/down/destroy) since it cannot access host compose files. All other features work normally.

> **Security:** Mounting `/var/run/docker.sock` gives DockScope control over the host Docker daemon, including container actions and exec access. Only run it on trusted machines and networks.
>
> The API and WebSocket reject cross-origin browser requests, so a website you visit cannot reach a DockScope instance running on your machine. Same-origin and loopback access work out of the box. If you serve DockScope behind a reverse proxy or custom domain, list the browser-facing origins in `DOCKSCOPE_ALLOWED_ORIGINS` (comma-separated, e.g. `https://dock.example.com`).
>
> Those origin checks only stop browsers. Anything else that can reach the port (curl, a script, another host on the network) is unaffected, so an exposed instance wants an access token.
>
> **The dashboard offers to set one on first load.** Pick a token, and DockScope stores it hashed in `~/.dockscope/auth.json` and asks for it from then on. Choose "Not now" and it leaves you alone until the next reload. Nothing needs configuring up front, and the dashboard stays usable while you decide.
>
> The **Security** button in the status bar shows the current state (`OPEN`, `TOKEN` or `PROXY`) and is where you set, change or remove the token later, or turn the reminder off for good.
>
> To pin the token instead of choosing it in the browser, set `DOCKSCOPE_TOKEN`; it overrides whatever is stored and disables the setup screen:
>
> ```bash
> docker run --rm -p 4681:4681 -e DOCKSCOPE_TOKEN="$(openssl rand -hex 32)" \
>   -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/manuelr-t/dockscope
> ```
>
> The dashboard keeps a session cookie once unlocked; scripts send `Authorization: Bearer <token>`. While no token is set there is no authentication at all, and DockScope warns at startup if it is exposed that way.
>
> One limit worth knowing: an instance reachable over the network can only be claimed through the setup screen during the **first 15 minutes** after it starts. Otherwise anyone who found an exposed, unconfigured instance could claim it and lock you out. From the machine running DockScope there is no time limit. If the window closes, restart it or set `DOCKSCOPE_TOKEN`.
>
> **Already have SSO?** If you run an identity proxy (Authelia, Authentik, oauth2-proxy, Cloudflare Access), let DockScope inherit it instead of managing a second secret. Point it at the header your proxy sets and at the addresses it comes from:
>
> ```bash
> -e DOCKSCOPE_AUTH_PROXY_HEADER=Remote-User \
> -e DOCKSCOPE_TRUSTED_PROXIES=172.18.0.0/16
> ```
>
> The header is only believed when the connection came from one of those addresses, so it cannot be spoofed by someone reaching the port directly. Setting this makes authentication mandatory: requests that go around the proxy are refused even with no token configured, and the setup screen stops appearing. Keep the port unpublished so the proxy is the only way in.
>
> Failed token attempts are rate limited per source (10 tries, then a 5 minute lockout).

## CLI

<details>
<summary><b>All <code>dockscope up</code> options</b></summary>

| Option                               | Default                | Description                                                                      |
| ------------------------------------ | ---------------------- | -------------------------------------------------------------------------------- |
| `-p, --port <port>`                  | `4681`                 | Server port (auto-increments if in use)                                          |
| `-b, --bind <address>`               | `127.0.0.1`            | Listen address (`0.0.0.0` inside a container, or set `DOCKSCOPE_BIND`)           |
| `--no-open`                          | -                      | Don't open browser                                                               |
| `--plugins <paths>`                  | -                      | Load external plugins from a path-list                                           |
| `--plugin-permissions <permissions>` | installed grants       | Add globally allowed external plugin permissions                                 |
| `--plugin-config <file>`             | -                      | Plugin configuration JSON file                                                   |
| `--plugin-state <file>`              | -                      | Plugin enabled/disabled state JSON file                                          |
| `--plugin-secrets <file>`            | -                      | Plugin secrets JSON file                                                         |
| `--plugin-secret-key <key>`          | -                      | Encrypt plugin secrets with a local key                                          |
| `--plugin-events <file>`             | -                      | Plugin event history JSON file                                                   |
| `--plugin-approvals <file>`          | -                      | Plugin approval JSON file                                                        |
| `--plugin-catalog <sources>`         | -                      | Extra plugin catalogs (comma-separated files or URLs), added to the official one |
| `--plugin-catalog-public-key <file>` | -                      | Verify the configured plugin catalog signature                                   |
| `--plugin-catalog-trust <file>`      | -                      | Catalog signer rotation and revocation trust store                               |
| `--no-official-plugin-catalog`       | -                      | Disable the default signed DockScope catalog                                     |
| `--plugin-registry <dir>`            | `~/.dockscope/plugins` | Local plugin registry directory                                                  |
| `--allow-unsigned-plugins`           | -                      | Allow unsigned catalog entries for local marketplace development                 |
| `--no-external-plugins`              | -                      | Disable external plugin loading                                                  |

`dockscope up --help` is the authoritative list.

</details>

<details>
<summary><b>Other commands</b></summary>

| Command                            | Description                                                   |
| ---------------------------------- | ------------------------------------------------------------- |
| `dockscope scan`                   | Output graph as JSON (no UI)                                  |
| `dockscope plugin:init`            | Scaffold a plugin directory                                   |
| `dockscope plugin:keys`            | Generate Ed25519 plugin package signing keys                  |
| `dockscope plugin:validate`        | Validate external plugin manifests                            |
| `dockscope plugin:test`            | Validate and import external plugins                          |
| `dockscope plugin:dev`             | Run DockScope with local plugin development defaults          |
| `dockscope plugin:doctor`          | Check plugin paths and catalog configuration                  |
| `dockscope plugin:pack`            | Create a hash-verified plugin package                         |
| `dockscope plugin:install`         | Install a directory or package into the local plugin registry |
| `dockscope plugin:catalog`         | List plugins from a catalog                                   |
| `dockscope plugin:catalog:entry`   | Generate a catalog entry from a signed package                |
| `dockscope plugin:catalog:sign`    | Sign a catalog JSON file                                      |
| `dockscope plugin:catalog:install` | Install a signed package from a catalog                       |

The `plugin:*` commands are documented in [docs/plugins.md](docs/plugins.md).

</details>

<details>
<summary><b>Environment variables</b></summary>

| Variable                      | Default                 | Purpose                                                                            |
| ----------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `DOCKSCOPE_TOKEN`             | -                       | Access token. Overrides one set in the dashboard and hides the setup screen        |
| `DOCKSCOPE_STATE_DIR`         | `~/.dockscope`          | Where all persistent state lives: token, plugin config, secrets, installed plugins |
| `DOCKSCOPE_AUTH_FILE`         | `<state dir>/auth.json` | Move just the token file, leaving the rest in place                                |
| `DOCKSCOPE_BIND`              | `127.0.0.1`             | Listen address (`0.0.0.0` inside a container)                                      |
| `DOCKSCOPE_ALLOWED_ORIGINS`   | -                       | Extra browser origins allowed to reach the API and WebSocket                       |
| `DOCKSCOPE_AUTH_PROXY_HEADER` | -                       | Header carrying the user your identity proxy authenticated                         |
| `DOCKSCOPE_TRUSTED_PROXIES`   | -                       | Addresses or CIDRs that header is believed from                                    |
| `DOCKSCOPE_NO_COMPOSE`        | -                       | Disable Compose project management (set in the Docker image)                       |

`DOCKSCOPE_STATE_DIR` is the one that matters in a container: the image points it
at `/data` and declares it a volume, so mounting `-v dockscope-data:/data` is what
keeps your token and plugins across restarts.

The plugin stores can each be redirected individually with `DOCKSCOPE_PLUGIN_CONFIG`,
`DOCKSCOPE_PLUGIN_STATE`, `DOCKSCOPE_PLUGIN_SECRETS`, `DOCKSCOPE_PLUGIN_APPROVALS`,
`DOCKSCOPE_PLUGIN_EVENTS`, `DOCKSCOPE_PLUGIN_CATALOGS` and `DOCKSCOPE_PLUGIN_REGISTRY`;
see [docs/plugins.md](docs/plugins.md).

</details>

## What you can do with it

### Read the whole stack at a glance

<img src="assets/screenshots/graph.png" alt="Compose stack rendered as a 3D graph, with cache sized largest because everything depends on it" width="620">

Containers are spheres in a 3D graph, coloured by health, wired together by
`depends_on` arrows and shared networks. Size is not decorative: it scales with
how central a container is, weighing exposed ports, connections, dependency
depth, CPU, memory and network I/O. Compose projects sit in their own
enclosure, so a stack reads as one thing.

CPU, memory and network I/O are polled every three seconds and kept as a
five-minute sparkline, next to a live stream of Docker events. Search by name or
image, filter by running, stopped or unhealthy, and colour the links by network
when you need to see the wiring rather than the workload.

### A container just died. Why?

<img src="assets/screenshots/sidebar-info.png" alt="Info tab showing status, image, id, ports, networks and live CPU and memory" width="400">

DockScope reads the exit code, checks whether the kernel OOM-killed it, and
pulls the last log lines, then puts the likely cause in the sidebar instead of
making you piece it together from `docker inspect` and `docker logs`.

Spikes get caught the same way: CPU and memory are checked for outliers with an
IQR test, so a node that is misbehaving pulses on the graph and raises an alert
rather than waiting for you to go looking.

### What breaks if I take this down?

Select a node and press `I`. Everything that depends on it lights up and the
rest of the graph dims, walked from `depends_on`. Useful before a restart, and
useful when something is already broken and you want the blast radius.

### What is actually going on in there?

<img src="assets/screenshots/sidebar-exec.png" alt="Exec tab with an interactive shell running redis-cli" width="400">

Each container opens a sidebar of tabs: live logs with ANSI colour, in-log
search and `.txt` export; an interactive `/bin/sh` terminal; env vars with
secrets masked by default; labels, mounts, running processes, and the
filesystem diff against the image.

| Environment and labels                                                                                                             | Processes                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| <img src="assets/screenshots/sidebar-env.png" alt="Env tab with environment variables and Compose labels" width="330">             | <img src="assets/screenshots/sidebar-top.png" alt="Processes running inside the container" width="330"> |
| **Filesystem diff**                                                                                                                | **Logs**                                                                                                |
| <img src="assets/screenshots/sidebar-diff.png" alt="Filesystem changes against the image, added, changed and deleted" width="330"> | <img src="assets/screenshots/sidebar-logs.png" alt="Live log stream with in-log search" width="330">    |

Start, stop, restart, pause, unpause, kill and remove are there too, with a
confirmation step on the destructive ones. Whole Compose projects go up and
down from the project manager, which keeps working after `docker compose down`
because it caches the project metadata.

### Something broke last night and you missed it

Hit `REC` in the status bar and DockScope records the graph, events and metrics
over time into a JSON file. Load that file on any other DockScope instance and
replay it with a scrubber, event markers and 1-8x speed. Live updates and
container actions are disabled during replay, so a recording is safe to hand to
someone else.

For a written postmortem, the toolbar exports the current view as PNG or as SVG
with labels, dependency arrows and a status legend. Both honour whatever search
and status filters you have applied.

### It is not only Docker

Everything above is served by plugins, and the Docker source is just the
built-in one. Kubernetes ships as an official external plugin that talks to the
cluster API directly, with no `kubectl` needed. It draws Deployments,
StatefulSets, DaemonSets, Pods, Services, Ingresses and HPAs next to your
containers, attaching each pod to the controller that owns it, and gives them
the same sidebar as a container: CPU and memory from metrics-server, env and
mounts, logs as a tail or a stream, and an interactive shell. Rollout restart,
scale, HPA replica bounds and delete are all there.

A cluster that refuses part of the API still renders the part it can read, so a
read-only ServiceAccount or a pre-1.23 cluster gets a partial graph rather than
an empty one.

External plugins run in child processes with operation timeouts, memory limits
and health telemetry, and are quarantined automatically if they keep crashing.
The official catalog is signed and enabled by default, and installing anything
shows you its signature, package hash, permissions and compatibility first.

## Keyboard Shortcuts

| Key             | Action                     |
| --------------- | -------------------------- |
| `/` or `Ctrl+K` | Focus search               |
| `Escape`        | Close panel / clear search |
| `F`             | Zoom to fit                |
| `R`             | Reset camera               |
| `C`             | Center on selected node    |
| `I`             | Toggle impact view         |
| `Space`         | Play / pause replay        |
| `?`             | Show shortcut help         |

## Plugins

DockScope is extensible through a typed plugin system. Plugins can contribute graph data, metrics, logs, lifecycle actions, UI panels, and commands. Kubernetes support ships as an official external plugin.

Scaffold a plugin and run it, with no build step:

```bash
dockscope plugin:init --dir ./my-plugin --id acme.hello --name "Acme Hello"
dockscope plugin:dev --plugins ./my-plugin
```

See **[docs/plugins.md](docs/plugins.md)** for the full guide, starting with [Your First Plugin](docs/plugins.md#your-first-plugin). It covers the manifest schema, data providers, UI extensions, process isolation, permissions, packaging, signing, and catalog distribution.

## Development

```bash
git clone https://github.com/ManuelR-T/dockscope.git
cd dockscope
npm install
npm run dev    # Starts on port 4681 with Vite HMR
```

| Command                   | Description                                     |
| ------------------------- | ----------------------------------------------- |
| `npm run dev`             | Dev server (backend + frontend with HMR)        |
| `npm run build`           | Production build                                |
| `npm run start`           | Run production build                            |
| `npm test`                | Run unit tests (vitest)                         |
| `npm run lint`            | ESLint check                                    |
| `npm run format`          | Prettier format                                 |
| `npm run typecheck`       | TypeScript check (tsc + svelte-check)           |
| `npm run plugins:catalog` | Build packages and catalog for official plugins |

## API

Everything the dashboard does is available over HTTP, and the UI is just a
client of it.

```bash
curl -s localhost:4681/api/graph | jq '.nodes[].name'
```

The full endpoint reference, including the `/ws` message types, lives in
**[docs/api.md](docs/api.md)**.

## Tech Stack

| Layer        | Technology                                   |
| ------------ | -------------------------------------------- |
| **Frontend** | Svelte 5, Three.js, 3d-force-graph, xterm.js |
| **Backend**  | Express, WebSocket (ws), dockerode           |
| **Build**    | Vite, TypeScript                             |
| **Testing**  | Vitest                                       |
| **CLI**      | Commander                                    |
| **CI/CD**    | GitHub Actions, commitlint, ESLint, Prettier |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
