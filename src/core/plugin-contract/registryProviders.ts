import {
  hydrateEntityAction,
  validateEntityActionResult,
  validateEntityActions,
  type EntityAction,
  type EntityActionResult,
} from '../entities/actions.js';
import type {
  EntityDiagnosticProvider,
  EntityExecProvider,
  EntityFilesystemProvider,
  EntityInspectProvider,
  EntityLifecycleProvider,
  EntityLogStreamProvider,
  EntityLogsProvider,
  EntityOperationDescriptor,
  EntityProvider,
  EntityRef,
  EntityStatsProvider,
  LifecycleAction,
  LogsOptions,
  ProjectAction,
  ProjectProvider,
  RemoveOptions,
  ResourceAction,
  ResourceActionOptions,
  ResourceProvider,
} from '../entities/operations.js';
import { adaptEntitySource } from '../sources/entities.js';
import type { DataSourceDescriptor, GraphSourceAdapter } from '../sources/model.js';
import {
  validateMetricAnalysisResult,
  type MetricAnalysisFinding,
  type MetricAnalysisSample,
} from './analysis.js';
import { type PluginCapability } from './capabilities.js';
import { validatePluginConfigValues } from './config.js';
import {
  validatePluginConnectionProvider,
  validatePluginConnections,
  type PluginConnection,
  type PluginConnectionProvider,
  type PluginConnectionProviderDescriptor,
} from './connections.js';
import { DockscopePlugin, PluginOperationError, requireManifestCapabilities } from './manifest.js';
import { validatePluginSystems, type PluginSystemSnapshot } from './system.js';

interface PluginAccess {
  activePlugins(): DockscopePlugin[];
  requireEnabledPlugin(id: string): DockscopePlugin;
}

/** Internal provider selection, validation, and dispatch over the registry's live plugin set. */
export class RegistryProviders {
  constructor(private readonly access: PluginAccess) {}

  listDataSources(): DataSourceDescriptor[] {
    return this.getGraphSources().map((source) => source.describe());
  }

  getGraphSources(): GraphSourceAdapter[] {
    return this.access
      .activePlugins()
      .flatMap((plugin) => [
        ...(plugin.getGraphSources?.() ?? []),
        ...(plugin.getEntitySources?.() ?? []).map(adaptEntitySource),
      ]);
  }

  async getStats(ref: EntityRef) {
    return (await this.requireProvider('source.metrics', this.getStatsProviders(), ref)).getStats(
      ref,
    );
  }

  async listEntityActions(ref: EntityRef): Promise<EntityAction[]> {
    const actions = new Map<string, EntityAction>();
    for (const plugin of this.access.activePlugins()) {
      for (const provider of plugin.getActionProviders?.() ?? []) {
        if (!(await provider.canHandle(ref))) {
          continue;
        }
        for (const declaration of validateEntityActions(await provider.listActions(ref))) {
          requireManifestCapabilities(
            plugin.manifest,
            [declaration.capability],
            `declares entity action "${declaration.id}"`,
          );
          const action = hydrateEntityAction(plugin.manifest.id, declaration);
          actions.set(`${action.pluginId}:${action.id}`, action);
        }
      }
    }
    return [...actions.values()].sort(
      (a, b) =>
        (a.placement === 'primary' ? 0 : 1) - (b.placement === 'primary' ? 0 : 1) ||
        a.title.localeCompare(b.title) ||
        a.pluginId.localeCompare(b.pluginId),
    );
  }

