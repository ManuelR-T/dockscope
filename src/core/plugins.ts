import { createHash } from 'crypto';
import type { DataSourceDescriptor, GraphSourceAdapter } from './model.js';
import type {
  EntityActionProvider,
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
} from './operations.js';
import {
  hydrateEntityAction,
  validateEntityActionResult,
  validateEntityActions,
  type EntityAction,
  type EntityActionResult,
} from './entity-actions.js';
import {
  validateMetricAnalysisResult,
  type MetricAnalysisFinding,
  type MetricAnalysisProvider,
  type MetricAnalysisSample,
} from './plugin-analysis.js';
import {
  validatePluginSystems,
  type PluginSystemProvider,
  type PluginSystemSnapshot,
} from './plugin-system.js';
import {
  validatePluginConnectionProvider,
  validatePluginConnections,
  type PluginConnection,
  type PluginConnectionProvider,
  type PluginConnectionProviderDescriptor,
} from './plugin-connections.js';
import type {
  PluginProcessHealthSnapshot,
  PluginRuntimeCrash,
  PluginRuntimeHealth,
} from './plugin-runtime.js';
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
  pluginUiContextMatches,
  pluginUiSlotCapability,
  validatePluginFrontendBundle,
  validatePluginUiContext,
  validatePluginUiExtensions,
  type PluginFrontendBundleDeclaration,
  type PluginUiActionResult,
  type PluginUiContext,
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
export const DOCKSCOPE_PLUGIN_HOST_API_VERSION = '1';
export const DOCKSCOPE_PLUGIN_MANIFEST_VERSION = '1';
const SUPPORTED_PLUGIN_API_VERSIONS = new Set<string>([DOCKSCOPE_PLUGIN_API_VERSION]);
const SUPPORTED_PLUGIN_HOST_API_VERSIONS = new Set<string>([DOCKSCOPE_PLUGIN_HOST_API_VERSION]);
const SUPPORTED_PLUGIN_MANIFEST_VERSIONS = new Set<string>([DOCKSCOPE_PLUGIN_MANIFEST_VERSION]);

export type PluginStatus =
  | 'registered'
  | 'started'
  | 'stopped'
  | 'failed'
  | 'disabled'
  | 'quarantined';

export const PLUGIN_CRASH_QUARANTINE_THRESHOLD = 3;
export const PLUGIN_CRASH_QUARANTINE_WINDOW_MS = 60_000;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  manifestVersion: string;
  dockscopeApiVersion: string;
  hostApiVersion: string;
  description?: string;
  entry?: string;
  builtin?: boolean;
  author?: string;
  homepage?: string;
  capabilities: readonly PluginCapability[];
  permissions: readonly PluginPermission[];
  config?: PluginConfigSchema;
  ui?: readonly PluginUiExtensionDeclaration[];
  frontend?: PluginFrontendBundleDeclaration;
  secrets?: readonly PluginSecretDeclaration[];
  commands?: readonly PluginCommandDeclaration[];
  execution?: {
    isolation?: 'in-process' | 'process';
    operationTimeoutMs?: number;
    /** @deprecated Use operationTimeoutMs. */
    commandTimeoutMs?: number;
    maxStderrBytes?: number;
    memoryLimitMb?: number;
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
  getFrontendBundle?(): Promise<string>;
  getGraphSources?(): readonly GraphSourceAdapter[];
  getActionProviders?(): readonly EntityActionProvider[];
  getMetricAnalysisProviders?(): readonly MetricAnalysisProvider[];
  getSystemProviders?(): readonly PluginSystemProvider[];
  getConnectionProviders?(): readonly PluginConnectionProvider[];
  getRuntimeHealth?(): Promise<PluginProcessHealthSnapshot>;
  getStatsProviders?(): readonly EntityStatsProvider[];
  getLogsProviders?(): readonly EntityLogsProvider[];
  getLogStreamProviders?(): readonly EntityLogStreamProvider[];
  getLifecycleProviders?(): readonly EntityLifecycleProvider[];
  getInspectProviders?(): readonly EntityInspectProvider[];
  getFilesystemProviders?(): readonly EntityFilesystemProvider[];
  getDiagnosticProviders?(): readonly EntityDiagnosticProvider[];
  getExecProviders?(): readonly EntityExecProvider[];
  getProjectProviders?(): readonly ProjectProvider[];
  /** @deprecated Implement entity log and action providers instead. */
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
  crashCount: number;
  lastCrashAt?: number;
  lastCrashError?: string;
  quarantinedAt?: number;
  quarantineReason?: string;
}

