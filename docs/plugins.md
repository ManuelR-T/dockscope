# DockScope Plugins

DockScope loads built-in features and external integrations through the same typed plugin registry. A plugin is a data-oriented module: it declares a manifest, the capabilities it provides, the permissions it needs, and optional providers for graph data, metrics, logs, lifecycle actions, exec, projects, resources, diagnostics, and UI-facing metadata.

## Loading

External plugins are loaded from the local plugin registry and any explicit plugin paths.

```bash
dockscope up --plugins ./plugins --plugin-permissions all
```

The equivalent environment variables are:

```bash
DOCKSCOPE_PLUGIN_PATHS=./plugins dockscope up
DOCKSCOPE_PLUGIN_PERMISSIONS=network.local,docker.socket dockscope up
DOCKSCOPE_PLUGIN_STATE=./plugin-state.json dockscope up
DOCKSCOPE_PLUGIN_CONFIG=./plugin-config.json dockscope up
DOCKSCOPE_PLUGIN_SECRETS=./plugin-secrets.json dockscope up
DOCKSCOPE_PLUGIN_SECRET_KEY='local encryption key' dockscope up
DOCKSCOPE_PLUGIN_EVENTS=./plugin-events.json dockscope up
DOCKSCOPE_PLUGIN_APPROVALS=./plugin-approvals.json dockscope up
DOCKSCOPE_PLUGIN_CATALOG=./plugin-catalog.json dockscope up
DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY="$(cat ./keys/catalog.public.pem)" dockscope up
DOCKSCOPE_PLUGIN_CATALOG_TRUST="$(cat ./keys/catalog-trust.json)" dockscope up
DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG=1 dockscope up
DOCKSCOPE_PLUGIN_REGISTRY=./installed-plugins dockscope up
DOCKSCOPE_PLUGIN_ALLOW_UNSIGNED=1 dockscope up
DOCKSCOPE_DISABLE_EXTERNAL_PLUGINS=1 dockscope up
```

`DOCKSCOPE_PLUGIN_PATHS` uses the platform path delimiter (`:` on Linux/macOS, `;` on Windows). Each entry can be either a plugin directory containing `plugin.json` or a directory containing multiple plugin directories. The local registry is `~/.dockscope/plugins` by default and is included automatically unless external plugins are disabled.

DockScope uses its official GitHub Pages catalog by default and pins the `official-catalog-v1` Ed25519 public key in the application. `DOCKSCOPE_PLUGIN_CATALOG` replaces the official URL with a custom catalog. `DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY` contains one custom pinned public key, while `DOCKSCOPE_PLUGIN_CATALOG_TRUST` contains a JSON trust store for key overlap or revocation. Use `--no-official-plugin-catalog` or `DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG=1` for an intentionally catalog-free instance. `DOCKSCOPE_PLUGIN_ALLOW_UNSIGNED=1` is intended for local development only; by default marketplace installs require each catalog entry to include an Ed25519 package signature.

## Manifest

Every external plugin must include `plugin.json`:

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

Installed plugins are copied into `~/.dockscope/plugins` by default and are loaded automatically on `dockscope up`. Use `--plugin-registry` or `DOCKSCOPE_PLUGIN_REGISTRY` to point DockScope at another local registry:

```bash
dockscope up --plugin-registry ./installed-plugins --plugin-permissions all
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

## Packaging and Signing

Create and verify package artifacts:

```bash
dockscope plugin:pack --source ./plugins/example --out ./example.dockscope-plugin
dockscope plugin:verify --package ./example.dockscope-plugin
```

Add an HMAC signature with a local key:

```bash
dockscope plugin:pack --source ./plugins/example --out ./example.dockscope-plugin --signing-key "$KEY"
dockscope plugin:verify --package ./example.dockscope-plugin --signing-key "$KEY"
dockscope plugin:install --source ./example.dockscope-plugin --signing-key "$KEY"
```

Packages store every file with a SHA-256 hash, plus a whole-package SHA-256. Signatures are optional, but when a signing key is provided verification requires a matching package signature.

For distribution, prefer Ed25519 public-key signatures:

```bash
dockscope plugin:keys --out-dir ./keys
dockscope plugin:pack --source ./plugins/example --out ./example.dockscope-plugin --private-key ./keys/dockscope-plugin.private.pem --key-id maintainer-1
dockscope plugin:verify --package ./example.dockscope-plugin --public-key ./keys/dockscope-plugin.public.pem
dockscope plugin:install --source ./example.dockscope-plugin --public-key ./keys/dockscope-plugin.public.pem
```

Generate a catalog entry from a signed package:

```bash
dockscope plugin:catalog:entry --package ./example.dockscope-plugin --public-key ./keys/dockscope-plugin.public.pem --key-id maintainer-1
```

Build the repo-local official plugin catalog after a DockScope build:

```bash
npm run build
npm run plugins:catalog -- --source plugins/official --out dist/plugin-catalog --dev-keys
```

For release signing, pass real key files instead of `--dev-keys`:

```bash
npm run plugins:catalog -- \
  --source plugins/official \
  --out dist/plugin-catalog \
  --package-private-key ./keys/package.private.pem \
  --package-public-key ./keys/package.public.pem \
  --catalog-private-key ./keys/catalog.private.pem \
  --catalog-public-key ./keys/catalog.public.pem \
  --package-key-id official-package \
  --catalog-key-id official-catalog
