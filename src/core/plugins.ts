import { createHash } from 'crypto';
import type { DataSourceDescriptor, GraphSourceAdapter } from './model.js';
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
  LifecycleAction,
  LogsOptions,
  ProjectAction,
  ProjectProvider,
  RemoveOptions,
  ResourceAction,
  ResourceActionOptions,
  ResourceProvider,
} from './operations.js';
import {
  isPluginCapability,
  isPluginPermission,
  type PluginCapability,
  type PluginPermission,
} from './capabilities.js';
import {
  defaultPluginConfig,
  validatePluginConfigSchema,
  validatePluginConfigValues,
  type PluginConfig,
  type PluginConfigSchema,
} from './plugin-config.js';
import {
  hydratePluginUiExtension,
  pluginUiSlotCapability,
  validatePluginUiExtensions,
  type PluginUiExtension,
  type PluginUiExtensionDeclaration,
} from './plugin-ui.js';
import {
  validatePluginSecrets,
  type PluginSecretDeclaration,
  type PluginSecretSnapshot,
} from './plugin-secrets.js';
import {
  hydratePluginCommand,
  validatePluginCommandResult,
  validatePluginCommands,
  type PluginCommand,
  type PluginCommandDeclaration,
  type PluginCommandResult,
} from './plugin-commands.js';
import { PluginEventBus, type PluginEvent, type PluginEventFilter } from './plugin-events.js';
import {
  createPluginCompatibilityReport,
  validatePluginCompatibility,
  type PluginCompatibility,
  type PluginCompatibilityReport,
} from './plugin-compatibility.js';

export const DOCKSCOPE_PLUGIN_API_VERSION = '1';
const SUPPORTED_PLUGIN_API_VERSIONS = new Set<string>([DOCKSCOPE_PLUGIN_API_VERSION]);

export type PluginStatus = 'registered' | 'started' | 'stopped' | 'failed' | 'disabled';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  dockscopeApiVersion: string;
  description?: string;
  entry?: string;
  builtin?: boolean;
  author?: string;
  homepage?: string;
  capabilities: readonly PluginCapability[];
  permissions: readonly PluginPermission[];
  config?: PluginConfigSchema;
  ui?: readonly PluginUiExtensionDeclaration[];
  secrets?: readonly PluginSecretDeclaration[];
  commands?: readonly PluginCommandDeclaration[];
  execution?: {
    isolation?: 'in-process' | 'process';
    commandTimeoutMs?: number;
    maxStderrBytes?: number;
  };
  compatibility?: PluginCompatibility;
}

export interface DockscopePlugin {
  manifest: PluginManifest;
  configure?(config: PluginConfig): Promise<void> | void;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  getCommands?(): readonly PluginCommandDeclaration[];
  runCommand?(
    commandId: string,
    input?: unknown,
  ): Promise<PluginCommandResult> | PluginCommandResult;
  getUiExtensions?(): readonly PluginUiExtensionDeclaration[];
  getGraphSources?(): readonly GraphSourceAdapter[];
  getStatsProviders?(): readonly EntityStatsProvider[];
  getLogsProviders?(): readonly EntityLogsProvider[];
  getLogStreamProviders?(): readonly EntityLogStreamProvider[];
  getLifecycleProviders?(): readonly EntityLifecycleProvider[];
  getInspectProviders?(): readonly EntityInspectProvider[];
  getFilesystemProviders?(): readonly EntityFilesystemProvider[];
  getDiagnosticProviders?(): readonly EntityDiagnosticProvider[];
  getExecProviders?(): readonly EntityExecProvider[];
  getProjectProviders?(): readonly ProjectProvider[];
  getResourceProviders?(): readonly ResourceProvider[];
}

export interface PluginRuntimeInfo {
  manifest: PluginManifest;
  status: PluginStatus;
  enabled: boolean;
  registeredAt: number;
  startedAt?: number;
  stoppedAt?: number;
  error?: string;
}

export interface PluginLoadError {
  id?: string;
  path?: string;
  phase: 'manifest' | 'permission' | 'config' | 'load' | 'register';
  message: string;
}

