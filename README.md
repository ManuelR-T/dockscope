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

> **Prerequisites:** [Node.js](https://nodejs.org/) (v18+) and [Docker](https://docs.docker.com/get-docker/) must be installed and running.

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

Opens `http://localhost:4681`.

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <port>` | `4681` | Server port (auto-increments if in use) |
| `--no-open` | — | Don't open browser |
| `dockscope scan` | — | Output graph as JSON (no UI) |

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

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` or `Ctrl+K` | Focus search |
| `Escape` | Close panel / clear search |
| `F` | Zoom to fit |
| `R` | Reset camera |
| `C` | Center on selected node |
| `I` | Toggle impact view |
| `?` | Show shortcut help |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/graph` | Full graph (nodes + links) |
| GET | `/api/containers/:id/stats` | CPU, memory, network I/O |
| GET | `/api/containers/:id/logs?tail=N` | Logs (default 200 lines) |
| GET | `/api/containers/:id/inspect` | Env, labels, mounts, config |
| GET | `/api/containers/:id/history` | Metric sparkline data |
| GET | `/api/containers/:id/top` | Running processes |
| GET | `/api/containers/:id/diff` | Filesystem changes |
| GET | `/api/containers/:id/diagnostic` | Crash diagnostic analysis |
| POST | `/api/containers/:id/{action}` | start, stop, restart, pause, unpause, kill |
| DELETE | `/api/containers/:id?volumes=true` | Remove container |
| GET | `/api/projects` | List compose projects |
| POST | `/api/projects/:name/{action}` | up, down, stop, start, restart, destroy |
| GET | `/api/system` | Docker version, CPUs, memory |
| GET | `/api/health` | Docker connectivity check |
| GET | `/api/version` | Current + latest version |
| WS | `/ws` | Real-time graph, stats, events, logs, exec, anomalies, diagnostics |

## Development

```bash
git clone https://github.com/ManuelR-T/dockscope.git
cd dockscope
npm install
npm run dev    # Starts on port 4681 with Vite HMR
```

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server (backend + frontend with HMR) |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm test` | Run unit tests (vitest) |
| `npm run lint` | ESLint check |
| `npm run format` | Prettier format |
| `npm run typecheck` | TypeScript check |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Svelte 5, Three.js, 3d-force-graph, xterm.js |
| **Backend** | Express, WebSocket (ws), dockerode |
| **Build** | Vite, TypeScript |
| **Testing** | Vitest |
| **CLI** | Commander |
| **CI/CD** | GitHub Actions, commitlint, ESLint, Prettier |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
