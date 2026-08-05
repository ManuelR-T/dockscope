# Contributing to DockScope

Thanks for your interest in contributing! Here's how to get started.

## What to work on

**If you want something small to start with**, these are labelled
[good first issue][gfi]. They are self-contained, and each one builds on code
that already exists:

| Issue                              | Why it is approachable                                              |
| ---------------------------------- | ------------------------------------------------------------------- |
| [#23 Theme support][23]            | The CSS token layer in `src/web/App.css` is already the seam for it |
| [#39 Cleanup panel][39]            | Mirrors patterns the sidebar tabs already use                       |
| [#44 Replay to GIF][44]            | Canvas capture already exists in `src/web/lib/snapshot.ts`          |

**If you want something meatier**, [help wanted][hw] marks the issues that are
open and specified enough to start on. [ROADMAP.md](ROADMAP.md) groups
everything by theme if you would rather pick a direction than an issue.

**If you found a bug**, a report is a real contribution. Use the
[bug report][bug] template.

**If you want DockScope to talk to something it does not**, that is a plugin
rather than a core change. Start at [Your First Plugin](docs/plugins.md#your-first-plugin).

Two things worth knowing before you start:

- **Comment on the issue first.** Nothing is assigned, so a quick "taking this"
  stops two people building the same thing.
- **Small PRs get reviewed faster.** If a change touches the graph rendering,
  the plugin contract and the server at once, it is probably several PRs.

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/). All commit messages must follow the format:

```
type(scope): description

feat: gate the API behind an optional access token
fix: repair pod log lookup
docs: document the auth endpoints
refactor: code restructuring
chore: maintenance tasks
```

Commits are validated by commitlint in CI. Non-conforming commits will fail the pipeline.

Write the title as what the change does to the system. "add", "update" and
"change" describe every commit ever written, so they say nothing that
distinguishes yours in a log.

## Setup

1. Fork the repo on GitHub
2. Clone your fork: `git clone https://github.com/ManuelR-T/dockscope.git`
3. `npm install`
4. Create a branch: `git checkout -b feat/my-feature`
5. `npm run dev` to start development (port 4681)
6. Make your changes
7. Verify: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run build`
8. Commit: `git commit -m "feat: describe what your change does"`
9. Push to your fork: `git push origin feat/my-feature`
10. Open a PR against `main` on the upstream repo

## Scripts

| Command                | Description                           |
| ---------------------- | ------------------------------------- |
| `npm run dev`          | Start dev server with HMR             |
| `npm run build`        | Production build                      |
| `npm test`             | Unit tests (vitest)                   |
| `npm run lint`         | ESLint check                          |
| `npm run lint:fix`     | ESLint auto-fix                       |
| `npm run format`       | Prettier format                       |
| `npm run format:check` | Prettier check                        |
| `npm run typecheck`    | TypeScript check (tsc + svelte-check) |

## Architecture

The codebase is split into small, focused modules. Key directories:

- `src/docker/` — Docker API integration (client, logs, metrics, links, compose parser)
- `src/server/` — Express server, WebSocket, REST routes, access control
- `src/core/` — Plugin contract: registry, capabilities, entity model. No I/O
- `src/plugins/` — Plugin loader, process sandbox, packaging, catalog, marketplace
- `src/web/components/` — Svelte 5 UI components, with shared primitives in `ui/`
- `src/web/lib/` — Shared utilities (formatting, constants, node rendering, clustering, animations, tooltips)
- `src/web/stores/` — Reactive state (graph data, auth, recording, toasts)
- `plugins/official/` — Official external plugins, packaged like any third-party one

## Writing a Plugin

Most integrations belong in a plugin rather than in core. Start with [Your First Plugin](docs/plugins.md#your-first-plugin), then [Publishing](docs/plugin-publishing.md) when you want to share it.

```bash
dockscope plugin:init --dir ./my-plugin --id acme.hello --name "Acme Hello"
dockscope plugin:dev --plugins ./my-plugin
```

## CI Checks

Every PR must pass:

- **Commit Messages** — conventional commits
- **Lint & Format** — ESLint + Prettier
- **Typecheck** — `tsc --noEmit` + svelte-check
- **Test** — vitest on Node 20, 22 and 24
- **Build** — full production build, plus the Docker image
- **Plugin Compatibility** — the SDK surface external plugins compile against

Touching `plugins/official/` additionally runs the official plugin's own
typecheck, lint and tests, an end-to-end run against a real kind cluster, and a
signed-catalog build.

## Reporting Bugs

Use the [Bug Report](https://github.com/ManuelR-T/dockscope/issues/new?template=bug_report.yml) template.

## Requesting Features

Use the [Feature Request](https://github.com/ManuelR-T/dockscope/issues/new?template=feature_request.yml) template.

## Security

See [SECURITY.md](.github/SECURITY.md) for vulnerability reporting.

[gfi]: https://github.com/ManuelR-T/dockscope/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22
[hw]: https://github.com/ManuelR-T/dockscope/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22
[bug]: https://github.com/ManuelR-T/dockscope/issues/new?template=bug_report.yml
[23]: https://github.com/ManuelR-T/dockscope/issues/23
[39]: https://github.com/ManuelR-T/dockscope/issues/39
[44]: https://github.com/ManuelR-T/dockscope/issues/44
