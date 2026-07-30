// Plugin manifest contract: the shape of plugin.json, the runtime info and
// writer interfaces built from it, and the validation that turns untrusted JSON
// into a PluginManifest. Kept apart from the registry so the declarative
// contract can be read without the ~1350-line lifecycle machinery around it.
import type { GraphSourceAdapter } from '../sources/model.js';
import type {
  EntityActionProvider,
  EntityDiagnosticProvider,
  EntityExecProvider,
  EntityFilesystemProvider,
  EntityInspectProvider,
  EntityLogStreamProvider,
  EntityLifecycleProvider,
  EntityLogsProvider,
  EntityStatsProvider,
  ProjectProvider,
  ResourceProvider,
} from '../entities/operations.js';
import { type MetricAnalysisProvider } from './analysis.js';
import { type PluginSystemProvider } from './system.js';
import { type PluginConnectionProvider } from './connections.js';
import type { PluginProcessHealthSnapshot } from './runtime.js';
import {
  isPluginCapability,
  isPluginPermission,
  type PluginCapability,
  type PluginPermission,
} from './capabilities.js';
import {
  validatePluginConfigSchema,
  type PluginConfig,
  type PluginConfigSchema,
} from './config.js';
import {
  pluginUiSlotCapability,
  validatePluginFrontendBundle,
  validatePluginUiExtensions,
  type PluginFrontendBundleDeclaration,
  type PluginUiExtensionDeclaration,
} from './ui.js';
import { validatePluginSecrets, type PluginSecretDeclaration } from './secrets.js';
import {
  validatePluginCommands,
  type PluginCommandDeclaration,
  type PluginCommandResult,
} from './commands.js';
import { type PluginEvent } from './events.js';
import { validatePluginCompatibility, type PluginCompatibility } from './compatibility.js';
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

export function isRecord(value: unknown): value is Record<string, unknown> {
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

export function cloneRuntimeInfo(info: PluginRuntimeInfo): PluginRuntimeInfo {
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

export function requireManifestCapabilities(
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

export function validatePluginContract(plugin: DockscopePlugin, manifest: PluginManifest): void {
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