export interface PluginLoadError {
  id?: string;
  path?: string;
  phase: 'manifest' | 'permission' | 'config' | 'load' | 'register';
  message: string;
}

export type PluginManifestWarningCode =
  | 'manifest-version-defaulted'
  | 'plugin-api-version-defaulted'
  | 'host-api-version-defaulted'
  | 'command-timeout-deprecated'
  | 'in-process-deprecated';

export interface PluginManifestWarning {
  code: PluginManifestWarningCode;
  message: string;
}

export interface PluginManifestValidationResult {
  manifest: PluginManifest;
  warnings: PluginManifestWarning[];
}

export interface PluginLoadWarning extends PluginManifestWarning {
  id?: string;
  path?: string;
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
  frontendSlots: readonly string[];
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
  saveRuntimeState?(
    pluginId: string,
    state: {
      enabled: boolean;
      quarantined?: boolean;
      quarantineReason?: string;
      crashCount?: number;
      lastCrashAt?: number;
      lastCrashError?: string;
      quarantinedAt?: number;
      recentCrashTimes?: readonly number[];
    },
  ): Promise<void>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function pluginManifestDeprecationWarnings(raw: unknown): PluginManifestWarning[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }
  const manifest = raw as Record<string, unknown>;
  const warnings: PluginManifestWarning[] = [];
  if (manifest.manifestVersion === undefined) {
    warnings.push({
      code: 'manifest-version-defaulted',
      message: `manifestVersion is omitted; DockScope is assuming ${DOCKSCOPE_PLUGIN_MANIFEST_VERSION}`,
    });
  }
  if (manifest.dockscopeApiVersion === undefined) {
    warnings.push({
      code: 'plugin-api-version-defaulted',
      message: `dockscopeApiVersion is omitted; DockScope is assuming ${DOCKSCOPE_PLUGIN_API_VERSION}`,
    });
  }
  if (manifest.hostApiVersion === undefined) {
    warnings.push({
      code: 'host-api-version-defaulted',
      message: `hostApiVersion is omitted; DockScope is assuming ${DOCKSCOPE_PLUGIN_HOST_API_VERSION}`,
    });
  }
  if (manifest.execution && typeof manifest.execution === 'object') {
    const execution = manifest.execution as Record<string, unknown>;
    if (execution.commandTimeoutMs !== undefined) {
      warnings.push({
        code: 'command-timeout-deprecated',
        message: 'execution.commandTimeoutMs is deprecated; use execution.operationTimeoutMs',
      });
    }
    if (execution.isolation === 'in-process') {
      warnings.push({
        code: 'in-process-deprecated',
        message: 'in-process execution is intended only for trusted local development plugins',
      });
    }
  }
  return warnings;
}