export interface PluginConfigSnapshot {
  pluginId: string;
  schema?: PluginConfigSchema;
  values: PluginConfig;
}

export interface PluginReviewReport {
  pluginId: string;
  name: string;
  version: string;
  enabled: boolean;
  status: PluginStatus;
  builtin: boolean;
  capabilities: readonly PluginCapability[];
  permissions: readonly PluginPermission[];
  secrets: readonly string[];
  commands: readonly string[];
  uiSlots: readonly string[];
  configFields: readonly string[];
  executionIsolation: 'in-process' | 'process';
  compatibilityWarnings: readonly string[];
  riskLevel: 'low' | 'medium' | 'high';
  riskReasons: readonly string[];
  approvalStatus: 'unapproved' | 'approved' | 'changed';
  fingerprint: string;
  approvedAt?: number;
  approvedFingerprint?: string;
}

export interface PluginApprovalSnapshot {
  pluginId: string;
  fingerprint: string;
  approvedAt: number;
}

export interface PluginConfigWriter {
  save(pluginId: string, config: PluginConfig): Promise<void>;
}

export interface PluginStateWriter {
  saveEnabled(pluginId: string, enabled: boolean): Promise<void>;
}

export interface PluginSecretWriter {
  has(pluginId: string, key: string): Promise<boolean>;
  set(pluginId: string, key: string, value: string): Promise<void>;
}

export interface PluginEventWriter {
  save(events: readonly PluginEvent[]): Promise<void>;
}

export interface PluginApprovalWriter {
  save(approvals: readonly PluginApprovalSnapshot[]): Promise<void>;
}

export interface PluginReloadResult {
  plugin: DockscopePlugin;
  config?: PluginConfig;
}

export type PluginReloadHandler = (pluginId: string) => Promise<PluginReloadResult>;

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;

export class PluginOperationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PluginOperationError';
  }
}

export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginManifestError';
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isNonEmptyString(value)) {
    throw new PluginManifestError(`Plugin manifest field "${field}" must be a non-empty string`);
  }
  return value;
}