```

The script packages every directory under `plugins/official`, writes package artifacts under `dist/plugin-catalog/packages`, writes `catalog.json` and `catalog-trust.json`, and signs the catalog when a catalog private key is provided. Pass `--package-trust-policy <file>` to carry previous package keys and package revocations, and `--catalog-trust-store <file>` to carry overlapping catalog signer keys. The equivalent CI variables are `DOCKSCOPE_PLUGIN_PACKAGE_TRUST_POLICY` and `DOCKSCOPE_PLUGIN_CATALOG_TRUST_STORE`.

Set `SOURCE_DATE_EPOCH` to a Unix timestamp to make `updatedAt`, default `publishedAt`, packages, signatures, and catalog files reproducible from identical inputs:

```bash
SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" npm run plugins:catalog -- --out dist/plugin-catalog
```

### Official catalog releases

CI builds a temporary signed catalog, verifies its signature, installs the Kubernetes package, and loads it through the public plugin path. The release workflow builds the production catalog, attaches its files to the GitHub release, and deploys the same files under `/plugins/` on GitHub Pages.

Configure these GitHub Actions secrets before releasing:

- `PLUGIN_PACKAGE_PRIVATE_KEY`: Ed25519 private key used to sign plugin packages.
- `PLUGIN_CATALOG_PRIVATE_KEY`: Ed25519 private key used to sign the catalog metadata.
- `PLUGIN_PACKAGE_TRUST_POLICY`: optional JSON with overlapping package keys and revocations.
- `PLUGIN_CATALOG_TRUST_STORE`: optional JSON with overlapping catalog signing keys and revocations.

Generate each pair with `dockscope plugin:keys`. Keep private keys outside the repository and retain them between releases. The catalog builder derives and publishes `package.public.pem` and `catalog.public.pem`; it also accepts the corresponding `DOCKSCOPE_PLUGIN_*_PRIVATE_KEY` environment variables in CI. Release builds use `--require-signatures` and fail closed when either secret is absent.

GitHub Pages must use **GitHub Actions** as its deployment source. Once enabled, the stable catalog URL is `https://<owner>.github.io/<repository>/plugins/catalog.json`.

## Catalogs

A plugin catalog is a signed-package index. DockScope connects to the pinned official catalog by default. A local JSON file or another HTTP(S) URL configured with `--plugin-catalog` or `DOCKSCOPE_PLUGIN_CATALOG` replaces that default.

```json
{
  "format": "dockscope-plugin-catalog/v1",
  "name": "Official DockScope Plugins",
  "updatedAt": "2026-07-10T19:00:00.000Z",
  "trust": {
    "packageKeys": [
      {
        "algorithm": "ed25519",
        "keyId": "maintainer-2",
        "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
        "status": "active"
      }
    ],
    "revokedPackageKeyIds": [],
    "revokedPackages": []
  },
  "signature": {
    "algorithm": "ed25519",
    "value": "catalog-signature-base64",
    "keyId": "catalog-1"
  },
  "entries": [
    {
      "id": "example.plugin",
      "name": "Example Plugin",
      "version": "1.0.0",
      "description": "Adds an example command",
      "homepage": "https://github.com/ManuelR-T/dockscope",
      "repositoryUrl": "https://github.com/ManuelR-T/dockscope",
      "readmeUrl": "https://github.com/ManuelR-T/dockscope/blob/main/docs/plugins.md",
      "readme": "# Example Plugin\n\nRendered in the Marketplace review panel.",
      "iconUrl": "https://example.com/icon.png",
      "license": "MIT",
      "category": "Utilities",
      "status": "active",
      "tags": ["demo"],
      "screenshots": [],
      "publishedAt": "2026-07-10T19:00:00.000Z",
      "releaseNotes": "Initial catalog release.",
      "compatibility": {
        "minDockscopeVersion": "0.7.0"
      },
      "capabilities": ["ui.command"],
      "permissions": [],
      "packageUrl": "./example.dockscope-plugin",
      "packageSha256": "package-bundle-sha256-from-plugin-pack",
      "signature": {
        "algorithm": "ed25519",
        "keyId": "maintainer-2"
      }
    }
  ]
}
```