export function validatePluginManifestWithWarnings(raw: unknown): PluginManifestValidationResult {
  return {
    manifest: validatePluginManifest(raw),
    warnings: pluginManifestDeprecationWarnings(raw),
  };
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
  const manifestVersion = manifest.manifestVersion ?? DOCKSCOPE_PLUGIN_MANIFEST_VERSION;
  if (!isNonEmptyString(manifestVersion)) {
    throw new PluginManifestError(
      'Plugin manifest field "manifestVersion" must be a non-empty string',
    );
  }
  if (!SUPPORTED_PLUGIN_MANIFEST_VERSIONS.has(manifestVersion)) {
    throw new PluginManifestError(`Unsupported plugin manifest version: ${manifestVersion}`);
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
  const hostApiVersion = manifest.hostApiVersion ?? DOCKSCOPE_PLUGIN_HOST_API_VERSION;
  if (!isNonEmptyString(hostApiVersion)) {
    throw new PluginManifestError(
      'Plugin manifest field "hostApiVersion" must be a non-empty string',
    );
  }
  if (!SUPPORTED_PLUGIN_HOST_API_VERSIONS.has(hostApiVersion)) {
    throw new PluginManifestError(`Unsupported DockScope host API version: ${hostApiVersion}`);
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
  const legacyCommandTimeoutMs =
    execution && 'commandTimeoutMs' in execution
      ? (execution as { commandTimeoutMs?: unknown }).commandTimeoutMs
      : undefined;
  const operationTimeoutMs =
    execution && 'operationTimeoutMs' in execution
      ? (execution as { operationTimeoutMs?: unknown }).operationTimeoutMs
      : legacyCommandTimeoutMs;
  if (
    operationTimeoutMs !== undefined &&
    (typeof operationTimeoutMs !== 'number' ||
      !Number.isFinite(operationTimeoutMs) ||
      operationTimeoutMs < 100 ||
      operationTimeoutMs > 300_000)
  ) {
    throw new PluginManifestError('Plugin execution operationTimeoutMs must be 100..300000');
  }
  if (
    legacyCommandTimeoutMs !== undefined &&
    (typeof legacyCommandTimeoutMs !== 'number' ||
      !Number.isFinite(legacyCommandTimeoutMs) ||
      legacyCommandTimeoutMs < 100 ||
      legacyCommandTimeoutMs > 300_000)
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
  const memoryLimitMb =
    execution && 'memoryLimitMb' in execution
      ? (execution as { memoryLimitMb?: unknown }).memoryLimitMb
      : undefined;
  if (
    memoryLimitMb !== undefined &&
    (typeof memoryLimitMb !== 'number' ||
      !Number.isFinite(memoryLimitMb) ||
      memoryLimitMb < 32 ||
      memoryLimitMb > 2048)
  ) {
    throw new PluginManifestError('Plugin execution memoryLimitMb must be 32..2048');
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
  const frontend = validatePluginFrontendBundle(manifest.frontend);
  if (frontend && !capabilities.includes('ui.frontend')) {
    throw new PluginManifestError('Plugin frontend requires capability "ui.frontend"');
  }
  for (const slot of frontend?.slots ?? []) {
    const requiredCapability = pluginUiSlotCapability(slot);
    if (!capabilities.includes(requiredCapability)) {
      throw new PluginManifestError(
        `Plugin frontend slot "${slot}" requires capability "${requiredCapability}"`,
      );
    }
  }
  for (const extension of ui.filter((item) => item.frontendView)) {
    if (!frontend) {
      throw new PluginManifestError(
        `Plugin UI extension "${extension.id}" declares frontendView without a frontend bundle`,
      );
    }
    if (!frontend.slots.includes(extension.slot)) {
      throw new PluginManifestError(
        `Plugin UI extension "${extension.id}" uses frontend slot "${extension.slot}" outside the frontend declaration`,
      );
    }
  }
  const compatibility = validatePluginCompatibility(manifest.compatibility);

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    manifestVersion,
    dockscopeApiVersion,
    hostApiVersion,
    description: optionalString(manifest.description, 'description'),
    entry: optionalString(manifest.entry, 'entry'),
    builtin: manifest.builtin === true,
    author: optionalString(manifest.author, 'author'),
    homepage: optionalString(manifest.homepage, 'homepage'),
    capabilities,
    permissions,
    config,
    ui,
    frontend,
    secrets,
    commands,
    execution:
      isolation || operationTimeoutMs || maxStderrBytes || memoryLimitMb
        ? { isolation, operationTimeoutMs, maxStderrBytes, memoryLimitMb }
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
    ui: manifest.ui ? manifest.ui.map((extension) => structuredClone(extension)) : undefined,
    frontend: manifest.frontend
      ? { entry: manifest.frontend.entry, slots: [...manifest.frontend.slots] }
      : undefined,
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
    ['getSystemProviders', ['source.system']],
    ['getConnectionProviders', ['source.connections']],
    ['getStatsProviders', ['source.metrics']],
    ['getLogsProviders', ['source.logs']],
    ['getLogStreamProviders', ['source.logs']],
    ['getLifecycleProviders', ['action.lifecycle']],
    ['getInspectProviders', ['source.inspect']],
    ['getFilesystemProviders', ['action.filesystem']],
    ['getDiagnosticProviders', ['analysis.diagnostics']],
    ['getMetricAnalysisProviders', ['analysis.anomalies']],
    ['getExecProviders', ['action.exec']],
    ['getProjectProviders', ['source.inventory', 'action.deploy']],
    ['getCommands', ['ui.command']],
    ['runCommand', ['ui.command']],
    ['getFrontendBundle', ['ui.frontend']],
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
    plugin.getActionProviders &&
    !manifest.capabilities.some((capability) => capability.startsWith('action.'))
  ) {
    throw new PluginManifestError(
      `Plugin "${manifest.id}" implements getActionProviders without declaring an action capability`,
    );
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
