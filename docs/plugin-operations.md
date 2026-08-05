# Operating DockScope Plugins

For running plugins rather than writing them: where they load from, how
permissions are granted, what happens when one misbehaves, and the endpoints
that report all of it.

See also [Writing a plugin](plugins.md) and
[Publishing a plugin](plugin-publishing.md).

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

An explicit Marketplace or CLI install persists the exact permissions reviewed at install time. The grant is bound to the installed plugin ID and registry path, and is reused on restart and hot reload. Plugins loaded directly from `DOCKSCOPE_PLUGIN_PATHS` receive no permissions by default and rely on `DOCKSCOPE_PLUGIN_PERMISSIONS` or `--plugin-permissions` for globally allowed permissions.

DockScope uses its official GitHub Pages catalog by default and pins the `official-catalog-v1` Ed25519 public key in the application. `DOCKSCOPE_PLUGIN_CATALOG` adds one or more comma-separated catalogs alongside the official one, described in [Catalogs](plugin-publishing.md#catalogs). `DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY` contains one custom pinned public key, while `DOCKSCOPE_PLUGIN_CATALOG_TRUST` contains a JSON trust store for key overlap or revocation. Use `--no-official-plugin-catalog` or `DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG=1` to trust only the catalogs you configure, or none at all. `DOCKSCOPE_PLUGIN_ALLOW_UNSIGNED=1` is intended for local development only; by default marketplace installs require each catalog entry to include an Ed25519 package signature.

## Review and Migration

Expanding a plugin on the Plugins panel's Installed tab shows a Security review section that summarizes that plugin before and while enabling it:

- capabilities and permissions
- declared secrets
- commands and UI slots
- config fields
- execution isolation
- compatibility warnings
- risk level derived from permissions and execution mode
- approval state based on a hash of the security-relevant manifest surface

Approvals are persisted in `~/.dockscope/plugin-approvals.json` by default. If a plugin changes capabilities, permissions, secrets, commands, UI actions, config fields, or execution policy, the Security review section marks the approval as `changed`.

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

## Official Plugins

Official plugins live in `plugins/official`. They are not registered as built-ins; they are packaged and installed through a catalog like any other external plugin.

The first official plugin is `official.kubernetes`:

- talks to the Kubernetes API directly through `@kubernetes/client-node`
- requires `kubernetes.api`
- adds a Kubernetes graph source covering Deployments, StatefulSets, DaemonSets, Pods, Services, Ingresses and HorizontalPodAutoscalers
- resolves pod ownership through the `Pod -> ReplicaSet -> Deployment` chain, so pods attach to the controller users think in terms of; the ReplicaSet itself is never drawn
- reports Pod CPU and memory from `metrics.k8s.io`, requiring metrics-server in the cluster
- inspects Pods: env (with secret and configMap references shown as references, never resolved), labels, volume mounts and their backing storage
- handles Pod logs as a tail or a followed stream, workload rollout restart and scale, HPA replica bounds, and delete
- opens an interactive shell in a Pod, adapting the host's single duplex stream onto the API's separate stdin/stdout

Two conventions worth copying in your own plugin:

- **Kinds beyond the built-in set.** `ServiceNode.kind` accepts `deployment`, `statefulset` and `daemonset` alongside `container`, `pod`, `service`, `ingress` and `hpa`. Nothing validates the field at runtime, so a source can emit a kind the host does not know yet; it simply renders with the default node treatment.
- **Facts belong in `metadata`.** `ServiceNode.metadata` is a flat `Record<string, string | number | boolean>` that the node sidebar renders as its own Details section, and that `EntityRef.context.metadata` hands back to your action declarations. The Kubernetes plugin uses it both ways: it publishes `minReplicas`/`maxReplicas` as numbers so the scale form can pre-fill the current bounds. Keep the keys stable, because your own action code reads them back.
- **Cache whole-cluster reads behind `getStats`.** The monitor calls `getStats` once per running node every few seconds. If your upstream exposes a list endpoint, fetch it once per sweep and serve every node from that snapshot rather than issuing a request per entity. `PodMetricsCache` in the Kubernetes plugin is a worked example: a short TTL plus in-flight deduplication turns a whole polling sweep into one request.

Local development:

```bash
dockscope plugin:dev --plugins plugins/official/kubernetes --plugin-permissions all
```

Marketplace API:

- `GET /api/plugins/marketplace`
- `POST /api/plugins/marketplace/:pluginId/install`
- `POST /api/plugins/marketplace/:pluginId/update`
- `DELETE /api/plugins/marketplace/:pluginId`

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

## Crashes and quarantine

Start and stop failures mark the plugin as `failed` without preventing the rest
of DockScope from running.

External process runtimes are quarantined after three crashes within 60 seconds.
Quarantine stops and disables the plugin, persists the reason across restarts,
and publishes a `runtime.quarantined` event. Explicitly enabling or reloading the
plugin clears the quarantine and starts a fresh crash window.

`GET /api/plugins/health` is where to look first: it reports process state, PID,
uptime, CPU, memory, pending work, restart count, crash history and quarantine
state.
