import { cp, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  type PluginApprovalSnapshot,
  PluginOperationError,
  type PluginRuntimeInfo,
} from '../core/plugin-contract/manifest.js';
import { type PluginRegistry } from '../core/plugin-contract/registry.js';
import type { PluginCapability, PluginPermission } from '../core/plugin-contract/capabilities.js';
import {
  compareVersions,
  pluginCompatibilityWarnings,
  type PluginCompatibility,
} from '../core/plugin-contract/compatibility.js';
import { PKG_VERSION } from '../version.js';
import type { PluginCatalogEntrySignature, ResolvedPluginCatalogEntry } from './catalog.js';
import { installPluginFromCatalog } from './catalog.js';
import { previewPluginCatalog } from './catalogPreview.js';
import {
  pluginCatalogConfigFromEnv,
  resolvePluginCatalogLoadOptions,
  resolvePluginCatalogSources,
  type PluginCatalogConfiguration,
} from './catalogConfig.js';
import {
  createPluginCatalogStoreFromEnv,
  type PluginCatalogStore,
  type StoredPluginCatalog,
} from './catalogStore.js';
import {
  findAggregatedEntry,
  loadAggregatedPluginCatalogs,
  type AggregatedPluginCatalogEntry,
  type AggregatedPluginCatalogs,
  type PluginCatalogSourceStatus,
} from './catalogAggregate.js';
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
  /** Which catalog provided this entry, for provenance in the UI. */
  catalogName?: string;
  catalogSource?: string;
  official?: boolean;
  resolvedPackageUrl?: string;
  installed?: InstalledPlugin;
  runtime?: PluginRuntimeInfo;
  state: PluginMarketplaceEntryState;
  updateAvailable: boolean;
}