Package signatures and catalog signatures are separate:

- Each entry `signature` verifies the downloaded plugin package.
- The top-level `signature` verifies the catalog contents and entry metadata.
- The signed top-level `trust` policy resolves package `keyId` values and rejects revoked package keys, versions, or SHA-256 hashes.
- `dockscope plugin:catalog:sign --catalog ./plugin-catalog.json --private-key ./keys/catalog.private.pem --key-id catalog-1` signs the catalog in place.
- `--plugin-catalog-public-key ./keys/catalog.public.pem` or `DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY` makes catalog verification strict. Unsigned catalogs or mismatched signatures are rejected.

Use `dockscope plugin:catalog --catalog ./plugin-catalog.json --trust ./keys/catalog-trust.json` to inspect a signed catalog and `dockscope plugin:catalog:install <pluginId> --catalog ./plugin-catalog.json --catalog-trust ./keys/catalog-trust.json` to install from it. The legacy single-key options remain available. When DockScope is started with `--plugin-catalog`, the Plugin Manager Marketplace tab can install, update, and uninstall catalog plugins in the configured local registry. Install and update actions open a review step with package signature, package hash, capabilities, permissions, compatibility range, target registry, installed version, and release notes.

The local catalog signer trust store is deliberately outside the signed catalog, so a compromised catalog signer cannot un-revoke itself:

```json
{
  "format": "dockscope-plugin-catalog-trust/v1",
  "keys": [
    {
      "algorithm": "ed25519",
      "keyId": "catalog-1",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "status": "retiring"
    },
    {
      "algorithm": "ed25519",
      "keyId": "catalog-2",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "status": "active"
    }
  ],
  "revokedKeyIds": []
}
```

For package-key rotation, publish both keys in the signed catalog policy, mark the old key `retiring`, start signing packages with the new key, then add the old id to `revokedPackageKeyIds` after the migration window. For catalog-root rotation, distribute a local trust store containing both signer keys before switching the catalog signature; remove or revoke the old signer only after clients have received the new root. Emergency package revocations may target a plugin id, version, SHA-256, or any combination.

Marketplace installs reject `yanked` entries, incompatible entries, hash mismatches, untrusted or revoked keys, revoked packages, and unsigned package entries by default. Package contents are fully verified in a staging directory, then the plugin directory and registry index are activated atomically. A failed activation restores the previous version. Use `--allow-unsigned-plugins`, `DOCKSCOPE_PLUGIN_ALLOW_UNSIGNED=1`, or `dockscope plugin:catalog:install --allow-unsigned` only for local development catalogs.

Marketplace entries can include `iconUrl`, `screenshots`, `repositoryUrl`, `readmeUrl`, and inline `readme` text. DockScope renders screenshots and inline README content in the install/update review panel.

## Official Plugins

Official plugins live in `plugins/official`. They are not registered as built-ins; they are packaged and installed through a catalog like any other external plugin.

The first official plugin is `official.kubernetes`:

- uses `kubectl` through `host.execFile()`
- requires `process.exec` and `kubernetes.api`
- adds a Kubernetes graph source
- handles Pod logs, restart/delete, and HPA replica actions

Local development:

```bash
dockscope plugin:dev --plugins plugins/official/kubernetes --plugin-permissions all
```

Marketplace API:

- `GET /api/plugins/marketplace`
- `POST /api/plugins/marketplace/:pluginId/install`
- `POST /api/plugins/marketplace/:pluginId/update`
- `DELETE /api/plugins/marketplace/:pluginId`

## Configuration

Plugins can expose a typed config schema in `plugin.json`. DockScope persists config in `~/.dockscope/plugin-config.json` by default, or in the file passed to `--plugin-config`.

Supported field types are:

- `string`
- `number`
- `boolean`
- `select`

Plugins receive the current config in the factory context and through `configure(config)` whenever it changes.