  async listEntityOperations(ref: EntityRef): Promise<EntityOperationDescriptor[]> {
    const operations = new Map<string, EntityOperationDescriptor>();
    for (const plugin of this.access.activePlugins()) {
      const actionCapability = plugin.manifest.capabilities.find((capability) =>
        capability.startsWith('action.'),
      );
      const candidates: Array<{
        id: EntityOperationDescriptor['id'];
        capability: PluginCapability;
        providers: readonly EntityProvider[];
      }> = [
        {
          id: 'actions',
          capability: actionCapability ?? 'action.lifecycle',
          providers: plugin.getActionProviders?.() ?? [],
        },
        {
          id: 'stats',
          capability: 'source.metrics',
          providers: plugin.getStatsProviders?.() ?? [],
        },
        { id: 'logs', capability: 'source.logs', providers: plugin.getLogsProviders?.() ?? [] },
        {
          id: 'logStream',
          capability: 'source.logs',
          providers: plugin.getLogStreamProviders?.() ?? [],
        },
        {
          id: 'inspect',
          capability: 'source.inspect',
          providers: plugin.getInspectProviders?.() ?? [],
        },
        {
          id: 'top',
          capability: 'action.filesystem',
          providers: plugin.getFilesystemProviders?.() ?? [],
        },
        {
          id: 'diff',
          capability: 'action.filesystem',
          providers: plugin.getFilesystemProviders?.() ?? [],
        },
        {
          id: 'diagnostic',
          capability: 'analysis.diagnostics',
          providers: plugin.getDiagnosticProviders?.() ?? [],
        },
        { id: 'exec', capability: 'action.exec', providers: plugin.getExecProviders?.() ?? [] },
      ];
      for (const candidate of candidates) {
        for (const provider of candidate.providers) {
          if (await provider.canHandle(ref)) {
            operations.set(`${plugin.manifest.id}:${candidate.id}`, {
              id: candidate.id,
              pluginId: plugin.manifest.id,
              capability: candidate.capability,
            });
            break;
          }
        }
      }
    }
    return [...operations.values()].sort(
      (a, b) => a.id.localeCompare(b.id) || a.pluginId.localeCompare(b.pluginId),
    );
  }

  async runEntityAction(
    ref: EntityRef,
    pluginId: string,
    actionId: string,
    input?: unknown,
  ): Promise<EntityActionResult> {
    const plugin = this.access.requireEnabledPlugin(pluginId);
    for (const provider of plugin.getActionProviders?.() ?? []) {
      if (!(await provider.canHandle(ref))) {
        continue;
      }
      const action = validateEntityActions(await provider.listActions(ref)).find(
        (candidate) => candidate.id === actionId,
      );
      if (!action) {
        continue;
      }
      requireManifestCapabilities(
        plugin.manifest,
        [action.capability],
        `declares entity action "${action.id}"`,
      );
      const values = validatePluginConfigValues(input, action.input);
      return validateEntityActionResult(await provider.runAction(ref, actionId, values));
    }
    throw new PluginOperationError(404, `Entity action not found: ${pluginId}/${actionId}`);
  }

  async analyzeMetric(sample: MetricAnalysisSample): Promise<MetricAnalysisFinding[]> {
    const findings: MetricAnalysisFinding[] = [];
    for (const plugin of this.access.activePlugins()) {
      for (const provider of plugin.getMetricAnalysisProviders?.() ?? []) {
        if (!(await provider.canHandle(sample.ref))) {
          continue;
        }
        const result = validateMetricAnalysisResult(await provider.analyze(sample));
        if (result) {
          findings.push({
            ...result,
            pluginId: plugin.manifest.id,
            metric: sample.metric,
            value: sample.value,
          });
        }
      }
    }
    return findings;
  }

  async listSystems(): Promise<PluginSystemSnapshot[]> {
    const systems = await Promise.all(
      this.access.activePlugins().flatMap((plugin) =>
        [...(plugin.getSystemProviders?.() ?? [])].map(async (provider) =>
          validatePluginSystems(await provider.listSystems()).map((system) => ({
            ...system,
            pluginId: plugin.manifest.id,
          })),
        ),
      ),
    );
    return systems
      .flat()
      .sort((a, b) => a.label.localeCompare(b.label) || a.pluginId.localeCompare(b.pluginId));
  }

