# Writing a DockScope Plugin

DockScope loads built-in features and external integrations through the same
typed plugin registry. A plugin declares a manifest, the capabilities it
provides, the permissions it needs, and optional providers for graph data,
metrics, logs, lifecycle actions, exec, projects, diagnostics and UI metadata.

New here? Start with [Your First Plugin](#your-first-plugin). It goes from an
empty directory to a packaged plugin in five commands.

**The other two plugin guides:**

| Guide                                          | For                                                        |
| ---------------------------------------------- | ---------------------------------------------------------- |
| [Publishing](plugin-publishing.md)             | Packaging, signing and distributing a plugin through a catalog |
| [Operating](plugin-operations.md)              | Loading, permissions policy, health and the plugin API      |

## Your First Plugin

This walkthrough goes from an empty directory to a packaged plugin using only the DockScope CLI. There is no build step and no TypeScript compilation.

### 1. Scaffold

```bash
dockscope plugin:init --dir ./my-plugin --id acme.hello --name "Acme Hello"
```

That creates a runnable command plugin. Pass `--template graph` instead to scaffold a plugin that contributes graph nodes.

| File            | Purpose                                                             |
| --------------- | ------------------------------------------------------------------- |
| `plugin.json`   | Manifest: id, version, capabilities, permissions, declared commands |
| `plugin.mjs`    | Entry module exporting the plugin factory                           |
| `jsconfig.json` | Enables `checkJs`, so editors type-check the plugin against the SDK |
| `package.json`  | Convenience `validate`, `test`, and `pack` scripts                  |
| `README.md`     | Command reference for the generated plugin                          |

The scaffold is plain JavaScript annotated with `// @ts-check` and typed through `dockscope/plugin-sdk/v1`. You get editor completion for the factory, host, and provider types without compiling anything.

### 2. Install the SDK types

```bash
cd my-plugin
npm install
```

The scaffold declares `dockscope` as a peer dependency. Installing it is what lets `// @ts-check` resolve `dockscope/plugin-sdk/v1`, so editors report real type errors instead of an unresolved import. The plugin itself runs without this step; it is purely for authoring.

### 3. Run it

```bash
dockscope plugin:dev --plugins ./my-plugin
```

`plugin:dev` starts DockScope with development defaults. It grants all plugin permissions by default, so you are not re-approving the plugin on each restart. Open the dashboard and trigger the plugin command from the plugin UI.

Use `dockscope plugin:watch --plugins ./my-plugin` to continuously revalidate the manifest while editing.

### 4. Validate and test

```bash
dockscope plugin:validate --plugins ./my-plugin --plugin-permissions all
dockscope plugin:test --plugins ./my-plugin --plugin-permissions all
```

`plugin:validate` checks the manifest without importing plugin code, which makes it fast and safe to run against untrusted sources. `plugin:test` also imports the module in a process-isolated sandbox and reports load errors. Both exit non-zero on failure, so they work directly as CI steps.

### 5. Package

```bash
dockscope plugin:pack --source ./my-plugin --out ./dist/acme.hello.dockscope-plugin
dockscope plugin:verify --package ./dist/acme.hello.dockscope-plugin
```

`plugin:pack` produces a distributable package and prints its SHA-256. Signing is optional for local installs and required for catalog distribution, covered in [Packaging and Signing](plugin-publishing.md#packaging-and-signing).

To get the plugin into someone else's DockScope, see [Publishing a plugin](plugin-publishing.md).

### Where to go next

- [Manifest](#manifest) for the full manifest schema
- [Data Providers](#data-providers) to contribute graph data, metrics, logs, or lifecycle actions
- [UI Extensions](#ui-extensions) for panels and sandboxed frontend bundles
- [Commands and Events](#commands-and-events) for command input schemas and event publishing
- [Permissions](#permissions) for the permission model and what each permission unlocks
- [Module Contract](#module-contract) for the exact factory and provider shapes
- [Process Isolation](#process-isolation) for the execution policy you declare in the manifest
- [Publishing a plugin](plugin-publishing.md) to get it into someone else's DockScope

## Manifest

Every external plugin must include `plugin.json`:

### Plugin ids and the reserved namespace

Ids follow `<publisher>.<name>`, for example `acme.hello`. Pick a publisher segment that identifies you or your organisation, and keep it stable across your plugins. Ids must match `^[a-z0-9][a-z0-9.-]*$` and are unique per registry, so a colliding id fails to load.

The `official.` prefix is **reserved for plugins published by the DockScope project**. Installing a plugin whose id starts with `official.` requires a verified package signature, so an unsigned or unverified plugin cannot present itself as first-party. Use your own publisher segment instead.

When developing a first-party plugin against an unsigned local directory, set `DOCKSCOPE_ALLOW_RESERVED_PLUGIN_NAMESPACE=1` to bypass the check. It is intended for local development only.

```json
{
  "$schema": "https://raw.githubusercontent.com/ManuelR-T/dockscope/main/schemas/plugin-manifest.schema.json",
  "id": "example.static",
  "name": "Static Example",
  "version": "1.0.0",
  "manifestVersion": "1",
  "dockscopeApiVersion": "1",
  "hostApiVersion": "1",
  "description": "Adds a static graph source",
  "entry": "./plugin.mjs",
  "capabilities": ["source.graph", "source.events", "ui.toolbarAction", "ui.settings", "ui.command"],
  "permissions": [],
  "execution": {
    "isolation": "process",
    "operationTimeoutMs": 30000,
    "maxStderrBytes": 64000,
    "memoryLimitMb": 128
  },
  "config": {
    "fields": [
      {
        "key": "enabled",
        "label": "Enabled",
        "type": "boolean",
        "default": true
      }
    ]
  },
  "ui": [
    {
      "id": "open",
      "slot": "toolbar",
      "title": "Static Example",
      "description": "Open plugin documentation",
      "action": {
        "type": "open_url",
        "url": "https://github.com/ManuelR-T/dockscope"
      }
    }
  ],
  "commands": [
    {
      "id": "refresh",
      "title": "Refresh plugin data",
      "description": "Runs a plugin-defined backend action",
      "input": {
        "fields": [
          {
            "key": "force",
            "label": "Force",
            "type": "boolean",
            "default": false
          }
        ]
      }
    }
  ],
  "compatibility": {
    "minDockscopeVersion": "0.7.1",
    "deprecations": [],
    "migrations": [
      {
        "from": "0.x",
        "to": "1.x",
        "notes": "Initial plugin API migration metadata"
      }
    ]
  }
}
```

The loader validates the manifest before importing plugin code. Plugin ids must be lowercase letters, numbers, dots, or dashes. Capability and permission names must be known to DockScope.

`manifestVersion` versions the JSON shape, `dockscopeApiVersion` versions plugin/provider contracts, and `hostApiVersion` versions permission-checked host methods. Current plugins should set all three to `"1"`. Unsupported versions fail validation before plugin code is imported.

The published schema is available as `dockscope/plugin-manifest.schema.json`. Legacy manifests that omit version fields still load as v1, but `plugin:validate` and `/api/plugins/warnings` report the compatibility assumption. `execution.commandTimeoutMs` remains accepted as a deprecated alias for `execution.operationTimeoutMs`.

Validate manifests without importing plugin code:

```bash
dockscope plugin:validate --plugins ./plugins --plugin-permissions all
```

Developer workflow commands:

```bash
dockscope plugin:init --dir ./plugins/example --id example.plugin --name "Example Plugin" --template command
dockscope plugin:init --dir ./plugins/graph --id example.graph --name "Graph Plugin" --template graph
dockscope plugin:keys --out-dir ./keys
dockscope plugin:test --plugins ./plugins --plugin-permissions all
dockscope plugin:dev --plugins ./plugins --plugin-permissions all
dockscope plugin:watch --plugins ./plugins --plugin-permissions all
dockscope plugin:doctor --plugins ./plugins --catalog ./plugin-catalog.json
dockscope plugin:catalog --catalog ./plugin-catalog.json
```

Install a plugin into the local registry:

```bash
dockscope plugin:install --source ./plugins/example
dockscope plugin:list
dockscope plugin:update example.plugin
dockscope plugin:uninstall example.plugin
dockscope plugin:catalog:install example.plugin --catalog ./plugin-catalog.json
```

Installed plugins are copied into `~/.dockscope/plugins` by default and are loaded automatically on `dockscope up`. That path, and every other plugin store, sits under `DOCKSCOPE_STATE_DIR` when it is set, which is how the Docker image keeps them on a mounted volume. Installing also grants the plugin its reviewed permissions, so installed plugins load without a `--plugin-permissions` policy (see [Permissions](#permissions)). Use `--plugin-registry` or `DOCKSCOPE_PLUGIN_REGISTRY` to point DockScope at another local registry:

```bash
dockscope up --plugin-registry ./installed-plugins
```

## Data Providers

Plugin behavior is discovered through typed provider arrays. DockScope routes operations by entity/source data and plugin ownership; the frontend does not select implementations from runtime names.

Current provider families are:

- Graph sources and source events
- Entity metrics, logs, log streams, inspection, filesystem, diagnostics, and exec
- Contextual entity actions
- Project inventory and actions
- System inventory and connection lifecycle
- Metric analysis

An entity action advertises its capability, UI placement, tone, confirmation policy, optional typed input, and expected effect. The action ID is scoped by its owning plugin ID.

```js
getActionProviders() {
  return [{
    canHandle: (ref) => ref.entityId.startsWith('workload:'),
    listActions: (ref) => [{
      id: 'scale',
      title: `Scale ${ref.context?.name ?? ref.entityId}`,
      capability: 'action.scale',
      placement: 'primary',
      input: {
        fields: [
          { key: 'replicas', label: 'Replicas', type: 'number', required: true }
        ]
      }
    }],
    async runAction(ref, actionId, input) {
      await scaleWorkload(ref.entityId, input.replicas);
      return { ok: true, message: 'Workload scaled' };
    }
  }];
}
```

`GET /api/entities/:entityId/operations` reports available provider operations. `GET /api/entities/:entityId/actions` returns contextual action descriptors, and `POST /api/entities/:entityId/actions/:pluginId/:actionId` executes one exact owner/action pair. Use `sourceId` and `nodeId` query parameters for multi-source entities.

Project rows similarly include `pluginId` and `providerId`. Pass both back when running a project action so two plugins may expose the same project name without ambiguous dispatch.

System providers use `source.system`; connection providers use `source.connections` and declare a typed connection form. Metric analyzers use `analysis.anomalies`. Every provider family is proxied through process isolation for external plugins.

`ResourceProvider` and the `/api/kubernetes/*` endpoints remain as v1 compatibility adapters. New plugins should implement `EntityLogsProvider` and `EntityActionProvider` instead.

## UI Extensions

Plugins can extend the interface with declarative descriptors or an optional sandboxed frontend bundle. Declarative content is rendered by DockScope and should be the default. A frontend bundle is appropriate only when a view needs custom interaction.

Current slots are:

- `toolbar`
- `navigation`
- `sidebar`
- `nodePanel`
- `nodeAction`
- `graphOverlay`
- `settings`

Each slot requires its matching UI capability, such as `ui.toolbarAction` for `toolbar` and `ui.nodePanel` for `nodePanel`. Entries can contain `text`, `markdown`, `metrics`, or `keyValue` data. Markdown is displayed as text rather than injected HTML. The optional `context` filter limits an entry by node runtime, kind, or status.

```json
{
  "id": "container-health",
  "slot": "nodePanel",
  "title": "Container health",
  "context": {
    "runtimes": ["docker"],
    "statuses": ["running"]
  },
  "content": {
    "type": "metrics",
    "items": [
      { "label": "Checks", "value": 12, "tone": "success" },
      { "label": "Failures", "value": 0, "tone": "neutral" }
    ]
  },
  "action": {
    "type": "run_command",
    "commandId": "refresh-health",
    "passContext": true
  }
}
```

Actions are restricted to `open_url` with an HTTP(S) URL or `run_command` against a command owned by the same plugin. `passContext` sends a sanitized node context with the command input. Browser-provided action input cannot select another plugin or command.

### Sandboxed Frontend Bundles

A custom frontend declares the `ui.frontend` capability, its single-file ESM entry, and every slot where the bundle may run:

```json
{
  "capabilities": ["ui.frontend", "ui.sidebarPanel", "ui.command"],
  "frontend": {
    "entry": "./frontend.mjs",
    "slots": ["sidebar"]
  },
  "ui": [
    {
      "id": "overview",
      "slot": "sidebar",
      "title": "Overview",
      "height": 180,
      "frontendView": "overview",
      "action": {
        "type": "run_command",
        "commandId": "refresh"
      }
    }
  ]
}
```

The entry exports `mount` or a default mount function. Bundle dependencies into this file because relative and network imports are unavailable.

```js
/** @type {import('dockscope/plugin-sdk/v1').PluginFrontendMount} */
export default function mount(api) {
  const button = document.createElement('button');
  button.textContent = `Refresh ${api.context.node?.name ?? 'plugin'}`;
  button.addEventListener('click', () => api.requestAction({ force: true }));
  api.root.append(button);
  api.resize(96);
}
```

DockScope loads the source into an iframe with an opaque origin and only `allow-scripts`. Its content security policy blocks network connections, forms, fonts, and parent DOM access. The bundle receives only a root element, view id, frozen sanitized context, bounded resize request, and the declared action bridge. Frontend source is limited to 256 KiB and is never imported into the main server process or application page.

`GET /api/plugins/:pluginId/frontend` serves an active plugin bundle. `POST /api/plugins/:pluginId/ui/:extensionId/action` invokes the server-validated action for that exact extension. Disabling, reloading, updating, or uninstalling a plugin invalidates its browser bundle cache.

## Commands and Events

Plugins can declare backend commands in the manifest and implement `runCommand(commandId, input)`. Commands require the `ui.command` capability.

Command `input` uses the same schema shape as plugin config fields. It is exposed through `GET /api/plugins/commands` so clients can render typed command forms before calling the command endpoint.

```js
export default function createPlugin({ manifest, host }) {
  return {
    manifest,
    async runCommand(commandId, input) {
      if (commandId !== 'refresh') {
        return { ok: false, message: `Unknown command: ${commandId}` };
      }
      await host.publishEvent('refresh.completed', { force: input?.force === true });
      return { ok: true, message: 'Refresh complete' };
    },
  };
}
```

`host.publishEvent(type, payload)` requires the `source.events` capability. Events are retained in memory, persisted to `~/.dockscope/plugin-events.json` by default, and exposed through the Plugin Manager and `GET /api/plugins/events`.

Event API filters:

```bash
GET /api/plugins/events?pluginId=example.plugin&type=refresh.completed&since=1780000000000&limit=100
```

## Configuration

Plugins can expose a typed config schema in `plugin.json`. DockScope persists config in `~/.dockscope/plugin-config.json` by default, or in the file passed to `--plugin-config`.

Supported field types are:

- `string`
- `number`
- `boolean`
- `select`

Plugins receive the current config in the factory context and through `configure(config)` whenever it changes.

## State

External plugins can be enabled or disabled at runtime from the Plugin Manager or API. Disabled plugins remain visible in the registry, but their providers and UI extensions are inactive and they are not started.

Plugin state is persisted in `~/.dockscope/plugin-state.json` by default or the file passed to `--plugin-state`.

## Secrets

Plugins can declare named secrets in the manifest:

```json
{
  "permissions": ["secrets.read"],
  "secrets": [
    {
      "key": "token",
      "label": "API token",
      "required": true
    }
  ]
}
```

Secret values are never returned by the API. `GET /api/plugins/secrets` only returns whether each secret is configured. Plugins read declared secrets through `host.readSecret(key)`, which requires the `secrets.read` permission.

Secrets are persisted in `~/.dockscope/plugin-secrets.json` by default or the file passed to `--plugin-secrets`. Existing plaintext values remain readable. New writes are encrypted with AES-256-GCM when `DOCKSCOPE_PLUGIN_SECRET_KEY` or `--plugin-secret-key` is set.

## Module Contract

The entry module can export a factory as `default` or `createPlugin`, or export a plugin object as `plugin`.

```js
export default function createPlugin({ manifest, config }) {
  let enabled = config.enabled !== false;
  return {
    manifest,
    configure(nextConfig) {
      enabled = nextConfig.enabled !== false;
    },
    getGraphSources() {
      if (!enabled) {
        return [];
      }
      return [
        {
          describe() {
            return {
              id: 'example-static',
              label: 'Static Example',
              kind: 'plugin',
              pluginId: manifest.id,
              capabilities: ['source.graph'],
              status: 'connected',
            };
          },
          async collectGraph() {
            const source = this.describe();
            return {
              source,
              collectedAt: Date.now(),
              graph: {
                nodes: [],
                links: [],
              },
            };
          },
        },
      ];
    },
  };
}
```

Use the versioned SDK entrypoint so a future latest SDK does not silently change the contract:

```ts
import { definePluginFactory, definePluginManifest } from 'dockscope/plugin-sdk/v1';

export const manifest = definePluginManifest({
  id: 'example.typed',
  name: 'Typed Example',
  version: '1.0.0',
  manifestVersion: '1',
  dockscopeApiVersion: '1',
  hostApiVersion: '1',
  entry: './plugin.mjs',
  capabilities: [],
  permissions: [],
});

export default definePluginFactory(({ manifest }) => ({ manifest }));
```

`dockscope/plugin-sdk` points to the latest stable contract, while `dockscope/plugin-sdk/v1` remains pinned to v1. `plugin:init` creates a `// @ts-check` JavaScript module and `jsconfig.json`, providing the same factory, host, manifest, and provider typing without requiring a compilation step.

## Permissions

External plugin code is imported only after manifest permissions pass policy checks. A permission passes when it is either in the global `--plugin-permissions` / `DOCKSCOPE_PLUGIN_PERMISSIONS` policy or was granted when the plugin was installed.

Installing a plugin is the consent step: `plugin:install` grants the manifest's declared permissions, and marketplace installs grant the permissions listed in the catalog entry, which are the ones shown in the install review dialog. The signed package capabilities and permissions must exactly match that catalog entry before registry activation. Grants are recorded in the registry's `installed.json`, apply only when both the installed plugin ID and directory match, and are removed on uninstall. Plugins loaded from `--plugins` paths were never installed, so they rely on the global policy alone; use `--plugin-permissions all` during development.

Plugin factories receive a restricted `host` API. Host helpers check the plugin's declared permissions at runtime:

- `host.readTextFile()` requires `filesystem.read` and stays inside the plugin directory.
- `host.writeTextFile()` requires `filesystem.write` and stays inside the plugin directory.
- `host.fetchJson()` requires `network.local` for local URLs or `network.http` for remote URLs.
- `host.execFile()` requires `process.exec` and does not invoke a shell.
- `host.readSecret()` requires `secrets.read` and only reads declared secrets.
- `host.readStorage()`, `host.writeStorage()`, and `host.deleteStorage()` persist plugin-private JSON values under the plugin directory and do not require filesystem permissions.
- `host.publishEvent()` requires `source.events` and writes to the plugin event bus.

Current permissions are:

- `docker.socket`
- `kubernetes.api`
- `network.local`
- `network.http`
- `filesystem.read`
- `filesystem.write`
- `process.exec`
- `secrets.read`

## Process Isolation

External plugins run in a dedicated child process by default. Use the explicit `in-process` mode only for trusted local development plugins:

```json
{
  "execution": {
    "isolation": "process",
    "operationTimeoutMs": 30000,
    "maxStderrBytes": 64000,
    "memoryLimitMb": 128
  }
}
```

DockScope validates the manifest and imports plugin code only inside a persistent worker. Commands, graph sources and events, entity/action providers, project providers, system and connection providers, analysis providers, log streams, and exec sessions are proxied over typed IPC. Permission-checked host calls execute in the parent process, and the worker receives a scrubbed environment instead of DockScope's full environment.

`operationTimeoutMs` applies to each request. `memoryLimitMb` sets the worker's V8 old-generation heap limit, and `maxStderrBytes` terminates a worker that emits excessive stderr. A crash rejects in-flight work without taking down DockScope; the next operation starts a fresh worker. Mutating operations are not retried automatically.

Process isolation is a fault and resource boundary, not a complete operating-system sandbox. Only install signed plugins from catalogs you trust.