export function validatePluginManifest(raw: unknown): PluginManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PluginManifestError('Plugin manifest must be an object');
  }
  const manifest = raw as Record<string, unknown>;
  if (!isNonEmptyString(manifest.id)) {
    throw new PluginManifestError('Plugin manifest field "id" is required');
  }
  if (!PLUGIN_ID_PATTERN.test(manifest.id)) {
    throw new PluginManifestError(`Invalid plugin id: ${manifest.id}`);
  }
  if (!isNonEmptyString(manifest.name)) {
    throw new PluginManifestError('Plugin manifest field "name" is required');
  }
  if (!isNonEmptyString(manifest.version)) {
    throw new PluginManifestError('Plugin manifest field "version" is required');
  }
  const dockscopeApiVersion = manifest.dockscopeApiVersion ?? DOCKSCOPE_PLUGIN_API_VERSION;
  if (!isNonEmptyString(dockscopeApiVersion)) {
    throw new PluginManifestError(
      'Plugin manifest field "dockscopeApiVersion" must be a non-empty string',
    );
  }
  if (!SUPPORTED_PLUGIN_API_VERSIONS.has(dockscopeApiVersion)) {
    throw new PluginManifestError(
      `Unsupported DockScope plugin API version: ${dockscopeApiVersion}`,
    );
  }
  if (!Array.isArray(manifest.capabilities)) {
    throw new PluginManifestError('Plugin manifest field "capabilities" must be an array');
  }
  if (!Array.isArray(manifest.permissions)) {
    throw new PluginManifestError('Plugin manifest field "permissions" must be an array');
  }
  const capabilities = manifest.capabilities.map((capability) => {
    if (!isPluginCapability(capability)) {
      throw new PluginManifestError(`Unsupported plugin capability: ${String(capability)}`);
    }
    return capability;
  });
  const permissions = manifest.permissions.map((permission) => {
    if (!isPluginPermission(permission)) {
      throw new PluginManifestError(`Unsupported plugin permission: ${String(permission)}`);
    }
    return permission;
  });
  const config =
    manifest.config === undefined ? undefined : validatePluginConfigSchema(manifest.config);
  if (config && !capabilities.includes('ui.settings')) {
    throw new PluginManifestError('Plugin config requires capability "ui.settings"');
  }
  const secrets = validatePluginSecrets(manifest.secrets);
  if (secrets.length > 0 && !permissions.includes('secrets.read')) {
    throw new PluginManifestError('Plugin secrets require permission "secrets.read"');
  }
  const commands = validatePluginCommands(manifest.commands);
  if (commands.length > 0 && !capabilities.includes('ui.command')) {
    throw new PluginManifestError('Plugin commands require capability "ui.command"');
  }
  const execution = manifest.execution;
  if (
    execution !== undefined &&
    (!execution || typeof execution !== 'object' || Array.isArray(execution))
  ) {
    throw new PluginManifestError('Plugin execution must be an object');
  }
  const isolation =
    execution && 'isolation' in execution
      ? (execution as { isolation?: unknown }).isolation
      : undefined;
  if (isolation !== undefined && isolation !== 'in-process' && isolation !== 'process') {
    throw new PluginManifestError(`Unsupported plugin execution isolation: ${String(isolation)}`);
  }
  const commandTimeoutMs =
    execution && 'commandTimeoutMs' in execution
      ? (execution as { commandTimeoutMs?: unknown }).commandTimeoutMs
      : undefined;
  if (
    commandTimeoutMs !== undefined &&
    (typeof commandTimeoutMs !== 'number' ||
      !Number.isFinite(commandTimeoutMs) ||
      commandTimeoutMs < 100 ||
      commandTimeoutMs > 300_000)
  ) {
    throw new PluginManifestError('Plugin execution commandTimeoutMs must be 100..300000');
  }
  const maxStderrBytes =
    execution && 'maxStderrBytes' in execution
      ? (execution as { maxStderrBytes?: unknown }).maxStderrBytes
      : undefined;
  if (
    maxStderrBytes !== undefined &&
    (typeof maxStderrBytes !== 'number' ||
      !Number.isFinite(maxStderrBytes) ||
      maxStderrBytes < 1024 ||
      maxStderrBytes > 1_000_000)
  ) {
    throw new PluginManifestError('Plugin execution maxStderrBytes must be 1024..1000000');
  }
  const ui = validatePluginUiExtensions(manifest.ui);
  for (const extension of ui) {
    const requiredCapability = pluginUiSlotCapability(extension.slot);
    if (!capabilities.includes(requiredCapability)) {
      throw new PluginManifestError(
        `Plugin UI extension "${extension.id}" requires capability "${requiredCapability}"`,
      );
    }
  }
  const compatibility = validatePluginCompatibility(manifest.compatibility);

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    dockscopeApiVersion,
    description: optionalString(manifest.description, 'description'),
    entry: optionalString(manifest.entry, 'entry'),
    builtin: manifest.builtin === true,
    author: optionalString(manifest.author, 'author'),
    homepage: optionalString(manifest.homepage, 'homepage'),
    capabilities,
    permissions,
    config,
    ui,
    secrets,
    commands,
    execution:
      isolation || commandTimeoutMs || maxStderrBytes
        ? { isolation, commandTimeoutMs, maxStderrBytes }
        : undefined,
    compatibility,
  };
}

function cloneManifest(manifest: PluginManifest): PluginManifest {
  return {
    ...manifest,
    capabilities: [...manifest.capabilities],
    permissions: [...manifest.permissions],
    secrets: manifest.secrets ? manifest.secrets.map((secret) => ({ ...secret })) : undefined,
    commands: manifest.commands ? manifest.commands.map((command) => ({ ...command })) : undefined,
    execution: manifest.execution ? { ...manifest.execution } : undefined,
    compatibility: manifest.compatibility
      ? {
          ...manifest.compatibility,
          deprecations: manifest.compatibility.deprecations
            ? [...manifest.compatibility.deprecations]
            : undefined,
          migrations: manifest.compatibility.migrations
            ? manifest.compatibility.migrations.map((migration) => ({ ...migration }))
            : undefined,
        }
      : undefined,
    config: manifest.config
      ? {
          fields: manifest.config.fields.map((field) => ({
            ...field,
            options: field.options ? [...field.options] : undefined,
          })),
        }
      : undefined,
    ui: manifest.ui ? manifest.ui.map((extension) => ({ ...extension })) : undefined,
  };
}