## Review and Migration

The Plugin Manager Review tab summarizes each external plugin before and while enabling it:

- capabilities and permissions
- declared secrets
- commands and UI slots
- config fields
- execution isolation
- compatibility warnings
- risk level derived from permissions and execution mode
- approval state based on a hash of the security-relevant manifest surface

Approvals are persisted in `~/.dockscope/plugin-approvals.json` by default. If a plugin changes capabilities, permissions, secrets, commands, UI actions, config fields, or execution policy, the Review tab marks the approval as `changed`.

Compatibility migrations become executable when a migration declares `commandId`:

```json
{
  "compatibility": {
    "migrations": [
      {
        "from": "0.x",
        "to": "1.x",
        "notes": "Rename config keys",
        "commandId": "migrate"
      }
    ]
  }
}
```

The API endpoint is `POST /api/plugins/:pluginId/migrate` with `{ "from": "0.x", "to": "1.x" }`.

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

External plugin code is imported only after manifest permissions pass policy checks. Use `--plugin-permissions all` during development, then narrow the list for normal usage.

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

## Runtime Inspection

Use these endpoints to inspect plugin state:

- `GET /api/plugins` returns registered plugins and lifecycle status.
- `GET /api/plugins/health` returns process state, PID, uptime, CPU, memory, pending work, restart count, crash history, and quarantine state.
- `GET /api/plugins/errors` returns external plugin manifest, permission, load, and register failures.
- `GET /api/plugins/warnings` returns non-blocking manifest deprecation and compatibility warnings.
- `GET /api/plugins/ui` returns frontend extension descriptors.
- `GET /api/plugins/:pluginId/frontend` returns a declared sandboxed frontend bundle.
- `POST /api/plugins/:pluginId/ui/:extensionId/action` runs an extension's declared action.
- `GET /api/plugins/commands` returns command descriptors.
- `POST /api/plugins/:pluginId/commands/:commandId` runs a plugin command.
- `GET /api/plugins/events` returns recent plugin events.
- `GET /api/plugins/review` returns permission/capability review reports.
- `GET /api/plugins/catalog` returns the configured plugin catalog.
- `GET /api/plugins/marketplace` returns catalog entries merged with local install state.
- `POST /api/plugins/marketplace/:pluginId/install` installs a catalog plugin.
- `POST /api/plugins/marketplace/:pluginId/update` updates an installed catalog plugin.
- `DELETE /api/plugins/marketplace/:pluginId` uninstalls a local marketplace plugin.
- `GET /api/plugins/approvals` returns persisted plugin approvals.
- `GET /api/plugins/compatibility` returns version, deprecation, and migration reports.
- `POST /api/plugins/:pluginId/migrate` runs a declared compatibility migration.
- `POST /api/plugins/:pluginId/approve` approves the current plugin fingerprint.
- `POST /api/plugins/:pluginId/revoke-approval` revokes approval.

External process runtimes are quarantined after three crashes within 60 seconds. Quarantine stops and disables the plugin, persists the reason across restarts, and publishes a `runtime.quarantined` event. Explicitly enabling or reloading the plugin clears the quarantine and starts a fresh crash window.
- `GET /api/plugins/config` returns config schemas and current values.
- `PUT /api/plugins/:pluginId/config` updates plugin config.
- `GET /api/plugins/secrets` returns declared secret status without values.
- `PUT /api/plugins/:pluginId/secrets/:key` stores a declared secret value.
- `POST /api/plugins/:pluginId/enable` enables an external plugin.
- `POST /api/plugins/:pluginId/disable` disables an external plugin.
- `POST /api/plugins/:pluginId/reload` reloads an external plugin from disk.
- `GET /api/entities/:entityId/operations` returns matching plugin operation descriptors.
- `GET /api/entities/:entityId/actions` returns contextual entity actions.
- `POST /api/entities/:entityId/actions/:pluginId/:actionId` runs an owned entity action.
- `GET /api/entities/:entityId/{stats|logs|inspect|history|top|diff|diagnostic}` routes an entity read.
- `GET /api/systems` returns plugin-owned system inventory.
- `GET /api/connections/providers` returns typed connection provider forms.
- `GET /api/connections` returns configured plugin connections.
- `POST /api/connections/:pluginId/:providerId` adds a connection.
- `DELETE /api/connections/:pluginId/:providerId/:connectionId` removes a connection.

Start/stop failures mark the plugin as `failed` without preventing the rest of DockScope from running.
