# DockScope

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
docker run --rm -p 4681:4681 -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/manuelrt/dockscope
```

Opens `http://localhost:4681`.

| Command | Description |
| ------- | ----------- |
| `dockscope up` | Start the dashboard |
| `dockscope scan` | Output graph data as JSON (no UI) |
| `dockscope --version` | Show version |

| Option | Default | Description |
| ------ | ------- | ----------- |
| `-p, --port <port>` | `4681` | Server port (auto-increments if in use) |
| `--no-open` | — | Don't open browser |
| `dockscope scan` | — | Output graph as JSON (no UI) |

## Features

- **3D Force Graph** — Containers as interactive spheres, color-coded by health/status, with `depends_on` arrows and network links. Node size scales by importance (ports, connections, CPU, memory, I/O). Compose projects grouped with enclosure spheres.
- **Live Monitoring** — CPU, memory, network I/O polled every 3s with 5-minute sparkline history. Real-time Docker event stream.
- **Container Actions** — Start, stop, restart, pause, unpause, kill, remove — directly from the sidebar with confirmation dialogs for destructive actions.
- **Log Streaming** — Live logs with ANSI color support, in-log search, and export to `.txt`.
- **Interactive Terminal** — Shell access (`/bin/sh`) via xterm.js embedded in the sidebar.
- **Compose Manager** — Up, down, stop, restart, destroy entire projects. Cached metadata survives `docker compose down`.
- **Container Inspection** — Env vars (secrets auto-masked), labels, mounts, processes, filesystem diff — all in sidebar tabs.
- **Search & Filters** — Real-time search by name/image, status filters (running/stopped/unhealthy), network color toggle.

## Keyboard Shortcuts

| Key | Action |
| --- | ------ |
| `/` or `Ctrl+K` | Focus search |
| `Escape` | Close panel / clear search |
| `F` | Zoom to fit |
| `R` | Reset camera |
| `C` | Center on selected node |
| `?` | Show shortcut help |

## API

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/graph` | Full graph (nodes + links) |
| GET | `/api/containers/:id/stats` | CPU, memory, network I/O |
| GET | `/api/containers/:id/logs?tail=N` | Logs (default 200 lines) |
| GET | `/api/containers/:id/inspect` | Env, labels, mounts, config |
| GET | `/api/containers/:id/history` | Metric sparkline data |
| GET | `/api/containers/:id/top` | Running processes |
| GET | `/api/containers/:id/diff` | Filesystem changes |
| POST | `/api/containers/:id/{action}` | start, stop, restart, pause, unpause, kill |
| DELETE | `/api/containers/:id?volumes=true` | Remove container |
| GET | `/api/projects` | List compose projects |
| POST | `/api/projects/:name/{action}` | up, down, stop, start, restart, destroy |
| GET | `/api/system` | Docker version, CPUs, memory |
| GET | `/api/health` | Docker connectivity check |
| WS | `/ws` | Real-time graph, stats, events, logs, exec |

## Development

```bash
git clone https://github.com/ManuelR-T/dockscope.git
cd dockscope
npm install
npm run dev    # Starts on port 4681 with Vite HMR
```

| Command | Description |
| ------- | ----------- |
| `npm run dev` | Dev server (backend + frontend with HMR) |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint check |
| `npm run format` | Prettier format |
| `npm run typecheck` | TypeScript check |

## Tech Stack

| Layer | Technology |
| ----- | --------- |
| **Frontend** | Svelte 5, Three.js, 3d-force-graph, xterm.js |
| **Backend** | Express, WebSocket (ws), dockerode |
| **Build** | Vite, TypeScript |
| **CLI** | Commander |
| **CI/CD** | GitHub Actions, commitlint, ESLint, Prettier |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
