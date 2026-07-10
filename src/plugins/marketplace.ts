import {
  type PluginApprovalSnapshot,
  PluginOperationError,
  type PluginRegistry,
  type PluginRuntimeInfo,
} from '../core/plugins.js';
import type { PluginCapability, PluginPermission } from '../core/capabilities.js';
import type {
  PluginCatalogEntrySignature,
  ResolvedPluginCatalog,
  ResolvedPluginCatalogEntry,
} from './catalog.js';
import { installPluginFromCatalog, loadPluginCatalog } from './catalog.js';
import {
  defaultPluginRegistryDir,
  listInstalledPlugins,
  uninstallPlugin,
  type InstalledPlugin,
} from './install.js';
import { loadExternalPlugins, parsePluginPermissionList } from './loader.js';
import { createPluginConfigStoreFromEnv, type PluginConfigStore } from './configStore.js';
import { createPluginSecretStoreFromEnv, type PluginSecretStore } from './secretStore.js';
import { createPluginStateStoreFromEnv, type PluginStateStore } from './stateStore.js';

export type PluginMarketplaceEntryState = 'available' | 'installed' | 'update_available' | 'local';

export interface PluginMarketplaceEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  category?: string;
  tags: readonly string[];
  capabilities: readonly PluginCapability[];
  permissions: readonly PluginPermission[];
  packageSha256?: string;
  signature?: PluginCatalogEntrySignature;
  resolvedPackageUrl?: string;
  installed?: InstalledPlugin;
  runtime?: PluginRuntimeInfo;
  state: PluginMarketplaceEntryState;
  updateAvailable: boolean;
}

export interface PluginMarketplaceSnapshot {
  configured: boolean;
  catalogName?: string;
  registryDir: string;
  approvals: readonly PluginApprovalSnapshot[];
  entries: readonly PluginMarketplaceEntry[];
}

function pluginRegistryDir(env: NodeJS.ProcessEnv): string {
  return env.DOCKSCOPE_PLUGIN_REGISTRY || defaultPluginRegistryDir();
}

function catalogSource(env: NodeJS.ProcessEnv): string | undefined {
  return env.DOCKSCOPE_PLUGIN_CATALOG?.trim() || undefined;
}

function updateAvailable(
  catalogEntry: ResolvedPluginCatalogEntry,
  installed: InstalledPlugin | undefined,
): boolean {
  if (!installed) {
    return false;
  }
  if (installed.version !== catalogEntry.version) {
    return true;
  }
  return Boolean(
    catalogEntry.packageSha256 && installed.packageSha256 !== catalogEntry.packageSha256,
  );
}

function catalogMarketplaceEntry(options: {
  catalogEntry: ResolvedPluginCatalogEntry;
  installed?: InstalledPlugin;
  runtime?: PluginRuntimeInfo;
}): PluginMarketplaceEntry {
  const hasUpdate = updateAvailable(options.catalogEntry, options.installed);
  return {
    id: options.catalogEntry.id,
    name: options.catalogEntry.name,
    version: options.catalogEntry.version,
    description: options.catalogEntry.description,
    author: options.catalogEntry.author,
    homepage: options.catalogEntry.homepage,
    category: options.catalogEntry.category,
    tags: [...options.catalogEntry.tags],
    capabilities: [...options.catalogEntry.capabilities],
    permissions: [...options.catalogEntry.permissions],
    packageSha256: options.catalogEntry.packageSha256,
    signature: options.catalogEntry.signature,
    resolvedPackageUrl: options.catalogEntry.resolvedPackageUrl,
    installed: options.installed,
    runtime: options.runtime,
    state: hasUpdate ? 'update_available' : options.installed ? 'installed' : 'available',
    updateAvailable: hasUpdate,
  };
}

function localMarketplaceEntry(
  installed: InstalledPlugin,
  runtime: PluginRuntimeInfo | undefined,
): PluginMarketplaceEntry {
  return {
    id: installed.id,
    name: installed.name,
    version: installed.version,
    tags: [],
    capabilities: runtime ? [...runtime.manifest.capabilities] : [],
    permissions: runtime ? [...runtime.manifest.permissions] : [],
    installed,
    runtime,
    state: 'local',
    updateAvailable: false,
  };
}