export interface PluginMarketplaceSnapshot {
  configured: boolean;
  /** Name of the first successfully loaded catalog. */
  catalogName?: string;
  registryDir: string;
  approvals: readonly PluginApprovalSnapshot[];
  catalogSignatureVerified?: boolean;
  /** First catalog error, kept so single-catalog consumers keep working. */
  catalogError?: string;
  /** Every configured catalog, in resolution order, including failed ones. */
  catalogs: readonly PluginCatalogSourceStatus[];
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
  catalogName?: string;
  catalogSource?: string;
  official?: boolean;
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
    catalogName: options.catalogName,
    catalogSource: options.catalogSource,
    official: options.official,
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
    permissions: runtime ? [...runtime.manifest.permissions] : [...installed.grantedPermissions],
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
    private readonly catalogStore: PluginCatalogStore = createPluginCatalogStoreFromEnv(env),
  ) {}

  /**
   * Catalog configuration including the user's stored catalogs. Every catalog
   * read goes through here so a UI-added catalog behaves exactly like one
   * configured by flag or environment variable.
   */
  private async catalogConfig(): Promise<PluginCatalogConfiguration> {
    return {
      ...pluginCatalogConfigFromEnv(this.env),
      storedCatalogs: await this.catalogStore.list(),
    };
  }

  async list(): Promise<PluginMarketplaceSnapshot> {
    const installed = await listInstalledPlugins(pluginRegistryDir(this.env));
    const aggregated = await loadAggregatedPluginCatalogs(await this.catalogConfig());
    return this.snapshot(aggregated, installed);
  }

  async install(pluginId: string): Promise<PluginMarketplaceSnapshot> {
    const found = await this.requireCatalogEntry(pluginId);
    const source = found.source;
    const catalogVerification = resolvePluginCatalogLoadOptions(source, await this.catalogConfig());
    const entry = found.entry;
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
    const found = await this.requireCatalogEntry(pluginId);
    this.assertInstallable(found.entry);
    const enabled =
      this.runtimePlugin(pluginId)?.enabled ?? (await this.stateStore.loadEnabled(pluginId));
    const snapshot = await this.snapshotInstalledPlugin(pluginId);
    const source = found.source;
    const catalogVerification = resolvePluginCatalogLoadOptions(source, await this.catalogConfig());
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
    aggregated: AggregatedPluginCatalogs,
    installed: readonly InstalledPlugin[],
  ): Promise<PluginMarketplaceSnapshot> {
    const installedById = new Map(installed.map((plugin) => [plugin.id, plugin]));
    const runtimeById = new Map(
      this.registry.listPlugins().map((runtime) => [runtime.manifest.id, runtime]),
    );
    const entries: PluginMarketplaceEntry[] = [];

    for (const aggregatedEntry of aggregated.entries) {
      const { entry: catalogEntry } = aggregatedEntry;
      const installedPlugin = installedById.get(catalogEntry.id);
      entries.push(
        catalogMarketplaceEntry({
          catalogEntry,
          installed: installedPlugin,
          runtime: runtimeById.get(catalogEntry.id),
          catalogSignatureVerified: aggregatedEntry.catalogSignatureVerified,
          catalogName: aggregatedEntry.catalogName,
          catalogSource: aggregatedEntry.source,
          official: aggregatedEntry.official,
        }),
      );
      installedById.delete(catalogEntry.id);
    }

    for (const installedPlugin of installedById.values()) {
      entries.push(localMarketplaceEntry(installedPlugin, runtimeById.get(installedPlugin.id)));
    }

    const firstLoaded = aggregated.catalogs.find((catalog) => !catalog.error);
    const firstError = aggregated.catalogs.find((catalog) => catalog.error);

    return {
      configured: aggregated.catalogs.length > 0,
      catalogName: firstLoaded?.name ?? firstError?.name,
      registryDir: pluginRegistryDir(this.env),
      approvals: this.registry.listPluginApprovals(),
      catalogSignatureVerified: firstLoaded?.signatureVerified,
      catalogError: firstError?.error,
      catalogs: aggregated.catalogs,
      entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  /** Catalogs the user added through the UI, with their pinned key fingerprints. */
  async listCatalogs(): Promise<readonly StoredPluginCatalog[]> {
    return this.catalogStore.list();
  }

  /**
   * Trusts a catalog on first use. The caller supplies the source only; the key
   * is discovered from the publisher and must verify the catalog's signature,
   * so an unsigned or mis-signed catalog is refused rather than stored.
   */
  async addCatalog(source: string): Promise<PluginMarketplaceSnapshot> {
    const trimmed = source.trim();
    if (!trimmed) {
      throw new PluginOperationError(400, 'Catalog source is required');
    }
    // Reject anything already active, not just already stored. Storing a record
    // for the official catalog or one set by flag would mark it user-added and
    // give it a Remove button that could not actually remove it.
    if (resolvePluginCatalogSources(await this.catalogConfig()).includes(trimmed)) {
      throw new PluginOperationError(409, `Catalog is already configured: ${trimmed}`);
    }
    const preview = await previewPluginCatalog(trimmed);
    if (!preview.signatureVerified || !preview.publicKey) {
      throw new PluginOperationError(
        400,
        preview.problem ?? 'Catalog signature could not be verified',
      );
    }
    await this.catalogStore.add({
      source: trimmed,
      name: preview.name,
      keyId: preview.keyId,
      publicKey: preview.publicKey,
      fingerprint: preview.fingerprint,
      addedAt: Date.now(),
    });
    return this.list();
  }

  async removeCatalog(source: string): Promise<PluginMarketplaceSnapshot> {
    const removed = await this.catalogStore.remove(source.trim());
    if (!removed) {
      throw new PluginOperationError(404, `Catalog is not added: ${source}`);
    }
    return this.list();
  }

  private async requireCatalogSource(): Promise<string> {
    const source = resolvePluginCatalogSources(await this.catalogConfig())[0];
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

  /**
   * Resolves the entry together with the catalog that provided it, so installs
   * fetch from the right source instead of assuming a single configured catalog.
   */
  private async requireCatalogEntry(pluginId: string): Promise<AggregatedPluginCatalogEntry> {
    await this.requireCatalogSource();
    const aggregated = await loadAggregatedPluginCatalogs(await this.catalogConfig());
    const found = findAggregatedEntry(aggregated, pluginId);
    if (!found) {
      const failed = aggregated.catalogs.find((catalog) => catalog.error);
      if (failed) {
        throw new PluginOperationError(
          502,
          `Plugin catalog entry not found: ${pluginId} (catalog ${failed.source} failed: ${failed.error})`,
        );
      }
      throw new PluginOperationError(404, `Plugin catalog entry not found: ${pluginId}`);
    }
    return found;
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
      grantedPermissions: () => installed.grantedPermissions,
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
