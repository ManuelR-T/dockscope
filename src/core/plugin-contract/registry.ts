// PluginRegistry: owns plugin lifecycle, capability gating, and the provider
// fan-out that the rest of the app consumes. The manifest contract it validates
// against lives in ./manifest.js.
import { createHash } from 'crypto';
import { pluginUiActionAllowed, type AccessRole } from '../access.js';
import type { DataSourceDescriptor, GraphSourceAdapter } from '../sources/model.js';
import type {
  EntityDiagnosticProvider,
  EntityExecProvider,
  EntityFilesystemProvider,
  EntityInspectProvider,
  EntityLogStreamProvider,
  EntityLifecycleProvider,
  EntityLogsProvider,
  EntityRef,
  EntityStatsProvider,
  EntityOperationDescriptor,
  EntityProvider,
  LifecycleAction,
  LogsOptions,
  ProjectAction,
  ProjectProvider,
  RemoveOptions,
  ResourceAction,
  ResourceActionOptions,
  ResourceProvider,
} from '../entities/operations.js';
import {
  hydrateEntityAction,
  validateEntityActionResult,
  validateEntityActions,
  type EntityAction,
  type EntityActionResult,
} from '../entities/actions.js';
import {
  validateMetricAnalysisResult,
  type MetricAnalysisFinding,
  type MetricAnalysisSample,
} from './analysis.js';
import { validatePluginSystems, type PluginSystemSnapshot } from './system.js';
import {
  validatePluginConnectionProvider,
  validatePluginConnections,
  type PluginConnection,
  type PluginConnectionProvider,
  type PluginConnectionProviderDescriptor,
} from './connections.js';
import type {
  PluginProcessHealthSnapshot,
  PluginRuntimeCrash,
  PluginRuntimeHealth,
} from './runtime.js';
import { type PluginCapability, type PluginPermission } from './capabilities.js';
import { defaultPluginConfig, validatePluginConfigValues, type PluginConfig } from './config.js';
import {
  hydratePluginUiExtension,
  pluginUiContextMatches,
  pluginUiSlotCapability,
  validatePluginUiContext,
  validatePluginUiExtensions,
  type PluginUiActionResult,
  type PluginUiContext,
  type PluginUiExtension,
} from './ui.js';
import { type PluginSecretSnapshot } from './secrets.js';
import {
  hydratePluginCommand,
  validatePluginCommandResult,
  validatePluginCommands,
  type PluginCommand,
  type PluginCommandDeclaration,
  type PluginCommandResult,
} from './commands.js';
import { PluginEventBus, type PluginEvent, type PluginEventFilter } from './events.js';
import {
  createPluginCompatibilityReport,
  type PluginCompatibilityReport,
} from './compatibility.js';
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
  isRecord,
  requireManifestCapabilities,
  validatePluginContract,
  validatePluginManifest,
} from './manifest.js';

