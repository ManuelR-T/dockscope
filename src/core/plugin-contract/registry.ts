// PluginRegistry: owns plugin lifecycle, capability gating, and the provider
// fan-out that the rest of the app consumes. The manifest contract it validates
// against lives in ./manifest.js.
import { createHash } from 'crypto';
import { type AccessRole } from '../access.js';
import { type EntityAction, type EntityActionResult } from '../entities/actions.js';
import type {
  EntityOperationDescriptor,
  EntityRef,
  LifecycleAction,
  LogsOptions,
  ProjectAction,
  RemoveOptions,
  ResourceAction,
  ResourceActionOptions,
} from '../entities/operations.js';
import type { DataSourceDescriptor, GraphSourceAdapter } from '../sources/model.js';
import { type MetricAnalysisFinding, type MetricAnalysisSample } from './analysis.js';
import { type PluginPermission } from './capabilities.js';
import { type PluginCommand, type PluginCommandResult } from './commands.js';
import {
  createPluginCompatibilityReport,
  type PluginCompatibilityReport,
} from './compatibility.js';
import { defaultPluginConfig, validatePluginConfigValues, type PluginConfig } from './config.js';
import { type PluginConnection, type PluginConnectionProviderDescriptor } from './connections.js';
import { PluginEventBus, type PluginEvent, type PluginEventFilter } from './events.js';
import {
  DockscopePlugin,
  PLUGIN_CRASH_QUARANTINE_THRESHOLD,
  PLUGIN_CRASH_QUARANTINE_WINDOW_MS,
  PluginApprovalSnapshot,
  PluginApprovalWriter,
  PluginConfigSnapshot,
  PluginConfigWriter,
  PluginEventWriter,
  PluginLoadError,
  PluginLoadWarning,
  PluginOperationError,
  PluginReloadHandler,
  PluginReviewReport,
  PluginRuntimeInfo,
  PluginSecretWriter,
  PluginStateWriter,
  cloneRuntimeInfo,
  validatePluginContract,
  validatePluginManifest,
} from './manifest.js';
import { RegistryInteractions, pluginCommands } from './registryInteractions.js';
import { RegistryProviders } from './registryProviders.js';
import type {
  PluginProcessHealthSnapshot,
  PluginRuntimeCrash,
  PluginRuntimeHealth,
} from './runtime.js';
import { type PluginSecretSnapshot } from './secrets.js';
import { type PluginSystemSnapshot } from './system.js';
import { type PluginUiActionResult, type PluginUiContent, type PluginUiExtension } from './ui.js';

export class PluginRegistry {
  private readonly providers = new RegistryProviders({
    activePlugins: () => this.activePlugins(),
    requireEnabledPlugin: (id) => this.requireEnabledPlugin(id),
  });
  private readonly interactions = new RegistryInteractions({
    activePlugins: () => this.activePlugins(),
    getPlugin: (id) => this.plugins.get(id),
    requireEnabledPlugin: (id) => this.requireEnabledPlugin(id),
    publishEvent: (id, type, payload) => this.publishPluginEvent(id, type, payload),
  });
  private readonly plugins = new Map<string, DockscopePlugin>();
  private readonly runtime = new Map<string, PluginRuntimeInfo>();
  private readonly configs = new Map<string, PluginConfig>();
  private readonly loadErrors: PluginLoadError[] = [];
  private readonly loadWarnings: PluginLoadWarning[] = [];
  private readonly events: PluginEventBus;
  private readonly approvals = new Map<string, PluginApprovalSnapshot>();
  private readonly crashHistory = new Map<string, number[]>();
  private reloadHandler?: PluginReloadHandler;

  constructor(
    private readonly configWriter?: PluginConfigWriter,
    private readonly stateWriter?: PluginStateWriter,
    private readonly secretWriter?: PluginSecretWriter,
    private readonly eventWriter?: PluginEventWriter,
    initialEvents: readonly PluginEvent[] = [],
    private readonly approvalWriter?: PluginApprovalWriter,
    initialApprovals: readonly PluginApprovalSnapshot[] = [],
  ) {
    this.events = new PluginEventBus(500, initialEvents);
    for (const approval of initialApprovals) {
      this.approvals.set(approval.pluginId, { ...approval });
    }
  }