function cloneRuntimeInfo(info: PluginRuntimeInfo): PluginRuntimeInfo {
  return {
    ...info,
    manifest: cloneManifest(info.manifest),
  };
}

const PLUGIN_METHOD_CAPABILITIES: readonly [keyof DockscopePlugin, readonly PluginCapability[]][] =
  [
    ['getGraphSources', ['source.graph']],
    ['getStatsProviders', ['source.metrics']],
    ['getLogsProviders', ['source.logs']],
    ['getLogStreamProviders', ['source.logs']],
    ['getLifecycleProviders', ['action.lifecycle']],
    ['getInspectProviders', ['source.inspect']],
    ['getFilesystemProviders', ['action.filesystem']],
    ['getDiagnosticProviders', ['analysis.diagnostics']],
    ['getExecProviders', ['action.exec']],
    ['getProjectProviders', ['source.inventory', 'action.deploy']],
    ['getCommands', ['ui.command']],
    ['runCommand', ['ui.command']],
  ];

function requireManifestCapabilities(
  manifest: PluginManifest,
  capabilities: readonly PluginCapability[],
  context: string,
): void {
  const missing = capabilities.filter((capability) => !manifest.capabilities.includes(capability));
  if (missing.length > 0) {
    throw new PluginManifestError(
      `Plugin "${manifest.id}" ${context} without declaring ${missing.join(', ')}`,
    );
  }
}

function validatePluginContract(plugin: DockscopePlugin, manifest: PluginManifest): void {
  for (const [method, capabilities] of PLUGIN_METHOD_CAPABILITIES) {
    if (plugin[method]) {
      requireManifestCapabilities(manifest, capabilities, `implements ${method}`);
    }
  }
  if (
    plugin.getResourceProviders &&
    !manifest.capabilities.some((capability) =>
      ['source.logs', 'action.lifecycle', 'action.scale'].includes(capability),
    )
  ) {
    throw new PluginManifestError(
      `Plugin "${manifest.id}" implements getResourceProviders without declaring a resource capability`,
    );
  }
}

