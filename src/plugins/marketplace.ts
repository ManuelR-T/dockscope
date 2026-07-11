import { cp, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  type PluginApprovalSnapshot,
  PluginOperationError,
  type PluginRegistry,
  type PluginRuntimeInfo,
} from '../core/plugins.js';
import type { PluginCapability, PluginPermission } from '../core/capabilities.js';
import {
  compareVersions,
  pluginCompatibilityWarnings,
  type PluginCompatibility,
} from '../core/plugin-compatibility.js';
import { PKG_VERSION } from '../version.js';
import { errorMessage } from '../utils.js';
import type {
  PluginCatalogEntrySignature,
  ResolvedPluginCatalog,
  ResolvedPluginCatalogEntry,
} from './catalog.js';
import { installPluginFromCatalog, loadPluginCatalog } from './catalog.js';
import {
  OFFICIAL_PLUGIN_CATALOG_NAME,
  OFFICIAL_PLUGIN_CATALOG_URL,
  pluginCatalogLoadOptionsFromEnv,
  pluginCatalogSourceFromEnv,
} from './catalogConfig.js';
import {
  defaultPluginRegistryDir,
  listInstalledPlugins,
  removeInstalledPluginRecord,
  saveInstalledPluginRecord,
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
  repositoryUrl?: string;
  readmeUrl?: string;
  readme?: string;
  iconUrl?: string;
  license?: string;
  category?: string;
  status: 'active' | 'deprecated' | 'yanked';
  publishedAt?: string;
  releaseNotes?: string;
  compatibility?: PluginCompatibility;
  compatibilityWarnings: readonly string[];
  screenshots: readonly string[];
  tags: readonly string[];
  capabilities: readonly PluginCapability[];
  permissions: readonly PluginPermission[];
  packageSha256?: string;
  signature?: PluginCatalogEntrySignature;
  catalogSignatureVerified?: boolean;
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
  catalogSignatureVerified?: boolean;
  catalogError?: string;
  entries: readonly PluginMarketplaceEntry[];
}

interface InstalledPluginSnapshot {
  pluginId: string;
  installed?: InstalledPlugin;
  backupPath?: string;
}

function pluginRegistryDir(env: NodeJS.ProcessEnv): string {
  return env.DOCKSCOPE_PLUGIN_REGISTRY || defaultPluginRegistryDir();
}

function allowUnsignedPackages(env: NodeJS.ProcessEnv): boolean {
  return env.DOCKSCOPE_PLUGIN_ALLOW_UNSIGNED === '1';
}

function updateAvailable(
  catalogEntry: ResolvedPluginCatalogEntry,
  installed: InstalledPlugin | undefined,
): boolean {
  if (!installed) {
    return false;
  }
  if (compareVersions(catalogEntry.version, installed.version) > 0) {
    return true;
  }
  return (
    compareVersions(catalogEntry.version, installed.version) === 0 &&
    Boolean(catalogEntry.packageSha256 && installed.packageSha256 !== catalogEntry.packageSha256)
  );
}