  register(
    plugin: DockscopePlugin,
    initialConfig?: PluginConfig,
    options: {
      enabled?: boolean;
      quarantined?: boolean;
      quarantineReason?: string;
      crashCount?: number;
      lastCrashAt?: number;
      lastCrashError?: string;
      quarantinedAt?: number;
      recentCrashTimes?: readonly number[];
    } = {},
  ): void {
    const manifest = validatePluginManifest(plugin.manifest);
    validatePluginContract(plugin, manifest);
    const { id } = manifest;
    if (this.plugins.has(id)) {
      throw new Error(`Plugin already registered: ${id}`);
    }
    const config = initialConfig
      ? validatePluginConfigValues(initialConfig, manifest.config, { partial: true })
      : defaultPluginConfig(manifest.config);
    this.plugins.set(id, { ...plugin, manifest });
    this.configs.set(id, config);
    const enabled = options.enabled ?? true;
    const quarantined = options.quarantined === true && !manifest.builtin;
    const recentCrashTimes = (options.recentCrashTimes ?? []).filter(
      (time) => Number.isFinite(time) && time >= Date.now() - PLUGIN_CRASH_QUARANTINE_WINDOW_MS,
    );
    if (recentCrashTimes.length > 0) {
      this.crashHistory.set(id, [...recentCrashTimes]);
    }
    this.runtime.set(id, {
      manifest,
      status: quarantined ? 'quarantined' : enabled ? 'registered' : 'disabled',
      enabled: quarantined ? false : enabled,
      registeredAt: Date.now(),
      crashCount: options.crashCount ?? 0,
      lastCrashAt: options.lastCrashAt,
      lastCrashError: options.lastCrashError,
      quarantinedAt: quarantined ? (options.quarantinedAt ?? Date.now()) : undefined,
      quarantineReason: quarantined ? options.quarantineReason : undefined,
    });
  }

  recordLoadError(error: PluginLoadError): void {
    this.loadErrors.push(error);
  }

  recordLoadWarning(warning: PluginLoadWarning): void {
    this.loadWarnings.push(warning);
  }

  setReloadHandler(handler: PluginReloadHandler): void {
    this.reloadHandler = handler;
  }

  async startPlugin(pluginId: string): Promise<PluginRuntimeInfo> {
    if (!this.plugins.has(pluginId) || !this.runtime.has(pluginId)) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    await this.start(pluginId);
    return cloneRuntimeInfo(this.runtime.get(pluginId)!);
  }

