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
- [Features](#features)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [API](#api)
- [Development](#development)
- [Tech Stack](#tech-stack)
- [Contributing](#contributing)

## Quick Start

> **Prerequisites:** [Node.js](https://nodejs.org/) (v20+) and [Docker](https://docs.docker.com/get-docker/) must be installed and running. Kubernetes support is provided by the official external Kubernetes plugin.

```bash
npx dockscope up
```

Or install globally:

```bash
npm install -g dockscope
dockscope up
```

### Docker (no Node.js needed)

```bash
docker run --rm --pull always -p 4681:4681 -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/manuelr-t/dockscope
```

> **Note:** The Docker image does not include Compose project management (up/down/destroy) since it cannot access host compose files. All other features work normally.

> **Security:** Mounting `/var/run/docker.sock` gives DockScope control over the host Docker daemon, including container actions and exec access. Only run it on trusted machines and networks.

Opens `http://localhost:4681`.

| Option                               | Default     | Description                                                            |
| ------------------------------------ | ----------- | ---------------------------------------------------------------------- |
| `-p, --port <port>`                  | `4681`      | Server port (auto-increments if in use)                                |
| `-b, --bind <address>`               | `127.0.0.1` | Listen address (`0.0.0.0` inside a container, or set `DOCKSCOPE_BIND`) |
| `--no-open`                          | —           | Don't open browser                                                     |
| `--plugins <paths>`                  | —           | Load external plugins from a path-list                                 |
| `--plugin-permissions <permissions>` | —           | Allowed external plugin permissions (`all` or comma-separated)         |
| `--plugin-config <file>`             | —           | Plugin configuration JSON file                                         |
| `--plugin-state <file>`              | —           | Plugin enabled/disabled state JSON file                                |
| `--plugin-secrets <file>`            | —           | Plugin secrets JSON file                                               |
| `--plugin-secret-key <key>`          | —           | Encrypt plugin secrets with a local key                                |
| `--plugin-events <file>`             | —           | Plugin event history JSON file                                         |
| `--plugin-approvals <file>`          | —           | Plugin approval JSON file                                              |
| `--plugin-catalog <source>`          | —           | Plugin catalog JSON file or URL                                        |
| `--plugin-catalog-public-key <file>` | —           | Verify the configured plugin catalog signature                         |
| `--plugin-catalog-trust <file>`      | —           | Catalog signer rotation and revocation trust store                     |
| `--no-official-plugin-catalog`       | —           | Disable the default signed DockScope catalog                           |
| `--plugin-registry <dir>`            | `~/.dockscope/plugins` | Local plugin registry directory                              |
| `--allow-unsigned-plugins`           | —           | Allow unsigned catalog entries for local marketplace development        |
| `--no-external-plugins`              | —           | Disable external plugin loading                                        |
| `dockscope scan`                     | —           | Output graph as JSON (no UI)                                           |
| `dockscope plugin:init`              | —           | Scaffold a plugin directory                                            |
| `dockscope plugin:keys`              | —           | Generate Ed25519 plugin package signing keys                           |
| `dockscope plugin:validate`          | —           | Validate external plugin manifests                                     |
| `dockscope plugin:test`              | —           | Validate and import external plugins                                   |
| `dockscope plugin:dev`               | —           | Run DockScope with local plugin development defaults                   |
| `dockscope plugin:doctor`            | —           | Check plugin paths and catalog configuration                           |
| `dockscope plugin:pack`              | —           | Create a hash-verified plugin package                                  |
| `dockscope plugin:install`           | —           | Install a directory or package into the local plugin registry           |
| `dockscope plugin:catalog`           | —           | List plugins from a catalog                                            |
| `dockscope plugin:catalog:entry`     | —           | Generate a catalog entry from a signed package                         |
| `dockscope plugin:catalog:sign`      | —           | Sign a catalog JSON file                                               |
| `dockscope plugin:catalog:install`   | —           | Install a signed package from a catalog                                |

## Features

- **3D Force Graph** — Containers as interactive spheres, color-coded by health/status, with `depends_on` arrows and network links. Node size scales by importance (ports, connections, CPU, memory, I/O). Compose projects grouped with enclosure spheres.
- **Live Monitoring** — CPU, memory, network I/O polled every 3s with 5-minute sparkline history. Real-time Docker event stream.
- **Anomaly Detection** — CPU/memory spikes flagged using IQR-based outlier detection. Pulsing indicator on graph nodes, toast notification, and dismissable sidebar alert.
- **Crash Diagnostics** — When a container dies, auto-analyzes exit code, OOM status, and last log lines to surface the likely cause. Diagnostic card shown in the sidebar.
- **Dependency Impact View** — Select a node and toggle impact mode (`I` key) to highlight everything that would break if it goes down. Traverses `depends_on` upstream and dims unaffected nodes.
- **Container Actions** — Start, stop, restart, pause, unpause, kill, remove — directly from the sidebar with confirmation dialogs for destructive actions.
- **Log Streaming** — Live logs with ANSI color support, in-log search, and export to `.txt`.
- **Interactive Terminal** — Shell access (`/bin/sh`) via xterm.js embedded in the sidebar.
- **Compose Manager** — Up, down, stop, restart, destroy entire projects. Cached metadata survives `docker compose down`.
- **Container Inspection** — Env vars (secrets auto-masked), labels, mounts, processes, filesystem diff — all in sidebar tabs.
- **Search & Filters** — Real-time search by name/image, status filters (running/stopped/unhealthy), network color toggle.
- **Session Recording & Replay** — Record an incident (graph state, events, metrics over time) with the `REC` button in the status bar; stopping saves it as a JSON file. Replay it in place or load a recording file (upload button) on any DockScope instance, with a timeline scrubber, event markers, play/pause (`Space`), and 1–8× playback speed for postmortem analysis. During replay, live updates pause and container actions are disabled.
- **Snapshot Export** — Export the current graph view from the toolbar (bottom-left) as a PNG (exact render) or SVG (vector projection with labels, dependency arrows, and a status legend) for documentation and READMEs. Both respect active search/status filters.
- **Kubernetes Plugin** — The official external Kubernetes plugin renders Pods, Services, Ingresses, and HPAs alongside Docker resources, with Pod logs, restart/delete actions, and HPA replica controls through `kubectl`.
- **Plugin Marketplace** — The signed official catalog is enabled by default; plugins can be installed, updated, and removed with a pre-install review of signature, package hash, permissions, compatibility, and release notes.
- **Plugin Runtime Isolation** — External plugins run in child processes with operation timeouts, memory limits, health telemetry, crash recovery, and automatic quarantine after repeated crashes.

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

## API

| Method | Path                                  | Description                                                        |
| ------ | ------------------------------------- | ------------------------------------------------------------------ |
| GET    | `/api/graph`                          | Full graph (nodes + links)                                         |
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

## Development

```bash
git clone https://github.com/ManuelR-T/dockscope.git
cd dockscope
npm install
npm run dev    # Starts on port 4681 with Vite HMR
```

| Command             | Description                              |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | Dev server (backend + frontend with HMR) |
| `npm run build`     | Production build                         |
| `npm run start`     | Run production build                     |
| `npm test`          | Run unit tests (vitest)                  |
| `npm run lint`      | ESLint check                             |
| `npm run format`    | Prettier format                          |
| `npm run typecheck` | TypeScript check (tsc + svelte-check)    |
| `npm run plugins:catalog` | Build packages and catalog for official plugins |

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
