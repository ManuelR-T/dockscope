# DockScope

**Visual, interactive Docker infrastructure debugger.**

A browser-based 3D dependency graph of your Docker services with live health status, log streams, metrics, and container actions. Think of it as a mission control dashboard for your Docker Compose stacks.

## Features

- **3D Force Graph** — Containers rendered as interactive nodes with dependency and network links
- **Live Health Status** — Real-time container state with color-coded nodes (healthy, unhealthy, stopped)
- **Log Streaming** — Live container logs with ANSI color support, timestamp shortening, and search
- **Container Actions** — Start, stop, restart containers directly from the UI
- **Compose Project Management** — Up, down, stop, restart entire compose projects
- **Environment Inspector** — View env vars (with secret masking), labels, mounts, and config
- **Metrics & Sparklines** — CPU, memory, and network I/O with 5-minute history charts
- **Node Importance Heuristic** — Nodes sized by exposed ports, connections, dependency depth, CPU, memory, network I/O, and network count
- **Project Clustering** — Compose projects grouped with translucent enclosure spheres and labels
- **Health Propagation** — Pulsing warning rings on containers whose dependencies are broken
- **Search & Filter** — Search by name/image, filter by status (running/stopped/unhealthy)
- **Keyboard Shortcuts** — `/` search, `F` zoom-to-fit, `R` reset camera, `Esc` close, `?` help
- **Resizable Panels** — Drag to resize sidebar and status bar
- **Event Stream** — Live Docker events with health check toggle
- **System Info** — Docker version, CPU count, total memory

## Quick Start

```bash
npx dockscope up
```

Or install globally:

```bash
npm install -g dockscope
dockscope up
```

Requires Docker to be running. Opens a browser at `http://localhost:4681`.

### Options

```
dockscope up [options]

  -p, --port <port>   Server port (default: 4681)
  -f, --file <path>   Docker Compose file path (default: auto-detect)
  --no-open           Don't open browser automatically
```

### Scan Mode

Output the container graph as JSON (no UI):

```bash
dockscope scan
```

## Development

```bash
git clone https://github.com/ManuelR-T/dockscope.git
cd dockscope
npm install
npm run dev
```

This starts the backend on port `4681` and the Vite dev server on port `4680` with hot reload.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (backend + frontend with HMR) |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint check |
| `npm run lint:fix` | ESLint auto-fix |
| `npm run format` | Prettier format all files |
| `npm run format:check` | Prettier check |
| `npm run typecheck` | TypeScript type check |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Svelte 5 (runes), Three.js, 3d-force-graph, three-spritetext |
| **Backend** | Express, WebSocket (ws), dockerode |
| **Build** | Vite, TypeScript (ESNext) |
| **CLI** | Commander |
| **Linting** | ESLint, Prettier, commitlint (conventional commits) |
| **CI/CD** | GitHub Actions (lint, typecheck, build, auto-release to npm) |

## Architecture

```
Docker daemon
  |
  +--> dockerode (client.ts, metrics.ts, logs.ts, links.ts)
  |      |
  |      +--> Express REST API (routes.ts)
  |      +--> WebSocket broadcasts (server/index.ts)
  |             |
  |             +--> Svelte 5 store (docker.svelte.ts)
  |                    |
  |                    +--> GraphView.svelte (3d-force-graph + Three.js)
  |                    +--> Sidebar (Info / Env / Logs tabs)
  |                    +--> StatusBar (event stream + system info)
  |
  +--> Compose parser (compose.ts)
         |
         +--> depends_on + network link extraction
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/graph` | Full graph data (nodes + links) |
| GET | `/api/containers/:id/stats` | CPU, memory, network I/O |
| GET | `/api/containers/:id/logs` | Container logs |
| GET | `/api/containers/:id/inspect` | Env, labels, mounts, config |
| GET | `/api/containers/:id/history` | Metric history (sparkline data) |
| POST | `/api/containers/:id/start\|stop\|restart` | Container actions |
| GET | `/api/projects` | List compose projects |
| POST | `/api/projects/:name/up\|down\|stop\|start\|restart` | Project actions |
| GET | `/api/system` | Docker version, CPUs, memory |
| WS | `/ws` | Real-time graph, stats, events, log streaming |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` or `Ctrl+K` | Focus search |
| `Escape` | Close panel / clear search |
| `F` | Zoom to fit |
| `R` | Reset camera |
| `?` | Toggle shortcut help |

## Contributing

This project uses [Conventional Commits](https://www.conventionalcommits.org/). All commit messages must follow the format:

```
type(scope): description

feat: add new feature
fix: fix a bug
docs: update documentation
refactor: code restructuring
chore: maintenance tasks
```

### Setup

1. Fork the repo on GitHub
2. Clone your fork: `git clone https://github.com/<your-username>/dockscope.git`
3. `npm install`
4. Create a branch: `git checkout -b feat/my-feature`
5. `npm run dev` to start development
6. Make your changes
7. `npm run lint && npm run format:check && npm run build` to verify
8. Commit with conventional messages: `git commit -m "feat: add my feature"`
9. Push to your fork: `git push origin feat/my-feature`
10. Open a PR against `main` on the upstream repo

## License

[MIT](LICENSE)
