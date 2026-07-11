export type {
  DataSourceDescriptor,
  DataSourceKind,
  DataSourceStatus,
  GraphSourceAdapter,
  SourceEvent,
  SourceGraphSnapshot,
} from './core/model.js';
export type {
  DockscopePlugin,
  PluginManifest,
  PluginManifestValidationResult,
  PluginManifestWarning,
  PluginManifestWarningCode,
} from './core/plugins.js';
export {
  DOCKSCOPE_PLUGIN_API_VERSION,
  DOCKSCOPE_PLUGIN_HOST_API_VERSION,
  DOCKSCOPE_PLUGIN_MANIFEST_VERSION,
  PluginManifestError,
  pluginManifestDeprecationWarnings,
  validatePluginManifest,
  validatePluginManifestWithWarnings,
} from './core/plugins.js';
export type {
  EntityDiagnosticProvider,
  EntityActionProvider,
  EntityContext,
  EntityOperationDescriptor,
  EntityOperationId,
  EntityExecProvider,
  EntityExecSession,
  EntityFilesystemProvider,
  EntityInspectProvider,
  EntityLifecycleProvider,
  EntityLogsProvider,
  EntityLogStreamProvider,
  EntityProvider,
  EntityRef,
  EntityStatsProvider,
  LifecycleAction,
  LogsOptions,
  ProjectAction,
  ProjectProvider,
  ProjectSummary,
  RemoveOptions,
  ResourceAction,
  ResourceActionOptions,
  ResourceProvider,
} from './core/operations.js';
export type {
  EntityAction,
  EntityActionConfirmation,
  EntityActionDeclaration,
  EntityActionEffect,
  EntityActionInput,
  EntityActionPlacement,
  EntityActionResult,
  EntityActionTone,
} from './core/entity-actions.js';
export {
  EntityActionError,
  hydrateEntityAction,
  validateEntityActionResult,
  validateEntityActions,
} from './core/entity-actions.js';
export type {
  MetricAnalysisFinding,
  MetricAnalysisId,
  MetricAnalysisProvider,
  MetricAnalysisResult,
  MetricAnalysisSample,
} from './core/plugin-analysis.js';
export type {
  PluginSystemDeclaration,
  PluginSystemProvider,
  PluginSystemSnapshot,
  PluginSystemStatus,
} from './core/plugin-system.js';
export { PluginSystemError, validatePluginSystems } from './core/plugin-system.js';
export type {
  PluginConnection,
  PluginConnectionDeclaration,
  PluginConnectionProvider,
  PluginConnectionProviderDeclaration,
  PluginConnectionProviderDescriptor,
  PluginConnectionStatus,
} from './core/plugin-connections.js';
export type {
  PluginProcessHealthSnapshot,
  PluginProcessMetrics,
  PluginProcessState,
  PluginRuntimeCrash,
  PluginRuntimeHealth,
} from './core/plugin-runtime.js';
export {
  PluginConnectionError,
  validatePluginConnectionProvider,
  validatePluginConnections,
} from './core/plugin-connections.js';
export { MetricAnalysisError, validateMetricAnalysisResult } from './core/plugin-analysis.js';
export type { PluginCapability, PluginPermission } from './core/capabilities.js';
export {
  PLUGIN_CAPABILITIES,
  PLUGIN_PERMISSIONS,
  isPluginCapability,
  isPluginPermission,
} from './core/capabilities.js';
export type {
  PluginConfig,
  PluginConfigField,
  PluginConfigFieldType,
  PluginConfigOption,
  PluginConfigSchema,
  PluginConfigValue,
} from './core/plugin-config.js';
export { PluginConfigError } from './core/plugin-config.js';
export type {
  PluginUiAction,
  PluginUiContent,
  PluginUiContext,
  PluginUiContextFilter,
  PluginUiExtension,
  PluginUiExtensionDeclaration,
  PluginUiKeyValueContent,
  PluginUiMetricItem,
  PluginUiMetricsContent,
  PluginUiNodeContext,
  PluginUiSlot,
  PluginUiTone,
  PluginFrontendBundleDeclaration,
  PluginFrontendApi,
  PluginFrontendMount,
  PluginFrontendRoot,
} from './core/plugin-ui.js';
export {
  PLUGIN_UI_SLOTS,
  PluginUiError,
  pluginUiContextMatches,
  validatePluginUiContext,
} from './core/plugin-ui.js';
export type {
  PluginCommand,
  PluginCommandDeclaration,
  PluginCommandResult,
} from './core/plugin-commands.js';
export { PluginCommandError } from './core/plugin-commands.js';
export type { PluginEvent, PluginEventFilter } from './core/plugin-events.js';
export type {
  PluginCompatibility,
  PluginCompatibilityReport,
  PluginMigration,
} from './core/plugin-compatibility.js';
export {
  compareVersions,
  PluginCompatibilityError,
  pluginCompatibilityWarnings,
} from './core/plugin-compatibility.js';
export type {
  PluginSecretDeclaration,
  PluginSecretSnapshot,
  PluginSecretStatus,
} from './core/plugin-secrets.js';
export { PluginSecretError } from './core/plugin-secrets.js';
export type {
  PluginApiDescriptor,
  PluginFactory,
  PluginFactoryContext,
  PluginHostApi,
  PluginHostExecResult,
  PluginLogger,
} from './core/plugin-api.js';
export type {
  Anomaly,
  ContainerDiffEntry,
  ContainerInspect,
  ContainerStats,
  ContainerTopResult,
  CrashDiagnostic,
  DockerEvent,
  RuntimeEvent,
  GraphData,
  ServiceLink,
  ServiceNode,
} from './types.js';

import type { DockscopePlugin, PluginManifest } from './core/plugins.js';
import {
  DOCKSCOPE_PLUGIN_API_VERSION,
  DOCKSCOPE_PLUGIN_HOST_API_VERSION,
  DOCKSCOPE_PLUGIN_MANIFEST_VERSION,
} from './core/plugins.js';
import type { PluginApiDescriptor, PluginFactory } from './core/plugin-api.js';
import { PLUGIN_CAPABILITIES, PLUGIN_PERMISSIONS } from './core/capabilities.js';

export const PLUGIN_API_V1: PluginApiDescriptor = Object.freeze({
  pluginApiVersion: DOCKSCOPE_PLUGIN_API_VERSION,
  hostApiVersion: DOCKSCOPE_PLUGIN_HOST_API_VERSION,
  manifestVersion: DOCKSCOPE_PLUGIN_MANIFEST_VERSION,
  capabilities: PLUGIN_CAPABILITIES,
  permissions: PLUGIN_PERMISSIONS,
});

export function definePluginManifest<const T extends PluginManifest>(manifest: T): T {
  return manifest;
}

export function definePlugin<const T extends DockscopePlugin>(plugin: T): T {
  return plugin;
}

export function definePluginFactory<const T extends PluginFactory>(factory: T): T {
  return factory;
}
