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
  PluginLoadError,
  PluginManifest,
  PluginRuntimeInfo,
  PluginStatus,
  PluginConfigSnapshot,
  PluginReviewReport,
  PluginApprovalSnapshot,
  PluginReloadHandler,
  PluginReloadResult,
} from './core/plugins.js';
export {
  DOCKSCOPE_PLUGIN_API_VERSION,
  PluginManifestError,
  PluginOperationError,
  validatePluginManifest,
} from './core/plugins.js';
export type {
  EntityDiagnosticProvider,
  EntityExecProvider,
  EntityFilesystemProvider,
  EntityInspectProvider,
  EntityLifecycleProvider,
  EntityLogsProvider,
  EntityLogStreamProvider,
  EntityProvider,
  EntityRef,
  EntityStatsProvider,
  LogsOptions,
  ProjectAction,
  ProjectProvider,
  ProjectSummary,
  ResourceAction,
  ResourceActionOptions,
  ResourceProvider,
} from './core/operations.js';
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
  PluginUiExtension,
  PluginUiExtensionDeclaration,
  PluginUiSlot,
} from './core/plugin-ui.js';
export { PLUGIN_UI_SLOTS, PluginUiError } from './core/plugin-ui.js';
export type {
  PluginCommand,
  PluginCommandDeclaration,
  PluginCommandResult,
} from './core/plugin-commands.js';
export { PluginCommandError } from './core/plugin-commands.js';
export type { PluginEvent, PluginEventFilter } from './core/plugin-events.js';
export { PluginEventBus, PluginEventError } from './core/plugin-events.js';
export type {
  PluginCompatibility,
  PluginCompatibilityReport,
  PluginMigration,
} from './core/plugin-compatibility.js';
export { PluginCompatibilityError } from './core/plugin-compatibility.js';
export type {
  PluginSecretDeclaration,
  PluginSecretSnapshot,
  PluginSecretStatus,
} from './core/plugin-secrets.js';
export { PluginSecretError } from './core/plugin-secrets.js';
export type { PluginFactoryContext } from './plugins/loader.js';
export type { PluginHostApi, PluginHostExecResult } from './plugins/hostApi.js';
export type {
  PluginCatalog,
  PluginCatalogEntry,
  PluginCatalogEntrySignature,
  ResolvedPluginCatalog,
  ResolvedPluginCatalogEntry,
} from './plugins/catalog.js';
export { PLUGIN_CATALOG_FORMAT, PluginCatalogError } from './plugins/catalog.js';
export type { InstalledPlugin } from './plugins/install.js';
export type {
  PluginMarketplaceEntry,
  PluginMarketplaceEntryState,
  PluginMarketplaceSnapshot,
} from './plugins/marketplace.js';
export type {
  Anomaly,
  ContainerDiffEntry,
  ContainerInspect,
  ContainerStats,
  ContainerTopResult,
  CrashDiagnostic,
  DockerEvent,
  GraphData,
  ServiceLink,
  ServiceNode,
} from './types.js';