export class PluginMarketplaceService {
  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly registry: PluginRegistry,
    private readonly configStore: PluginConfigStore = createPluginConfigStoreFromEnv(env),
    private readonly stateStore: PluginStateStore = createPluginStateStoreFromEnv(env),
    private readonly secretStore: PluginSecretStore = createPluginSecretStoreFromEnv(env),
  ) {}

  async list(): Promise<PluginMarketplaceSnapshot> {
    const source = catalogSource(this.env);
    const catalog = source ? await loadPluginCatalog(source) : undefined;
    const installed = await listInstalledPlugins(pluginRegistryDir(this.env));
    return this.snapshot(catalog, installed);
  }

  async install(pluginId: string): Promise<PluginMarketplaceSnapshot> {
    const source = this.requireCatalogSource();
    const runtime = this.runtimePlugin(pluginId);
    if (runtime?.manifest.builtin) {
      throw new PluginOperationError(400, `Built-in plugin cannot be replaced: ${pluginId}`);
    }
    const alreadyInstalled = await this.installedPlugin(pluginId);
    const installed = await installPluginFromCatalog({
      catalogSource: source,
      pluginId,
      registryDir: pluginRegistryDir(this.env),
    });
    await this.registerInstalledPlugin(installed, {
      enabled: alreadyInstalled
        ? (runtime?.enabled ?? (await this.stateStore.loadEnabled(pluginId)))
        : true,
    });
    return this.list();
  }

  async update(pluginId: string): Promise<PluginMarketplaceSnapshot> {
    const installed = await this.installedPlugin(pluginId);
    if (!installed) {
      throw new PluginOperationError(404, `Plugin is not installed: ${pluginId}`);
    }
    const enabled =
      this.runtimePlugin(pluginId)?.enabled ?? (await this.stateStore.loadEnabled(pluginId));
    const updated = await installPluginFromCatalog({
      catalogSource: this.requireCatalogSource(),
      pluginId,
      registryDir: pluginRegistryDir(this.env),
    });
    await this.registerInstalledPlugin(updated, { enabled });
    return this.list();
  }

  async uninstall(pluginId: string): Promise<PluginMarketplaceSnapshot> {
    const installed = await this.installedPlugin(pluginId);
    if (!installed) {
      throw new PluginOperationError(404, `Plugin is not installed: ${pluginId}`);
    }
    const runtime = this.runtimePlugin(pluginId);
    if (runtime) {
      await this.registry.unregisterPlugin(pluginId);
    }
    if (!(await uninstallPlugin(pluginId, pluginRegistryDir(this.env)))) {
      throw new PluginOperationError(404, `Plugin is not installed: ${pluginId}`);
    }
    return this.list();
  }

  private async snapshot(
    catalog: ResolvedPluginCatalog | undefined,
    installed: readonly InstalledPlugin[],
  ): Promise<PluginMarketplaceSnapshot> {
    const installedById = new Map(installed.map((plugin) => [plugin.id, plugin]));
    const runtimeById = new Map(
      this.registry.listPlugins().map((runtime) => [runtime.manifest.id, runtime]),
    );
    const entries: PluginMarketplaceEntry[] = [];

    for (const catalogEntry of catalog?.entries ?? []) {
      const installedPlugin = installedById.get(catalogEntry.id);
      entries.push(
        catalogMarketplaceEntry({
          catalogEntry,
          installed: installedPlugin,
          runtime: runtimeById.get(catalogEntry.id),
        }),
      );
      installedById.delete(catalogEntry.id);
    }

    for (const installedPlugin of installedById.values()) {
      entries.push(localMarketplaceEntry(installedPlugin, runtimeById.get(installedPlugin.id)));
    }

    return {
      configured: Boolean(catalog),
      catalogName: catalog?.name,
      registryDir: pluginRegistryDir(this.env),
      approvals: this.registry.listPluginApprovals(),
      entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  private requireCatalogSource(): string {
    const source = catalogSource(this.env);
    if (!source) {
      throw new PluginOperationError(400, 'Plugin catalog is not configured');
    }
    return source;
  }

  private async installedPlugin(pluginId: string): Promise<InstalledPlugin | undefined> {
    return (await listInstalledPlugins(pluginRegistryDir(this.env))).find(
      (plugin) => plugin.id === pluginId,
    );
  }

  private runtimePlugin(pluginId: string): PluginRuntimeInfo | undefined {
    return this.registry.listPlugins().find((plugin) => plugin.manifest.id === pluginId);
  }

  private async registerInstalledPlugin(
    installed: InstalledPlugin,
    options: { enabled?: boolean } = {},
  ): Promise<void> {
    const runtime = this.runtimePlugin(installed.id);
    if (runtime?.manifest.builtin) {
      throw new PluginOperationError(400, `Built-in plugin cannot be replaced: ${installed.id}`);
    }
    if (runtime) {
      await this.registry.unregisterPlugin(installed.id);
    }

    const loaded = await loadExternalPlugins({
      paths: [installed.path],
      permissions: parsePluginPermissionList(this.env.DOCKSCOPE_PLUGIN_PERMISSIONS),
      getConfig: (manifest) => this.configStore.load(manifest.id, manifest.config),
      secretStore: this.secretStore,
      publishEvent: (pluginId, type, payload) =>
        this.registry.publishPluginEvent(pluginId, type, payload),
      cacheBust: true,
    });
    for (const error of loaded.errors) {
      this.registry.recordLoadError(error);
    }

    const plugin = loaded.plugins.find((candidate) => candidate.manifest.id === installed.id);
    if (!plugin) {
      const details = loaded.errors.map((error) => error.message).join('; ');
      throw new PluginOperationError(
        400,
        details
          ? `Installed plugin could not be loaded: ${details}`
          : `Installed plugin could not be loaded: ${installed.id}`,
      );
    }

    const enabled = options.enabled ?? (await this.stateStore.loadEnabled(installed.id));
    if (options.enabled !== undefined) {
      await this.stateStore.saveEnabled(installed.id, enabled);
    }
    this.registry.register(plugin, loaded.configs.get(installed.id), { enabled });
    if (enabled) {
      await this.registry.startPlugin(installed.id);
    }
  }
}

export function createPluginMarketplaceService(
  env: NodeJS.ProcessEnv,
  registry: PluginRegistry,
): PluginMarketplaceService {
  return new PluginMarketplaceService(env, registry);
}

export function pluginRegistryDirFromEnv(env: NodeJS.ProcessEnv): string {
  return pluginRegistryDir(env);
}
