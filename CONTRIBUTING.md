# Contributing to DockScope

Thanks for your interest in contributing! Here's how to get started.

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/). All commit messages must follow the format:

```
type(scope): description

feat: add new feature
fix: fix a bug
docs: update documentation
refactor: code restructuring
chore: maintenance tasks
```

Commits are validated by commitlint in CI. Non-conforming commits will fail the pipeline.

## Setup

1. Fork the repo on GitHub
2. Clone your fork: `git clone https://github.com/ManuelR-T/dockscope.git`
3. `npm install`
4. Create a branch: `git checkout -b feat/my-feature`
5. `npm run dev` to start development (port 4681)
6. Make your changes
7. Verify: `npm run lint && npm run format:check && npm run build`
8. Commit: `git commit -m "feat: add my feature"`
9. Push to your fork: `git push origin feat/my-feature`
10. Open a PR against `main` on the upstream repo

## Scripts

| Command | Description |
| ------- | ----------- |
| `npm run dev` | Start dev server with HMR |
| `npm run build` | Production build |
| `npm run lint` | ESLint check |
| `npm run lint:fix` | ESLint auto-fix |
| `npm run format` | Prettier format |
| `npm run format:check` | Prettier check |
| `npm run typecheck` | TypeScript check |

## Architecture

The codebase is split into small, focused modules. Key directories:

- `src/docker/` — Docker API integration (client, logs, metrics, links, compose parser)
- `src/server/` — Express server + WebSocket + REST routes
- `src/web/components/` — Svelte 5 UI components
- `src/web/lib/` — Shared utilities (formatting, constants, node rendering, clustering, animations)
- `src/web/stores/` — Reactive state (docker data, toast notifications)

## CI Checks

Every PR must pass:

- **Commit Messages** — conventional commits
- **Lint & Format** — ESLint + Prettier
- **Typecheck** — `tsc --noEmit`
- **Build** — full production build

## Reporting Bugs

Use the [Bug Report](https://github.com/ManuelR-T/dockscope/issues/new?template=bug_report.yml) template.

## Requesting Features

Use the [Feature Request](https://github.com/ManuelR-T/dockscope/issues/new?template=feature_request.yml) template.

## Security

See [SECURITY.md](.github/SECURITY.md) for vulnerability reporting.