  listConnectionProviders(): PluginConnectionProviderDescriptor[] {
    return this.getConnectionProviderEntries()
      .map(({ pluginId, declaration }) => ({ ...declaration, pluginId }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.pluginId.localeCompare(b.pluginId));
  }

  async listConnections(): Promise<PluginConnection[]> {
    const connections = await Promise.all(
      this.getConnectionProviderEntries().map(async ({ pluginId, providerId, provider }) =>
        validatePluginConnections(await provider.listConnections()).map((connection) => ({
          ...connection,
          pluginId,
          providerId,
        })),
      ),
    );
    return connections
      .flat()
      .sort(
        (a, b) =>
          a.label.localeCompare(b.label) ||
          a.pluginId.localeCompare(b.pluginId) ||
          a.providerId.localeCompare(b.providerId),
      );
  }

  async addConnection(pluginId: string, providerId: string, input: unknown): Promise<void> {
    const entry = this.getConnectionProviderEntries().find(
      (candidate) => candidate.pluginId === pluginId && candidate.providerId === providerId,
    );
    if (!entry) {
      throw new PluginOperationError(
        404,
        `Connection provider not found: ${pluginId}/${providerId}`,
      );
    }
    await entry.provider.addConnection(validatePluginConfigValues(input, entry.declaration.input));
  }

  async removeConnection(
    pluginId: string,
    providerId: string,
    connectionId: string,
  ): Promise<void> {
    const entry = this.getConnectionProviderEntries().find(
      (candidate) => candidate.pluginId === pluginId && candidate.providerId === providerId,
    );
    if (!entry) {
      throw new PluginOperationError(
        404,
        `Connection provider not found: ${pluginId}/${providerId}`,
      );
    }
    await entry.provider.removeConnection(connectionId);
  }

  async refreshConnections(): Promise<void> {
    await Promise.all(
      this.getConnectionProviderEntries().map(({ provider }) =>
        provider.refreshConnections?.().catch(() => {}),
      ),
    );
  }

  async getLogs(ref: EntityRef, options?: LogsOptions) {
    return (await this.requireProvider('source.logs', this.getLogsProviders(), ref)).getLogs(
      ref,
      options,
    );
  }

  async streamLogs(
    ref: EntityRef,
    onData: (text: string) => void,
    onError?: (error: Error) => void,
  ) {
    return (
      await this.requireProvider('source.logs', this.getLogStreamProviders(), ref)
    ).streamLogs(ref, onData, onError);
  }

  async runLifecycleAction(ref: EntityRef, action: LifecycleAction) {
    return (
      await this.requireProvider('action.lifecycle', this.getLifecycleProviders(), ref)
    ).runLifecycleAction(ref, action);
  }

  async removeEntity(ref: EntityRef, options?: RemoveOptions) {
    return (
      await this.requireProvider('action.lifecycle', this.getLifecycleProviders(), ref)
    ).removeEntity(ref, options);
  }

  async inspect(ref: EntityRef) {
    return (await this.requireProvider('source.inspect', this.getInspectProviders(), ref)).inspect(
      ref,
    );
  }

  async getTop(ref: EntityRef) {
    return (
      await this.requireProvider('action.filesystem', this.getFilesystemProviders(), ref)
    ).getTop(ref);
  }

  async getDiff(ref: EntityRef) {
    return (
      await this.requireProvider('action.filesystem', this.getFilesystemProviders(), ref)
    ).getDiff(ref);
  }

  async diagnose(ref: EntityRef) {
    return (
      await this.requireProvider('analysis.diagnostics', this.getDiagnosticProviders(), ref)
    ).diagnose(ref);
  }

  async createExecSession(ref: EntityRef, command?: string[]) {
    return (
      await this.requireProvider('action.exec', this.getExecProviders(), ref)
    ).createExecSession(ref, command);
  }

  async listProjects() {
    const projects = await Promise.all(
      this.getProjectProviderEntries().map(async ({ pluginId, providerId, provider }) =>
        (await provider.listProjects()).map((project) => ({
          ...project,
          pluginId,
          providerId,
        })),
      ),
    );
    return projects
      .flat()
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          (a.pluginId ?? '').localeCompare(b.pluginId ?? '') ||
          (a.providerId ?? '').localeCompare(b.providerId ?? ''),
      );
  }

  async runProjectAction(
    project: string,
    action: ProjectAction,
    owner: { pluginId?: string; providerId?: string } = {},
  ) {
    const matches = [];
    for (const entry of this.getProjectProviderEntries()) {
      if (owner.pluginId && entry.pluginId !== owner.pluginId) {
        continue;
      }
      if (owner.providerId && entry.providerId !== owner.providerId) {
        continue;
      }
      const handles = entry.provider.canHandle
        ? await entry.provider.canHandle(project)
        : (await entry.provider.listProjects()).some((candidate) => candidate.name === project);
      if (handles) {
        matches.push(entry);
      }
    }
    if (matches.length === 0) {
      throw new PluginOperationError(404, 'No plugin provider found for action.deploy');
    }
    if (matches.length > 1) {
      throw new PluginOperationError(
        409,
        `Project provider is ambiguous for "${project}"; specify pluginId and providerId`,
      );
    }
    return matches[0].provider.runProjectAction(project, action);
  }