export class PluginRegistry {
  private readonly plugins = new Map<string, DockscopePlugin>();
  private readonly runtime = new Map<string, PluginRuntimeInfo>();
  private readonly configs = new Map<string, PluginConfig>();
  private readonly loadErrors: PluginLoadError[] = [];
  private readonly events: PluginEventBus;
  private readonly approvals = new Map<string, PluginApprovalSnapshot>();
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
    options: { enabled?: boolean } = {},
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
    this.runtime.set(id, {
      manifest,
      status: enabled ? 'registered' : 'disabled',
      enabled,
      registeredAt: Date.now(),
    });
  }

  recordLoadError(error: PluginLoadError): void {
    this.loadErrors.push(error);
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
    this.configs.delete(pluginId);
    return { ok: true };
  }

  listPlugins(): PluginRuntimeInfo[] {
    return [...this.runtime.values()].map(cloneRuntimeInfo);
  }

  listPluginErrors(): PluginLoadError[] {
    return this.loadErrors.map((error) => ({ ...error }));
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
      this.runtime.set(pluginId, {
        ...runtime,
        status: 'failed',
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
    this.runtime.set(pluginId, {
      ...runtime,
      enabled: true,
      status: runtime.status === 'disabled' ? 'registered' : runtime.status,
      error: undefined,
    });
    await this.stateWriter?.saveEnabled(pluginId, true);
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
    this.runtime.set(pluginId, {
      ...stopped,
      enabled: false,
      status: 'disabled',
      error: undefined,
    });
    await this.stateWriter?.saveEnabled(pluginId, false);
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
    this.plugins.set(pluginId, { ...reloaded.plugin, manifest });
    this.configs.set(pluginId, config);
    this.runtime.set(pluginId, {
      manifest,
      enabled: oldRuntime.enabled,
      status: oldRuntime.enabled ? 'registered' : 'disabled',
      registeredAt: oldRuntime.registeredAt,
      stoppedAt: Date.now(),
    });
    if (oldRuntime.enabled) {
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
    return this.requireProvider('source.metrics', this.getStatsProviders(), ref).getStats(ref);
  }

  async getLogs(ref: EntityRef, options?: LogsOptions) {
    return this.requireProvider('source.logs', this.getLogsProviders(), ref).getLogs(ref, options);
  }

  streamLogs(ref: EntityRef, onData: (text: string) => void, onError?: (error: Error) => void) {
    return this.requireProvider('source.logs', this.getLogStreamProviders(), ref).streamLogs(
      ref,
      onData,
      onError,
    );
  }

  async runLifecycleAction(ref: EntityRef, action: LifecycleAction) {
    return this.requireProvider(
      'action.lifecycle',
      this.getLifecycleProviders(),
      ref,
    ).runLifecycleAction(ref, action);
  }

  async removeEntity(ref: EntityRef, options?: RemoveOptions) {
    return this.requireProvider('action.lifecycle', this.getLifecycleProviders(), ref).removeEntity(
      ref,
      options,
    );
  }

  async inspect(ref: EntityRef) {
    return this.requireProvider('source.inspect', this.getInspectProviders(), ref).inspect(ref);
  }

  async getTop(ref: EntityRef) {
    return this.requireProvider('action.filesystem', this.getFilesystemProviders(), ref).getTop(
      ref,
    );
  }

  async getDiff(ref: EntityRef) {
    return this.requireProvider('action.filesystem', this.getFilesystemProviders(), ref).getDiff(
      ref,
    );
  }

  async diagnose(ref: EntityRef) {
    return this.requireProvider(
      'analysis.diagnostics',
      this.getDiagnosticProviders(),
      ref,
    ).diagnose(ref);
  }

  async createExecSession(ref: EntityRef, command?: string[]) {
    return this.requireProvider('action.exec', this.getExecProviders(), ref).createExecSession(
      ref,
      command,
    );
  }

  async listProjects() {
    const projects = await Promise.all(
      this.getProjectProviders().map((provider) => provider.listProjects()),
    );
    return projects.flat().sort((a, b) => a.name.localeCompare(b.name));
  }

  async runProjectAction(project: string, action: ProjectAction) {
    const provider = this.getProjectProviders()[0];
    if (!provider) {
      throw new PluginOperationError(404, 'No plugin provider found for action.deploy');
    }
    return provider.runProjectAction(project, action);
  }

  async getResourceLogs(resourceId: string, options?: LogsOptions) {
    return this.requireResourceProvider('source.logs', resourceId).getResourceLogs(
      resourceId,
      options,
    );
  }

  async runResourceAction(
    resourceId: string,
    action: ResourceAction,
    options?: ResourceActionOptions,
  ) {
    return this.requireResourceProvider('action.lifecycle', resourceId).runResourceAction(
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
      this.runtime.set(id, {
        ...runtime,
        status: 'failed',
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

  private getProjectProviders(): ProjectProvider[] {
    return this.activePlugins().flatMap((plugin) => [...(plugin.getProjectProviders?.() ?? [])]);
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
          dockscopeApiVersion: plugin.manifest.dockscopeApiVersion,
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
          })),
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

  private requireProvider<T extends { canHandle(ref: EntityRef): boolean }>(
    capability: PluginCapability,
    providers: readonly T[],
    ref: EntityRef,
  ): T {
    const provider = providers.find((candidate) => candidate.canHandle(ref));
    if (!provider) {
      throw new PluginOperationError(
        404,
        `No plugin provider found for ${capability} on ${ref.sourceId || 'default source'}`,
      );
    }
    return provider;
  }

  private requireResourceProvider(
    capability: PluginCapability,
    resourceId: string,
  ): ResourceProvider {
    const provider = this.getResourceProviders().find((candidate) =>
      candidate.canHandle(resourceId),
    );
    if (!provider) {
      throw new PluginOperationError(
        404,
        `No plugin provider found for ${capability} on ${resourceId}`,
      );
    }
    return provider;
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
      this.runtime.set(id, {
        ...runtime,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