function catalogMarketplaceEntry(options: {
  catalogEntry: ResolvedPluginCatalogEntry;
  installed?: InstalledPlugin;
  runtime?: PluginRuntimeInfo;
  catalogSignatureVerified?: boolean;
}): PluginMarketplaceEntry {
  const hasUpdate = updateAvailable(options.catalogEntry, options.installed);
  return {
    id: options.catalogEntry.id,
    name: options.catalogEntry.name,
    version: options.catalogEntry.version,
    description: options.catalogEntry.description,
    author: options.catalogEntry.author,
    homepage: options.catalogEntry.homepage,
    repositoryUrl: options.catalogEntry.repositoryUrl,
    readmeUrl: options.catalogEntry.readmeUrl,
    readme: options.catalogEntry.readme,
    iconUrl: options.catalogEntry.iconUrl,
    license: options.catalogEntry.license,
    category: options.catalogEntry.category,
    status: options.catalogEntry.status,
    publishedAt: options.catalogEntry.publishedAt,
    releaseNotes: options.catalogEntry.releaseNotes,
    compatibility: options.catalogEntry.compatibility,
    compatibilityWarnings: pluginCompatibilityWarnings(
      options.catalogEntry.compatibility,
      PKG_VERSION,
    ),
    screenshots: [...options.catalogEntry.screenshots],
    tags: [...options.catalogEntry.tags],
    capabilities: [...options.catalogEntry.capabilities],
    permissions: [...options.catalogEntry.permissions],
    packageSha256: options.catalogEntry.packageSha256,
    signature: options.catalogEntry.signature,
    catalogSignatureVerified: options.catalogSignatureVerified,
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
    status: 'active',
    compatibilityWarnings: [],
    screenshots: [],
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
    const source = pluginCatalogSourceFromEnv(this.env);
    const installed = await listInstalledPlugins(pluginRegistryDir(this.env));
    if (!source) {
      return this.snapshot(undefined, installed);
    }
    try {
      const catalog = await loadPluginCatalog(
        source,
        pluginCatalogLoadOptionsFromEnv(this.env, source),
      );
      return this.snapshot(catalog, installed, { configured: true });
    } catch (error) {
      return this.snapshot(undefined, installed, {
        configured: true,
        catalogName:
          source === OFFICIAL_PLUGIN_CATALOG_URL ? OFFICIAL_PLUGIN_CATALOG_NAME : undefined,
        catalogError: errorMessage(error),
      });
    }
  }

  async install(pluginId: string): Promise<PluginMarketplaceSnapshot> {
    const source = this.requireCatalogSource();
    const catalogVerification = pluginCatalogLoadOptionsFromEnv(this.env, source);
    const entry = await this.requireCatalogEntry(pluginId);
    this.assertInstallable(entry);
    const runtime = this.runtimePlugin(pluginId);
    if (runtime?.manifest.builtin) {
      throw new PluginOperationError(400, `Built-in plugin cannot be replaced: ${pluginId}`);
    }
    const alreadyInstalled = await this.installedPlugin(pluginId);
    const snapshot = await this.snapshotInstalledPlugin(pluginId);
    try {
      const installed = await installPluginFromCatalog({
        catalogSource: source,
        pluginId,
        registryDir: pluginRegistryDir(this.env),
        catalogPublicKey: catalogVerification.publicKey,
        catalogTrustStore: catalogVerification.trustStore,
        allowUnsigned: allowUnsignedPackages(this.env),
      });
      await this.registerInstalledPlugin(installed, {
        enabled: alreadyInstalled
          ? (runtime?.enabled ?? (await this.stateStore.loadEnabled(pluginId)))
          : true,
      });
      await this.discardInstalledPluginSnapshot(snapshot);
      return this.list();
    } catch (error) {
      await this.restoreInstalledPluginSnapshot(snapshot);
      throw error;
    }
  }

  async update(pluginId: string): Promise<PluginMarketplaceSnapshot> {
    const installed = await this.installedPlugin(pluginId);
    if (!installed) {
      throw new PluginOperationError(404, `Plugin is not installed: ${pluginId}`);
    }
    const entry = await this.requireCatalogEntry(pluginId);
    this.assertInstallable(entry);
    const enabled =
      this.runtimePlugin(pluginId)?.enabled ?? (await this.stateStore.loadEnabled(pluginId));
    const snapshot = await this.snapshotInstalledPlugin(pluginId);
    const source = this.requireCatalogSource();
    const catalogVerification = pluginCatalogLoadOptionsFromEnv(this.env, source);
    try {
      const updated = await installPluginFromCatalog({
        catalogSource: source,
        pluginId,
        registryDir: pluginRegistryDir(this.env),
        catalogPublicKey: catalogVerification.publicKey,
        catalogTrustStore: catalogVerification.trustStore,
        allowUnsigned: allowUnsignedPackages(this.env),
      });
      await this.registerInstalledPlugin(updated, { enabled });
      await this.discardInstalledPluginSnapshot(snapshot);
      return this.list();
    } catch (error) {
      await this.restoreInstalledPluginSnapshot(snapshot);
      throw error;
    }
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
    options: { configured?: boolean; catalogName?: string; catalogError?: string } = {},
  ): Promise<PluginMarketplaceSnapshot> {
    const installedById = new Map(installed.map((plugin) => [plugin.id, plugin]));
    const runtimeById = new Map(
      this.registry.listPlugins().map((runtime) => [runtime.manifest.id, runtime]),
    );
    const entries: PluginMarketplaceEntry[] = [];
    const catalogSignatureVerified = catalog?.signatureVerified;

    for (const catalogEntry of catalog?.entries ?? []) {
      const installedPlugin = installedById.get(catalogEntry.id);
      entries.push(
        catalogMarketplaceEntry({
          catalogEntry,
          installed: installedPlugin,
          runtime: runtimeById.get(catalogEntry.id),
          catalogSignatureVerified,
        }),
      );
      installedById.delete(catalogEntry.id);
    }

    for (const installedPlugin of installedById.values()) {
      entries.push(localMarketplaceEntry(installedPlugin, runtimeById.get(installedPlugin.id)));
    }

    return {
      configured: options.configured ?? Boolean(catalog),
      catalogName: catalog?.name ?? options.catalogName,
      registryDir: pluginRegistryDir(this.env),
      approvals: this.registry.listPluginApprovals(),
      catalogSignatureVerified: catalog?.signatureVerified,
      catalogError: options.catalogError,
      entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  private requireCatalogSource(): string {
    const source = pluginCatalogSourceFromEnv(this.env);
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

  private async requireCatalogEntry(pluginId: string): Promise<ResolvedPluginCatalogEntry> {
    const source = this.requireCatalogSource();
    const catalog = await loadPluginCatalog(
      source,
      pluginCatalogLoadOptionsFromEnv(this.env, source),
    );
    const entry = catalog.entries.find((candidate) => candidate.id === pluginId);
    if (!entry) {
      throw new PluginOperationError(404, `Plugin catalog entry not found: ${pluginId}`);
    }
    return entry;
  }

  private assertInstallable(entry: ResolvedPluginCatalogEntry): void {
    if (entry.status === 'yanked') {
      throw new PluginOperationError(400, `Plugin is yanked: ${entry.id}`);
    }
    const warnings = pluginCompatibilityWarnings(entry.compatibility, PKG_VERSION);
    if (warnings.length > 0) {
      throw new PluginOperationError(
        400,
        `Plugin is not compatible with DockScope ${PKG_VERSION}: ${warnings.join('; ')}`,
      );
    }
  }

  private async snapshotInstalledPlugin(pluginId: string): Promise<InstalledPluginSnapshot> {
    const installed = await this.installedPlugin(pluginId);
    if (!installed) {
      return { pluginId };
    }
    const backupDir = await mkdtemp(path.join(tmpdir(), 'dockscope-plugin-backup-'));
    const backupPath = path.join(backupDir, 'plugin');
    await cp(installed.path, backupPath, { recursive: true });
    return { pluginId, installed, backupPath };
  }

  private async restoreInstalledPluginSnapshot(snapshot: InstalledPluginSnapshot): Promise<void> {
    if (!snapshot.installed) {
      await this.registry.unregisterPlugin(snapshot.pluginId).catch(() => undefined);
      await uninstallPlugin(snapshot.pluginId, pluginRegistryDir(this.env)).catch(() => undefined);
      await removeInstalledPluginRecord(snapshot.pluginId, pluginRegistryDir(this.env));
      return;
    }
    const runtime = this.runtimePlugin(snapshot.installed.id);
    if (runtime) {
      await this.registry.unregisterPlugin(snapshot.installed.id).catch(() => undefined);
    }
    await rm(snapshot.installed.path, { recursive: true, force: true });
    if (snapshot.backupPath) {
      await cp(snapshot.backupPath, snapshot.installed.path, { recursive: true });
      await rm(path.dirname(snapshot.backupPath), { recursive: true, force: true });
      await saveInstalledPluginRecord(snapshot.installed, pluginRegistryDir(this.env));
      await this.registerInstalledPlugin(snapshot.installed, {
        enabled: await this.stateStore.loadEnabled(snapshot.installed.id),
      }).catch(() => undefined);
    }
  }

  private async discardInstalledPluginSnapshot(snapshot: InstalledPluginSnapshot): Promise<void> {
    if (snapshot.backupPath) {
      await rm(path.dirname(snapshot.backupPath), { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
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
      onRuntimeCrash: (pluginId, crash) => this.registry.recordRuntimeCrash(pluginId, crash),
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