export class PluginRegistry {
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
    return this.activePlugins()
      .flatMap((plugin) => {
        try {
          const manifestExtensions = plugin.manifest.ui ?? [];
          const runtimeExtensions = validatePluginUiExtensions(plugin.getUiExtensions?.() ?? []);
          const extensions = [...manifestExtensions, ...runtimeExtensions];
          for (const extension of extensions) {
            requireManifestCapabilities(
              plugin.manifest,
              [pluginUiSlotCapability(extension.slot)],
              `declares UI extension "${extension.id}"`,
            );
          }
          return extensions.map((extension) =>
            hydratePluginUiExtension(plugin.manifest.id, extension),
          );
        } catch {
          return [];
        }
      })
      .sort(
        (a, b) =>
          (a.order ?? 0) - (b.order ?? 0) ||
          a.pluginId.localeCompare(b.pluginId) ||
          a.title.localeCompare(b.title),
      );
  }

  async getPluginFrontendBundle(pluginId: string): Promise<string> {
    const plugin = this.plugins.get(pluginId);
    const runtime = this.runtime.get(pluginId);
    if (!plugin || !runtime) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    if (!runtime.enabled) {
      throw new PluginOperationError(400, `Plugin is disabled: ${pluginId}`);
    }
    if (!plugin.manifest.frontend || !plugin.getFrontendBundle) {
      throw new PluginOperationError(404, `Plugin frontend not found: ${pluginId}`);
    }
    return plugin.getFrontendBundle();
  }

  async runPluginUiAction(
    pluginId: string,
    extensionId: string,
    payload: { context?: unknown; input?: unknown } = {},
    options: { accessRole?: AccessRole } = {},
  ): Promise<PluginUiActionResult> {
    const extension = this.listUiExtensions().find(
      (candidate) => candidate.pluginId === pluginId && candidate.id === extensionId,
    );
    if (!extension) {
      throw new PluginOperationError(
        404,
        `Plugin UI extension not found: ${pluginId}/${extensionId}`,
      );
    }
    if (!extension.action) {
      throw new PluginOperationError(
        400,
        `Plugin UI extension has no action: ${pluginId}/${extensionId}`,
      );
    }
    if (!pluginUiActionAllowed(options.accessRole ?? 'operator', extension.action)) {
      throw new PluginOperationError(403, 'Operator access required');
    }
    const context: PluginUiContext = validatePluginUiContext(payload.context);
    if (!pluginUiContextMatches(extension, context)) {
      throw new PluginOperationError(400, `Plugin UI extension does not match the current context`);
    }
    if (extension.action.type === 'open_url') {
      return { type: 'open_url', url: extension.action.url };
    }
    const targetPluginId = extension.action.pluginId ?? pluginId;
    if (targetPluginId !== pluginId) {
      throw new PluginOperationError(400, 'Plugin UI actions cannot invoke another plugin');
    }
    const declaredInput = extension.action.input;
    const requestedInput = payload.input;
    const input =
      isRecord(declaredInput) && isRecord(requestedInput)
        ? { ...declaredInput, ...requestedInput }
        : (requestedInput ?? declaredInput);
    const commandInput = extension.action.passContext
      ? {
          input,
          context,
          ui: { extensionId: extension.id, slot: extension.slot },
        }
      : input;
    return {
      type: 'command',
      result: await this.runPluginCommand(pluginId, extension.action.commandId, commandInput),
    };
  }

  listPluginCommands(): PluginCommand[] {
    return this.activePlugins()
      .flatMap((plugin) => this.pluginCommands(plugin))
      .sort(
        (a, b) =>
          a.pluginId.localeCompare(b.pluginId) ||
          a.title.localeCompare(b.title) ||
          a.id.localeCompare(b.id),
      );
  }

  async runPluginCommand(
    pluginId: string,
    commandId: string,
    input?: unknown,
  ): Promise<PluginCommandResult> {
    const plugin = this.plugins.get(pluginId);
    const runtime = this.runtime.get(pluginId);
    if (!plugin || !runtime) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    if (!runtime.enabled) {
      throw new PluginOperationError(400, `Plugin is disabled: ${pluginId}`);
    }
    if (!plugin.runCommand) {
      throw new PluginOperationError(400, `Plugin does not implement commands: ${pluginId}`);
    }
    const command = this.pluginCommands(plugin).find((candidate) => candidate.id === commandId);
    if (!command) {
      throw new PluginOperationError(404, `Plugin command not found: ${pluginId}/${commandId}`);
    }
    try {
      const result = validatePluginCommandResult(await plugin.runCommand(commandId, input));
      this.publishPluginEvent(pluginId, 'command.completed', {
        commandId,
        ok: result.ok,
        message: result.message,
      });
      return result;
    } catch (error) {
      this.publishPluginEvent(pluginId, 'command.failed', {
        commandId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async runPluginMigration(
    pluginId: string,
    from: string,
    to: string,
    input?: unknown,
  ): Promise<PluginCommandResult> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    const migration = plugin.manifest.compatibility?.migrations?.find(
      (candidate) => candidate.from === from && candidate.to === to,
    );
    if (!migration) {
      throw new PluginOperationError(404, `Plugin migration not found: ${pluginId} ${from}->${to}`);
    }
    if (!migration.commandId) {
      throw new PluginOperationError(
        400,
        `Plugin migration does not declare a commandId: ${pluginId} ${from}->${to}`,
      );
    }
    return this.runPluginCommand(pluginId, migration.commandId, {
      migration: { from, to },
      input,
    });
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
          commands: this.pluginCommands(plugin).map((command) => command.id),
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
    return this.getGraphSources().map((source) => source.describe());
  }

  getGraphSources(): GraphSourceAdapter[] {
    return this.activePlugins().flatMap((plugin) => [...(plugin.getGraphSources?.() ?? [])]);
  }

  async getStats(ref: EntityRef) {
    return (await this.requireProvider('source.metrics', this.getStatsProviders(), ref)).getStats(
      ref,
    );
  }

  async listEntityActions(ref: EntityRef): Promise<EntityAction[]> {
    const actions = new Map<string, EntityAction>();
    for (const plugin of this.activePlugins()) {
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
    for (const plugin of this.activePlugins()) {
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
    const plugin = this.plugins.get(pluginId);
    const runtime = this.runtime.get(pluginId);
    if (!plugin || !runtime) {
      throw new PluginOperationError(404, `Plugin not found: ${pluginId}`);
    }
    if (!runtime.enabled) {
      throw new PluginOperationError(400, `Plugin is disabled: ${pluginId}`);
    }
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
    for (const plugin of this.activePlugins()) {
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
      this.activePlugins().flatMap((plugin) =>
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

  private getStatsProviders(): EntityStatsProvider[] {
    return this.activePlugins().flatMap((plugin) => [...(plugin.getStatsProviders?.() ?? [])]);
  }

  private getLogsProviders(): EntityLogsProvider[] {
    return this.activePlugins().flatMap((plugin) => [...(plugin.getLogsProviders?.() ?? [])]);
  }

  private getLogStreamProviders(): EntityLogStreamProvider[] {
    return this.activePlugins().flatMap((plugin) => [...(plugin.getLogStreamProviders?.() ?? [])]);
  }

  private getLifecycleProviders(): EntityLifecycleProvider[] {
    return this.activePlugins().flatMap((plugin) => [...(plugin.getLifecycleProviders?.() ?? [])]);
  }

  private getInspectProviders(): EntityInspectProvider[] {
    return this.activePlugins().flatMap((plugin) => [...(plugin.getInspectProviders?.() ?? [])]);
  }

  private getFilesystemProviders(): EntityFilesystemProvider[] {
    return this.activePlugins().flatMap((plugin) => [...(plugin.getFilesystemProviders?.() ?? [])]);
  }

  private getDiagnosticProviders(): EntityDiagnosticProvider[] {
    return this.activePlugins().flatMap((plugin) => [...(plugin.getDiagnosticProviders?.() ?? [])]);
  }

  private getExecProviders(): EntityExecProvider[] {
    return this.activePlugins().flatMap((plugin) => [...(plugin.getExecProviders?.() ?? [])]);
  }

  private getProjectProviderEntries(): Array<{
    pluginId: string;
    providerId: string;
    provider: ProjectProvider;
  }> {
    return this.activePlugins().flatMap((plugin) =>
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
    return this.activePlugins().flatMap((plugin) =>
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
    return this.activePlugins().flatMap((plugin) => [...(plugin.getResourceProviders?.() ?? [])]);
  }

  private pluginCommands(plugin: DockscopePlugin): PluginCommand[] {
    try {
      const commands = [
        ...(plugin.manifest.commands ?? []),
        ...validatePluginCommands(plugin.getCommands?.() ?? []),
      ];
      requireManifestCapabilities(plugin.manifest, ['ui.command'], 'declares commands');
      const unique = new Map<string, PluginCommandDeclaration>();
      for (const command of commands) {
        unique.set(command.id, command);
      }
      return [...unique.values()].map((command) =>
        hydratePluginCommand(plugin.manifest.id, command),
      );
    } catch {
      return [];
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
          commands: this.pluginCommands(plugin).map((command) => ({
            id: command.id,
            confirm: command.confirm === true,
          })),
          ui: (plugin.manifest.ui ?? []).map((extension) => ({
            id: extension.id,
            slot: extension.slot,
            action: extension.action,
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

  private activePlugins(): DockscopePlugin[] {
    return [...this.plugins.values()].filter(
      (plugin) => this.runtime.get(plugin.manifest.id)?.enabled ?? false,
    );
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