  async unregisterPlugin(pluginId: string): Promise<{ ok: true }> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    if (plugin.manifest.builtin) {
      throw new PluginOperationError(400, `Built-in plugin cannot be unregistered: ${pluginId}`);
    }
    await this.stop(pluginId);
    this.plugins.delete(pluginId);
    this.runtime.delete(pluginId);
    this.crashHistory.delete(pluginId);
    this.configs.delete(pluginId);
    return { ok: true };
  }

  listPlugins(): PluginRuntimeInfo[] {
    return [...this.runtime.values()].map(cloneRuntimeInfo);
  }

  listPluginErrors(): PluginLoadError[] {
    return this.loadErrors.map((error) => ({ ...error }));
  }

  listPluginWarnings(): PluginLoadWarning[] {
    return this.loadWarnings.map((warning) => ({ ...warning }));
  }

  async recordRuntimeCrash(pluginId: string, crash: PluginRuntimeCrash): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    const runtime = this.runtime.get(pluginId);
    if (!plugin || !runtime) {
      return;
    }
    const cutoff = crash.time - PLUGIN_CRASH_QUARANTINE_WINDOW_MS;
    const history = [...(this.crashHistory.get(pluginId) ?? []), crash.time].filter(
      (time) => time >= cutoff,
    );
    this.crashHistory.set(pluginId, history);
    const crashedRuntime: PluginRuntimeInfo = {
      ...runtime,
      crashCount: runtime.crashCount + 1,
      lastCrashAt: crash.time,
      lastCrashError: crash.message,
      error: crash.message,
    };
    this.runtime.set(pluginId, crashedRuntime);

    if (
      !plugin.manifest.builtin &&
      runtime.enabled &&
      history.length >= PLUGIN_CRASH_QUARANTINE_THRESHOLD
    ) {
      await this.stop(pluginId).catch(() => {});
      const stopped = this.runtime.get(pluginId) ?? crashedRuntime;
      const reason = `${history.length} crashes within ${PLUGIN_CRASH_QUARANTINE_WINDOW_MS / 1000}s`;
      const quarantined: PluginRuntimeInfo = {
        ...stopped,
        enabled: false,
        status: 'quarantined',
        error: crash.message,
        crashCount: crashedRuntime.crashCount,
        lastCrashAt: crash.time,
        lastCrashError: crash.message,
        quarantinedAt: crash.time,
        quarantineReason: reason,
      };
      this.runtime.set(pluginId, quarantined);
      await this.saveRuntimeState(pluginId, quarantined);
      this.publishPluginEvent(pluginId, 'runtime.quarantined', {
        reason,
        crashCount: quarantined.crashCount,
        lastCrashError: crash.message,
      });
      return;
    }
    await this.saveRuntimeState(pluginId, crashedRuntime);
  }

  async listPluginRuntimeHealth(): Promise<PluginRuntimeHealth[]> {
    return Promise.all(
      [...this.plugins.values()].map(async (plugin) => {
        const runtime = this.runtime.get(plugin.manifest.id)!;
        const isolation = plugin.manifest.execution?.isolation ?? 'in-process';
        let processHealth: PluginProcessHealthSnapshot | undefined;
        try {
          processHealth = await plugin.getRuntimeHealth?.();
        } catch {
          processHealth = undefined;
        }
        const defaultState: PluginProcessHealthSnapshot['state'] =
          runtime.status === 'started'
            ? 'running'
            : runtime.status === 'failed'
              ? 'crashed'
              : 'stopped';
        return {
          pluginId: plugin.manifest.id,
          isolation,
          enabled: runtime.enabled,
          state: processHealth?.state ?? defaultState,
          pid: processHealth?.pid,
          startedAt: processHealth?.startedAt ?? runtime.startedAt,
          lastOperationAt: processHealth?.lastOperationAt,
          restartCount: processHealth?.restartCount ?? 0,
          pendingOperations: processHealth?.pendingOperations ?? 0,
          openStreams: processHealth?.openStreams ?? 0,
          stderrBytes: processHealth?.stderrBytes ?? 0,
          operationTimeoutMs:
            processHealth?.operationTimeoutMs ??
            plugin.manifest.execution?.operationTimeoutMs ??
            plugin.manifest.execution?.commandTimeoutMs ??
            30_000,
          memoryLimitMb:
            processHealth?.memoryLimitMb ?? plugin.manifest.execution?.memoryLimitMb ?? 0,
          maxStderrBytes:
            processHealth?.maxStderrBytes ?? plugin.manifest.execution?.maxStderrBytes ?? 0,
          lastCrashAt: processHealth?.lastCrashAt ?? runtime.lastCrashAt,
          lastCrashError: processHealth?.lastCrashError ?? runtime.lastCrashError,
          metrics: processHealth?.metrics,
          crashCount: runtime.crashCount,
          quarantinedAt: runtime.quarantinedAt,
          quarantineReason: runtime.quarantineReason,
        };
      }),
    );
  }

  listUiExtensions(): PluginUiExtension[] {
    return this.interactions.listUiExtensions();
  }

  async queryPluginUi(
    pluginId: string,
    extensionId: string,
    rawContext?: unknown,
  ): Promise<PluginUiContent> {
    return this.interactions.queryPluginUi(pluginId, extensionId, rawContext);
  }

  async getPluginFrontendBundle(pluginId: string): Promise<string> {
    return this.interactions.getPluginFrontendBundle(pluginId);
  }

  async runPluginUiAction(
    pluginId: string,
    extensionId: string,
    payload: { context?: unknown; input?: unknown } = {},
    options: { accessRole?: AccessRole } = {},
  ): Promise<PluginUiActionResult> {
    return this.interactions.runPluginUiAction(pluginId, extensionId, payload, options);
  }

  listPluginCommands(): PluginCommand[] {
    return this.interactions.listPluginCommands();
  }

  async runPluginCommand(
    pluginId: string,
    commandId: string,
    input?: unknown,
  ): Promise<PluginCommandResult> {
    return this.interactions.runPluginCommand(pluginId, commandId, input);
  }

  async runPluginMigration(
    pluginId: string,
    from: string,
    to: string,
    input?: unknown,
  ): Promise<PluginCommandResult> {
    return this.interactions.runPluginMigration(pluginId, from, to, input);
  }

  publishPluginEvent(pluginId: string, type: string, payload: unknown): PluginEvent {
    const event = this.events.publish(pluginId, type, payload);
    void this.eventWriter?.save(this.events.list());
    return event;
  }

  listPluginEvents(filter: PluginEventFilter = {}): PluginEvent[] {
    return this.events.list(filter);
  }

  listPluginCompatibility(currentVersion: string): PluginCompatibilityReport[] {
    return [...this.plugins.values()]
      .filter((plugin) => !plugin.manifest.builtin)
      .map((plugin) => createPluginCompatibilityReport(plugin.manifest, currentVersion))
      .sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  }

  listPluginReviews(currentVersion: string): PluginReviewReport[] {
    return [...this.plugins.values()]
      .filter((plugin) => !plugin.manifest.builtin)
      .map((plugin) => {
        const runtime = this.runtime.get(plugin.manifest.id);
        const compatibility = createPluginCompatibilityReport(plugin.manifest, currentVersion);
        const riskReasons = this.pluginRiskReasons(plugin, compatibility);
        const fingerprint = this.pluginApprovalFingerprint(plugin);
        const approval = this.approvals.get(plugin.manifest.id);
        const approvalStatus: PluginReviewReport['approvalStatus'] =
          approval?.fingerprint === fingerprint ? 'approved' : approval ? 'changed' : 'unapproved';
        const riskLevel: PluginReviewReport['riskLevel'] = riskReasons.some((reason) =>
          reason.startsWith('high:'),
        )
          ? 'high'
          : riskReasons.length > 0
            ? 'medium'
            : 'low';
        return {
          pluginId: plugin.manifest.id,
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          enabled: runtime?.enabled ?? false,
          status: runtime?.status ?? 'registered',
          builtin: plugin.manifest.builtin === true,
          capabilities: [...plugin.manifest.capabilities],
          permissions: [...plugin.manifest.permissions],
          secrets: (plugin.manifest.secrets ?? []).map((secret) => secret.key),
          commands: pluginCommands(plugin).map((command) => command.id),
          uiSlots: (plugin.manifest.ui ?? []).map((extension) => extension.slot),
          frontendSlots: [...(plugin.manifest.frontend?.slots ?? [])],
          configFields: (plugin.manifest.config?.fields ?? []).map((field) => field.key),
          executionIsolation: plugin.manifest.execution?.isolation ?? 'in-process',
          compatibilityWarnings: compatibility.warnings,
          riskLevel,
          riskReasons: riskReasons.map((reason) => reason.replace(/^(high|medium):/, '')),
          approvalStatus,
          fingerprint,
          approvedAt: approval?.approvedAt,
          approvedFingerprint: approval?.fingerprint,
        };
      })
      .sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  }

  listPluginApprovals(): PluginApprovalSnapshot[] {
    return [...this.approvals.values()].map((approval) => ({ ...approval }));
  }

  async approvePlugin(pluginId: string): Promise<PluginApprovalSnapshot> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    if (plugin.manifest.builtin) {
      throw new PluginOperationError(400, `Built-in plugin does not need approval: ${pluginId}`);
    }
    const approval: PluginApprovalSnapshot = {
      pluginId,
      fingerprint: this.pluginApprovalFingerprint(plugin),
      approvedAt: Date.now(),
    };
    this.approvals.set(pluginId, approval);
    await this.approvalWriter?.save(this.listPluginApprovals());
    return { ...approval };
  }

  async revokePluginApproval(pluginId: string): Promise<{ ok: true }> {
    this.approvals.delete(pluginId);
    await this.approvalWriter?.save(this.listPluginApprovals());
    return { ok: true };
  }

  listPluginConfigs(): PluginConfigSnapshot[] {
    return [...this.plugins.values()].map((plugin) => ({
      pluginId: plugin.manifest.id,
      schema: plugin.manifest.config
        ? {
            fields: plugin.manifest.config.fields.map((field) => ({
              ...field,
              options: field.options ? [...field.options] : undefined,
            })),
          }
        : undefined,
      values: { ...(this.configs.get(plugin.manifest.id) ?? {}) },
    }));
  }

  getPluginConfig(pluginId: string): PluginConfigSnapshot {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    return this.listPluginConfigs().find((config) => config.pluginId === pluginId)!;
  }

  async listPluginSecrets(): Promise<PluginSecretSnapshot[]> {
    const snapshots = await Promise.all(
      [...this.plugins.values()].map(async (plugin) => ({
        pluginId: plugin.manifest.id,
        secrets: await Promise.all(
          (plugin.manifest.secrets ?? []).map(async (secret) => ({
            ...secret,
            configured: (await this.secretWriter?.has(plugin.manifest.id, secret.key)) ?? false,
          })),
        ),
      })),
    );
    return snapshots.filter((snapshot) => snapshot.secrets.length > 0);
  }

  async updatePluginSecret(
    pluginId: string,
    key: string,
    value: unknown,
  ): Promise<PluginSecretSnapshot> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    if (!this.secretWriter) {
      throw new PluginOperationError(500, 'Plugin secret store is not configured');
    }
    const declaration = plugin.manifest.secrets?.find((secret) => secret.key === key);
    if (!declaration) {
      throw new PluginOperationError(404, `Plugin secret not found: ${pluginId}/${key}`);
    }
    if (typeof value !== 'string') {
      throw new PluginOperationError(400, 'Plugin secret value must be a string');
    }
    await this.secretWriter.set(pluginId, key, value);
    const snapshot = (await this.listPluginSecrets()).find((item) => item.pluginId === pluginId);
    if (!snapshot) {
      throw new PluginOperationError(404, `Plugin secrets not found: ${pluginId}`);
    }
    return snapshot;
  }

  async updatePluginConfig(pluginId: string, values: unknown): Promise<PluginConfigSnapshot> {
    const plugin = this.plugins.get(pluginId);
    const runtime = this.runtime.get(pluginId);
    if (!plugin || !runtime) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    if (!plugin.manifest.config) {
      throw new PluginOperationError(400, `Plugin does not expose configuration: ${pluginId}`);
    }
    const config = validatePluginConfigValues(
      {
        ...(this.configs.get(pluginId) ?? {}),
        ...(typeof values === 'object' && values !== null && !Array.isArray(values) ? values : {}),
      },
      plugin.manifest.config,
    );
    try {
      await plugin.configure?.(config);
      await this.configWriter?.save(pluginId, config);
      this.configs.set(pluginId, config);
    } catch (error) {
      const current = this.runtime.get(pluginId) ?? runtime;
      this.runtime.set(pluginId, {
        ...current,
        status: current.status === 'quarantined' ? 'quarantined' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return this.getPluginConfig(pluginId);
  }

  async enablePlugin(pluginId: string): Promise<PluginRuntimeInfo> {
    const plugin = this.plugins.get(pluginId);
    const runtime = this.runtime.get(pluginId);
    if (!plugin || !runtime) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    if (plugin.manifest.builtin) {
      throw new PluginOperationError(400, `Built-in plugin cannot be toggled: ${pluginId}`);
    }
    this.crashHistory.delete(pluginId);
    const enabledRuntime: PluginRuntimeInfo = {
      ...runtime,
      enabled: true,
      status:
        runtime.status === 'disabled' || runtime.status === 'quarantined'
          ? 'registered'
          : runtime.status,
      error: undefined,
      crashCount: 0,
      lastCrashAt: undefined,
      lastCrashError: undefined,
      quarantinedAt: undefined,
      quarantineReason: undefined,
    };
    this.runtime.set(pluginId, enabledRuntime);
    await this.saveRuntimeState(pluginId, enabledRuntime);
    await this.start(pluginId);
    const updated = this.runtime.get(pluginId);
    if (!updated) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    return cloneRuntimeInfo(updated);
  }

  async disablePlugin(pluginId: string): Promise<PluginRuntimeInfo> {
    const plugin = this.plugins.get(pluginId);
    const runtime = this.runtime.get(pluginId);
    if (!plugin || !runtime) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    if (plugin.manifest.builtin) {
      throw new PluginOperationError(400, `Built-in plugin cannot be toggled: ${pluginId}`);
    }
    await this.stop(pluginId);
    const stopped = this.runtime.get(pluginId) ?? runtime;
    const disabledRuntime: PluginRuntimeInfo = {
      ...stopped,
      enabled: false,
      status: 'disabled',
      error: undefined,
      quarantinedAt: undefined,
      quarantineReason: undefined,
    };
    this.runtime.set(pluginId, disabledRuntime);
    await this.saveRuntimeState(pluginId, disabledRuntime);
    return cloneRuntimeInfo(this.runtime.get(pluginId)!);
  }

  async reloadPlugin(pluginId: string): Promise<PluginRuntimeInfo> {
    const oldPlugin = this.plugins.get(pluginId);
    const oldRuntime = this.runtime.get(pluginId);
    if (!oldPlugin || !oldRuntime) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    if (oldPlugin.manifest.builtin) {
      throw new PluginOperationError(400, `Built-in plugin cannot be reloaded: ${pluginId}`);
    }
    if (!this.reloadHandler) {
      throw new PluginOperationError(500, 'Plugin reload handler is not configured');
    }
    await this.stop(pluginId);
    const reloaded = await this.reloadHandler(pluginId);
    const manifest = validatePluginManifest(reloaded.plugin.manifest);
    if (manifest.id !== pluginId) {
      throw new PluginOperationError(
        400,
        `Reloaded plugin id "${manifest.id}" does not match "${pluginId}"`,
      );
    }
    validatePluginContract(reloaded.plugin, manifest);
    const config = reloaded.config
      ? validatePluginConfigValues(reloaded.config, manifest.config, { partial: true })
      : (this.configs.get(pluginId) ?? defaultPluginConfig(manifest.config));
    const enabled = oldRuntime.status === 'quarantined' ? true : oldRuntime.enabled;
    this.plugins.set(pluginId, { ...reloaded.plugin, manifest });
    this.configs.set(pluginId, config);
    this.crashHistory.delete(pluginId);
    this.runtime.set(pluginId, {
      manifest,
      enabled,
      status: enabled ? 'registered' : 'disabled',
      registeredAt: oldRuntime.registeredAt,
      stoppedAt: Date.now(),
      crashCount: 0,
    });
    await this.saveRuntimeState(pluginId, this.runtime.get(pluginId)!);
    if (enabled) {
      await this.start(pluginId);
    }
    return cloneRuntimeInfo(this.runtime.get(pluginId)!);
  }

  listDataSources(): DataSourceDescriptor[] {
    return this.providers.listDataSources();
  }

  getGraphSources(): GraphSourceAdapter[] {
    return this.providers.getGraphSources();
  }

  async getStats(ref: EntityRef) {
    return this.providers.getStats(ref);
  }

  async listEntityActions(ref: EntityRef): Promise<EntityAction[]> {
    return this.providers.listEntityActions(ref);
  }

  async listEntityOperations(ref: EntityRef): Promise<EntityOperationDescriptor[]> {
    return this.providers.listEntityOperations(ref);
  }

  async runEntityAction(
    ref: EntityRef,
    pluginId: string,
    actionId: string,
    input?: unknown,
  ): Promise<EntityActionResult> {
    return this.providers.runEntityAction(ref, pluginId, actionId, input);
  }

  async analyzeMetric(sample: MetricAnalysisSample): Promise<MetricAnalysisFinding[]> {
    return this.providers.analyzeMetric(sample);
  }

  async listSystems(): Promise<PluginSystemSnapshot[]> {
    return this.providers.listSystems();
  }

  listConnectionProviders(): PluginConnectionProviderDescriptor[] {
    return this.providers.listConnectionProviders();
  }

  async listConnections(): Promise<PluginConnection[]> {
    return this.providers.listConnections();
  }

  async addConnection(pluginId: string, providerId: string, input: unknown): Promise<void> {
    return this.providers.addConnection(pluginId, providerId, input);
  }

  async removeConnection(
    pluginId: string,
    providerId: string,
    connectionId: string,
  ): Promise<void> {
    return this.providers.removeConnection(pluginId, providerId, connectionId);
  }

  async refreshConnections(): Promise<void> {
    return this.providers.refreshConnections();
  }

  async getLogs(ref: EntityRef, options?: LogsOptions) {
    return this.providers.getLogs(ref, options);
  }

  async streamLogs(
    ref: EntityRef,
    onData: (text: string) => void,
    onError?: (error: Error) => void,
  ) {
    return this.providers.streamLogs(ref, onData, onError);
  }

  async runLifecycleAction(ref: EntityRef, action: LifecycleAction) {
    return this.providers.runLifecycleAction(ref, action);
  }

  async removeEntity(ref: EntityRef, options?: RemoveOptions) {
    return this.providers.removeEntity(ref, options);
  }

  async inspect(ref: EntityRef) {
    return this.providers.inspect(ref);
  }

  async getTop(ref: EntityRef) {
    return this.providers.getTop(ref);
  }

  async getDiff(ref: EntityRef) {
    return this.providers.getDiff(ref);
  }

  async diagnose(ref: EntityRef) {
    return this.providers.diagnose(ref);
  }

  async createExecSession(ref: EntityRef, command?: string[]) {
    return this.providers.createExecSession(ref, command);
  }

  async listProjects() {
    return this.providers.listProjects();
  }

  async runProjectAction(
    project: string,
    action: ProjectAction,
    owner: { pluginId?: string; providerId?: string } = {},
  ) {
    return this.providers.runProjectAction(project, action, owner);
  }

  async getResourceLogs(resourceId: string, options?: LogsOptions) {
    return this.providers.getResourceLogs(resourceId, options);
  }

  async runResourceAction(
    resourceId: string,
    action: ResourceAction,
    options?: ResourceActionOptions,
  ) {
    return this.providers.runResourceAction(resourceId, action, options);
  }

  async startAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await this.start(plugin.manifest.id);
      } catch {
        // Keep one broken plugin from preventing the rest of the app from starting.
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const plugin of [...this.plugins.values()].reverse()) {
      try {
        await this.stop(plugin.manifest.id);
      } catch {
        // Continue shutdown even when one plugin fails to stop cleanly.
      }
    }
  }

  private async start(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    const runtime = this.runtime.get(id);
    if (!plugin || !runtime || runtime.status === 'started' || !runtime.enabled) {
      return;
    }

    try {
      await plugin.configure?.(this.configs.get(id) ?? {});
      await plugin.start?.();
      this.runtime.set(id, {
        ...runtime,
        status: 'started',
        startedAt: Date.now(),
        stoppedAt: undefined,
        error: undefined,
      });
    } catch (error) {
      const current = this.runtime.get(id) ?? runtime;
      this.runtime.set(id, {
        ...current,
        status: current.status === 'quarantined' ? 'quarantined' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private pluginRiskReasons(
    plugin: DockscopePlugin,
    compatibility: PluginCompatibilityReport,
  ): string[] {
    const reasons: string[] = [];
    const highPermissions: readonly PluginPermission[] = [
      'docker.socket',
      'kubernetes.api',
      'process.exec',
      'filesystem.write',
    ];
    for (const permission of highPermissions) {
      if (plugin.manifest.permissions.includes(permission)) {
        reasons.push(`high:requires ${permission}`);
      }
    }
    if (plugin.manifest.permissions.includes('network.http')) {
      reasons.push('medium:can call remote HTTP services');
    }
    if (plugin.manifest.permissions.includes('secrets.read')) {
      reasons.push('medium:can read declared secrets');
    }
    if ((plugin.manifest.secrets ?? []).some((secret) => secret.required)) {
      reasons.push('medium:requires configured secrets');
    }
    if ((plugin.manifest.commands ?? []).some((command) => command.confirm)) {
      reasons.push('medium:declares confirmation-gated commands');
    }
    if ((plugin.manifest.execution?.isolation ?? 'in-process') === 'in-process') {
      reasons.push('medium:runs plugin code in the main server process');
    }
    if (plugin.manifest.frontend) {
      reasons.push('medium:ships a sandboxed frontend bundle');
    }
    for (const warning of compatibility.warnings) {
      reasons.push(`medium:${warning}`);
    }
    return reasons;
  }

  private pluginApprovalFingerprint(plugin: DockscopePlugin): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          id: plugin.manifest.id,
          version: plugin.manifest.version,
          manifestVersion: plugin.manifest.manifestVersion,
          dockscopeApiVersion: plugin.manifest.dockscopeApiVersion,
          hostApiVersion: plugin.manifest.hostApiVersion,
          capabilities: [...plugin.manifest.capabilities].sort(),
          permissions: [...plugin.manifest.permissions].sort(),
          secrets: (plugin.manifest.secrets ?? []).map((secret) => ({
            key: secret.key,
            required: secret.required === true,
          })),
          commands: pluginCommands(plugin).map((command) => ({
            id: command.id,
            confirm: command.confirm === true,
          })),
          ui: (plugin.manifest.ui ?? []).map((extension) => ({
            id: extension.id,
            slot: extension.slot,
            action: extension.action,
            query: extension.query,
            frontendView: extension.frontendView,
          })),
          frontend: plugin.manifest.frontend ?? null,
          config: (plugin.manifest.config?.fields ?? []).map((field) => ({
            key: field.key,
            type: field.type,
            required: field.required === true,
          })),
          execution: plugin.manifest.execution ?? {},
        }),
      )
      .digest('hex');
  }

  private requireEnabledPlugin(pluginId: string): DockscopePlugin {
    const plugin = this.plugins.get(pluginId);
    const runtime = this.runtime.get(pluginId);
    if (!plugin || !runtime) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    if (!runtime.enabled) {
      throw new PluginOperationError(400, `Plugin is disabled: ${pluginId}`);
    }
    return plugin;
  }

  private activePlugins(): DockscopePlugin[] {
    return [...this.plugins.values()].filter(
      (plugin) => this.runtime.get(plugin.manifest.id)?.enabled ?? false,
    );
  }

  private async saveRuntimeState(pluginId: string, runtime: PluginRuntimeInfo): Promise<void> {
    if (this.stateWriter?.saveRuntimeState) {
      await this.stateWriter.saveRuntimeState(pluginId, {
        enabled: runtime.enabled,
        quarantined: runtime.status === 'quarantined',
        quarantineReason: runtime.quarantineReason,
        crashCount: runtime.crashCount,
        lastCrashAt: runtime.lastCrashAt,
        lastCrashError: runtime.lastCrashError,
        quarantinedAt: runtime.quarantinedAt,
        recentCrashTimes: this.crashHistory.get(pluginId) ?? [],
      });
      return;
    }
    await this.stateWriter?.saveEnabled(pluginId, runtime.enabled);
  }

  private async stop(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    const runtime = this.runtime.get(id);
    if (!plugin || !runtime || runtime.status !== 'started') {
      return;
    }

    try {
      await plugin.stop?.();
      this.runtime.set(id, {
        ...runtime,
        status: 'stopped',
        stoppedAt: Date.now(),
        error: undefined,
      });
    } catch (error) {
      const current = this.runtime.get(id) ?? runtime;
      this.runtime.set(id, {
        ...current,
        status: current.status === 'quarantined' ? 'quarantined' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