  async getResourceLogs(resourceId: string, options?: LogsOptions) {
    return (await this.requireResourceProvider('source.logs', resourceId)).getResourceLogs(
      resourceId,
      options,
    );
  }

  async runResourceAction(
    resourceId: string,
    action: ResourceAction,
    options?: ResourceActionOptions,
  ) {
    return (await this.requireResourceProvider('action.lifecycle', resourceId)).runResourceAction(
      resourceId,
      action,
      options,
    );
  }

  private getStatsProviders(): EntityStatsProvider[] {
    return this.access
      .activePlugins()
      .flatMap((plugin) => [...(plugin.getStatsProviders?.() ?? [])]);
  }

  private getLogsProviders(): EntityLogsProvider[] {
    return this.access
      .activePlugins()
      .flatMap((plugin) => [...(plugin.getLogsProviders?.() ?? [])]);
  }

  private getLogStreamProviders(): EntityLogStreamProvider[] {
    return this.access
      .activePlugins()
      .flatMap((plugin) => [...(plugin.getLogStreamProviders?.() ?? [])]);
  }

  private getLifecycleProviders(): EntityLifecycleProvider[] {
    return this.access
      .activePlugins()
      .flatMap((plugin) => [...(plugin.getLifecycleProviders?.() ?? [])]);
  }

  private getInspectProviders(): EntityInspectProvider[] {
    return this.access
      .activePlugins()
      .flatMap((plugin) => [...(plugin.getInspectProviders?.() ?? [])]);
  }

  private getFilesystemProviders(): EntityFilesystemProvider[] {
    return this.access
      .activePlugins()
      .flatMap((plugin) => [...(plugin.getFilesystemProviders?.() ?? [])]);
  }

  private getDiagnosticProviders(): EntityDiagnosticProvider[] {
    return this.access
      .activePlugins()
      .flatMap((plugin) => [...(plugin.getDiagnosticProviders?.() ?? [])]);
  }

  private getExecProviders(): EntityExecProvider[] {
    return this.access
      .activePlugins()
      .flatMap((plugin) => [...(plugin.getExecProviders?.() ?? [])]);
  }

  private getProjectProviderEntries(): Array<{
    pluginId: string;
    providerId: string;
    provider: ProjectProvider;
  }> {
    return this.access.activePlugins().flatMap((plugin) =>
      [...(plugin.getProjectProviders?.() ?? [])].map((provider, index) => ({
        pluginId: plugin.manifest.id,
        providerId: provider.id ?? String(index),
        provider,
      })),
    );
  }

  private getConnectionProviderEntries(): Array<{
    pluginId: string;
    providerId: string;
    declaration: ReturnType<typeof validatePluginConnectionProvider>;
    provider: PluginConnectionProvider;
  }> {
    return this.access.activePlugins().flatMap((plugin) =>
      [...(plugin.getConnectionProviders?.() ?? [])].map((provider) => {
        const declaration = validatePluginConnectionProvider(provider.describe());
        return {
          pluginId: plugin.manifest.id,
          providerId: declaration.id,
          declaration,
          provider,
        };
      }),
    );
  }

  private getResourceProviders(): ResourceProvider[] {
    return this.access
      .activePlugins()
      .flatMap((plugin) => [...(plugin.getResourceProviders?.() ?? [])]);
  }

  private async requireProvider<
    T extends { canHandle(ref: EntityRef): boolean | Promise<boolean> },
  >(capability: PluginCapability, providers: readonly T[], ref: EntityRef): Promise<T> {
    let provider: T | undefined;
    for (const candidate of providers) {
      if (await candidate.canHandle(ref)) {
        provider = candidate;
        break;
      }
    }
    if (!provider) {
      throw new PluginOperationError(
        404,
        `No plugin provider found for ${capability} on ${ref.sourceId || 'default source'}`,
      );
    }
    return provider;
  }

  private async requireResourceProvider(
    capability: PluginCapability,
    resourceId: string,
  ): Promise<ResourceProvider> {
    let provider: ResourceProvider | undefined;
    for (const candidate of this.getResourceProviders()) {
      if (await candidate.canHandle(resourceId)) {
        provider = candidate;
        break;
      }
    }
    if (!provider) {
      throw new PluginOperationError(
        404,
        `No plugin provider found for ${capability} on ${resourceId}`,
      );
    }
    return provider;
  }
}
