# DockScope Plugins

DockScope loads built-in features and external integrations through the same typed plugin registry. A plugin is a data-oriented module: it declares a manifest, the capabilities it provides, the permissions it needs, and optional providers for graph data, metrics, logs, lifecycle actions, exec, projects, resources, diagnostics, and UI-facing metadata.

## Loading

External plugins are disabled unless a plugin path is provided.

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
DOCKSCOPE_DISABLE_EXTERNAL_PLUGINS=1 dockscope up
```

`DOCKSCOPE_PLUGIN_PATHS` uses the platform path delimiter (`:` on Linux/macOS, `;` on Windows). Each entry can be either a plugin directory containing `plugin.json` or a directory containing multiple plugin directories.

## Manifest

Every external plugin must include `plugin.json`:

```json
{
  "id": "example.static",
  "name": "Static Example",
  "version": "1.0.0",
  "dockscopeApiVersion": "1",
  "description": "Adds a static graph source",
  "entry": "./plugin.mjs",
  "capabilities": ["source.graph", "source.events", "ui.toolbarAction", "ui.settings", "ui.command"],
  "permissions": [],
  "execution": {
    "isolation": "in-process",
    "commandTimeoutMs": 30000,
    "maxStderrBytes": 64000
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
      "description": "Runs a plugin-defined backend action"
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

`dockscopeApiVersion` is the SDK/runtime compatibility contract. Current plugins should use `"1"`. Unsupported versions fail manifest validation before plugin code is imported.

Validate manifests without importing plugin code:

```bash
dockscope plugin:validate --plugins ./plugins --plugin-permissions all
```

Developer workflow commands:

```bash
dockscope plugin:init --dir ./plugins/example --id example.plugin --name "Example Plugin"
dockscope plugin:keys --out-dir ./keys
dockscope plugin:test --plugins ./plugins --plugin-permissions all
dockscope plugin:watch --plugins ./plugins --plugin-permissions all
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

Installed plugins are copied into `~/.dockscope/plugins` by default. Load that registry with:

```bash
dockscope up --plugins ~/.dockscope/plugins --plugin-permissions all
```

## UI Extensions

Frontend plugins are data-only. External plugin JavaScript is not loaded into the browser. A plugin declares UI descriptors and DockScope renders them in known slots.

Current slots are:

- `toolbar`
- `sidebar`
- `nodePanel`
- `graphOverlay`
- `settings`

Each slot requires its matching UI capability, such as `ui.toolbarAction` for `toolbar`. Toolbar entries can declare an `open_url` action with an `http` or `https` URL, or a `run_command` action that calls a backend plugin command.

```json
{
  "id": "refresh",
  "slot": "toolbar",
  "title": "Refresh",
  "action": {
    "type": "run_command",
    "commandId": "refresh"
  }
}
```

## Commands and Events

Plugins can declare backend commands in the manifest and implement `runCommand(commandId, input)`. Commands require the `ui.command` capability.

```js
export default function createPlugin({ manifest, host }) {
  return {
    manifest,
    async runCommand(commandId) {
      if (commandId !== 'refresh') {
        return { ok: false, message: `Unknown command: ${commandId}` };
      }
      await host.publishEvent('refresh.completed', { time: Date.now() });
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

By default, external plugins run in-process. Command and graph-source plugins can request process-level execution:

```json
{
  "execution": {
    "isolation": "process",
    "commandTimeoutMs": 30000,
    "maxStderrBytes": 64000
  }
}
```

For process-isolated plugins, DockScope validates the manifest and creates a proxy without importing the plugin module in the main server process. Commands and graph-source collection run inside forked workers. Other provider APIs still require in-process execution.

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

## Catalogs

A plugin catalog is a signed-package index. It can be a local JSON file or an HTTP(S) URL configured with `--plugin-catalog` or `DOCKSCOPE_PLUGIN_CATALOG`.

```json
{
  "format": "dockscope-plugin-catalog/v1",
  "name": "Official DockScope Plugins",
  "entries": [
    {
      "id": "example.plugin",
      "name": "Example Plugin",
      "version": "1.0.0",
      "description": "Adds an example command",
      "capabilities": ["ui.command"],
      "permissions": [],
      "packageUrl": "./example.dockscope-plugin",
      "packageSha256": "package-bundle-sha256-from-plugin-pack",
      "signature": {
        "algorithm": "ed25519",
        "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
        "keyId": "maintainer-1"
      }
    }
  ]
}
```

Use `dockscope plugin:catalog --catalog ./plugin-catalog.json` to inspect a catalog and `dockscope plugin:catalog:install <pluginId> --catalog ./plugin-catalog.json` to install from it.

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

TypeScript plugins can import SDK types from `dockscope/plugin-sdk` after DockScope is built or installed.

## Permissions

External plugin code is imported only after manifest permissions pass policy checks. Use `--plugin-permissions all` during development, then narrow the list for normal usage.

Plugin factories receive a restricted `host` API. Host helpers check the plugin's declared permissions at runtime:

- `host.readTextFile()` requires `filesystem.read` and stays inside the plugin directory.
- `host.writeTextFile()` requires `filesystem.write` and stays inside the plugin directory.
- `host.fetchJson()` requires `network.local` for local URLs or `network.http` for remote URLs.
- `host.execFile()` requires `process.exec` and does not invoke a shell.
- `host.readSecret()` requires `secrets.read` and only reads declared secrets.
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
- `GET /api/plugins/errors` returns external plugin manifest, permission, load, and register failures.
- `GET /api/plugins/ui` returns frontend extension descriptors.
- `GET /api/plugins/commands` returns command descriptors.
- `POST /api/plugins/:pluginId/commands/:commandId` runs a plugin command.
- `GET /api/plugins/events` returns recent plugin events.
- `GET /api/plugins/review` returns permission/capability review reports.
- `GET /api/plugins/catalog` returns the configured plugin catalog.
- `GET /api/plugins/approvals` returns persisted plugin approvals.
- `GET /api/plugins/compatibility` returns version, deprecation, and migration reports.
- `POST /api/plugins/:pluginId/migrate` runs a declared compatibility migration.
- `POST /api/plugins/:pluginId/approve` approves the current plugin fingerprint.
- `POST /api/plugins/:pluginId/revoke-approval` revokes approval.
- `GET /api/plugins/config` returns config schemas and current values.
- `PUT /api/plugins/:pluginId/config` updates plugin config.
- `GET /api/plugins/secrets` returns declared secret status without values.
- `PUT /api/plugins/:pluginId/secrets/:key` stores a declared secret value.
- `POST /api/plugins/:pluginId/enable` enables an external plugin.
- `POST /api/plugins/:pluginId/disable` disables an external plugin.
- `POST /api/plugins/:pluginId/reload` reloads an external plugin from disk.

Start/stop failures mark the plugin as `failed` without preventing the rest of DockScope from running.
