import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { errorMessage } from '../utils.js';
import type { GraphSourceAdapter, SourceEvent, SourceGraphSnapshot } from '../core/model.js';
import type {
  EntityDiagnosticProvider,
  EntityExecProvider,
  EntityFilesystemProvider,
  EntityInspectProvider,
  EntityLifecycleProvider,
  EntityLogsProvider,
  EntityLogStreamProvider,
  EntityStatsProvider,
  ProjectProvider,
  ProjectSummary,
  ResourceProvider,
} from '../core/operations.js';
import { defaultPluginConfig, type PluginConfig } from '../core/plugin-config.js';
import {
  type DockscopePlugin,
  type PluginLoadError,
  type PluginManifest,
  validatePluginManifest,
} from '../core/plugins.js';
import { isPluginPermission, type PluginPermission } from '../core/capabilities.js';
import { createPluginHostApi, type PluginHostApi } from './hostApi.js';
import type { PluginSecretStore } from './secretStore.js';
import type { PluginEvent } from '../core/plugin-events.js';
import { PluginProcessSandbox } from './processSandbox.js';
import type { SandboxEntityProviderKind, SandboxPluginDescriptor } from './processProtocol.js';
import type {
  ContainerDiffEntry,
  ContainerInspect,
  ContainerStats,
  ContainerTopResult,
  CrashDiagnostic,
} from '../types.js';
import type { PluginCommandResult } from '../core/plugin-commands.js';

const PLUGIN_MANIFEST_FILE = 'plugin.json';

export interface PluginFactoryContext {
  manifest: PluginManifest;
  pluginDir: string;
  config: PluginConfig;
  host: PluginHostApi;
  logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
}

type PluginFactory = (context: PluginFactoryContext) => DockscopePlugin | Promise<DockscopePlugin>;

type ExternalPluginModule = Record<string, unknown>;

export type ExternalPluginPermissionPolicy = 'all' | readonly PluginPermission[];

export interface ExternalPluginLoadOptions {
  paths: readonly string[];
  permissions?: ExternalPluginPermissionPolicy;
  getConfig?: (manifest: PluginManifest) => PluginConfig | Promise<PluginConfig>;
  secretStore?: PluginSecretStore;
  publishEvent?: (
    pluginId: string,
    type: string,
    payload: unknown,
  ) => PluginEvent | Promise<PluginEvent>;
  cacheBust?: boolean;
  processCommandTimeoutMs?: number;
  processMaxStderrBytes?: number;
  processMemoryLimitMb?: number;
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
}

export interface ExternalPluginLoadResult {
  plugins: DockscopePlugin[];
  configs: Map<string, PluginConfig>;
  errors: PluginLoadError[];
}

export interface ExternalPluginManifestValidationResult {
  manifests: PluginManifest[];
  errors: PluginLoadError[];
}

function allowedPermissionSet(
  permissions: ExternalPluginPermissionPolicy | undefined,
): Set<PluginPermission> | 'all' {
  if (permissions === 'all') {
    return 'all';
  }
  return new Set(permissions ?? []);
}

function deniedPermissions(
  manifest: PluginManifest,
  policy: Set<PluginPermission> | 'all',
): PluginPermission[] {
  if (policy === 'all') {
    return [];
  }
  return manifest.permissions.filter((permission) => !policy.has(permission));
}

export function parsePluginPermissionList(
  value: string | undefined,
): ExternalPluginPermissionPolicy {
  if (!value?.trim()) {
    return [];
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '*' || normalized === 'all') {
    return 'all';
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is PluginPermission => isPluginPermission(item));
}

export function parsePluginPaths(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function discoverManifestPaths(inputPaths: readonly string[]): Promise<string[]> {
  const manifestPaths: string[] = [];
  for (const inputPath of inputPaths) {
    const root = path.resolve(inputPath);
    const directManifest = path.join(root, PLUGIN_MANIFEST_FILE);
    if (await pathExists(directManifest)) {
      manifestPaths.push(directManifest);
      continue;
    }

    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const manifestPath = path.join(root, entry, PLUGIN_MANIFEST_FILE);
      if (await pathExists(manifestPath)) {
        manifestPaths.push(manifestPath);
      }
    }
  }
  return [...new Set(manifestPaths)].sort();
}

function resolvePluginEntry(manifestPath: string, manifest: PluginManifest): string {
  if (!manifest.entry) {
    throw new Error('External plugin manifest requires an "entry" field');
  }
  const pluginDir = path.dirname(manifestPath);
  const entryPath = path.resolve(pluginDir, manifest.entry);
  const relative = path.relative(pluginDir, entryPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('External plugin entry must stay inside the plugin directory');
  }
  return entryPath;
}

function pluginFactoryFromModule(module: ExternalPluginModule): PluginFactory | DockscopePlugin {
  const candidate = module.default ?? module.createPlugin ?? module.plugin;
  if (!candidate) {
    throw new Error('Plugin module must export default, createPlugin, or plugin');
  }
  return candidate as PluginFactory | DockscopePlugin;
}

function isPluginFactory(value: PluginFactory | DockscopePlugin): value is PluginFactory {
  return typeof value === 'function';
}

async function instantiatePlugin(
  module: ExternalPluginModule,
  manifest: PluginManifest,
  pluginDir: string,
  config: PluginConfig,
  host: PluginHostApi,
  logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>,
): Promise<DockscopePlugin> {
  const candidate = pluginFactoryFromModule(module);
  const plugin = isPluginFactory(candidate)
    ? await candidate({ manifest, pluginDir, config, host, logger })
    : candidate;
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('Plugin module did not return a plugin object');
  }
  const validatedManifest = validatePluginManifest(plugin.manifest);
  if (validatedManifest.id !== manifest.id) {
    throw new Error(
      `Plugin module manifest id "${validatedManifest.id}" does not match plugin.json id "${manifest.id}"`,
    );
  }
  return { ...plugin, manifest: validatedManifest };
}

async function createProcessIsolatedPlugin(options: {
  manifest: PluginManifest;
  pluginDir: string;
  entryPath: string;
  config: PluginConfig;
  secretStore?: PluginSecretStore;
  publishEvent?: ExternalPluginLoadOptions['publishEvent'];
  timeoutMs?: number;
  maxStderrBytes?: number;
  memoryLimitMb?: number;
  logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
}): Promise<DockscopePlugin> {
  const sandbox = new PluginProcessSandbox({
    ...options,
    onCrash: (error, restartCount) => {
      options.logger.error(
        `Plugin process crashed (${options.manifest.id}, restart ${restartCount}): ${error.message}`,
      );
      void options.publishEvent?.(options.manifest.id, 'runtime.crashed', {
        message: error.message,
        restartCount,
      });
    },
  });
  let descriptor: SandboxPluginDescriptor;
  try {
    descriptor = await sandbox.initialize();
  } catch (error) {
    sandbox.dispose();
    throw error;
  }
  if (descriptor.manifest.id !== options.manifest.id) {
    sandbox.dispose();
    throw new Error(
      `Plugin process manifest id "${descriptor.manifest.id}" does not match "${options.manifest.id}"`,
    );
  }
  const manifest = validatePluginManifest({
    ...descriptor.manifest,
    execution: {
      ...descriptor.manifest.execution,
      isolation: 'process',
    },
  });
  const graphSources: GraphSourceAdapter[] = descriptor.graphSources.map((source) => {
    const adapter: GraphSourceAdapter = {
      describe: () => ({ ...source.descriptor }),
      collectGraph: () =>
        sandbox.request<SourceGraphSnapshot>({
          type: 'collectGraph',
          sourceId: source.descriptor.id,
        }),
    };
    if (source.supportsEvents) {
      adapter.startEvents = (callback, onError, onClose) =>
        sandbox.openStream(
          (streamId) => ({
            type: 'startGraphEvents',
            sourceId: source.descriptor.id,
            streamId,
          }),
          {
            onData: (event) => callback(event as SourceEvent),
            onError: (error) => onError?.(error),
            onEnd: () => onClose?.(),
          },
        );
    }
    return adapter;
  });
  const canHandleEntity = (
    provider: SandboxEntityProviderKind,
    providerIndex: number,
    ref: Parameters<EntityStatsProvider['canHandle']>[0],
  ) =>
    sandbox.request<boolean>({
      type: 'canHandleEntity',
      provider,
      providerIndex,
      ref,
    });
  const plugin: DockscopePlugin = {
    manifest,
    configure: (config) => sandbox.configure(config),
    start: () => sandbox.start(),
    stop: () => sandbox.stop(),
  };
  if (manifest.capabilities.includes('ui.command')) {
    plugin.getCommands = () => descriptor.commands;
    plugin.runCommand = (commandId, input) =>
      sandbox.request<PluginCommandResult>({ type: 'runCommand', commandId, input });
  }
  if (descriptor.ui.length > 0) {
    plugin.getUiExtensions = () => descriptor.ui;
  }
  if (manifest.capabilities.includes('source.graph')) {
    plugin.getGraphSources = () => graphSources;
  }
  if (descriptor.providers.stats > 0) {
    const providers: EntityStatsProvider[] = Array.from(
      { length: descriptor.providers.stats },
      (_, providerIndex) => ({
        canHandle: (ref) => canHandleEntity('stats', providerIndex, ref),
        getStats: (ref) =>
          sandbox.request<ContainerStats>({ type: 'getStats', providerIndex, ref }),
      }),
    );
    plugin.getStatsProviders = () => providers;
  }
  if (descriptor.providers.logs > 0) {
    const providers: EntityLogsProvider[] = Array.from(
      { length: descriptor.providers.logs },
      (_, providerIndex) => ({
        canHandle: (ref) => canHandleEntity('logs', providerIndex, ref),
        getLogs: (ref, requestOptions) =>
          sandbox.request<string>({
            type: 'getLogs',
            providerIndex,
            ref,
            options: requestOptions,
          }),
      }),
    );
    plugin.getLogsProviders = () => providers;
  }
  if (descriptor.providers.logStream > 0) {
    const providers: EntityLogStreamProvider[] = Array.from(
      { length: descriptor.providers.logStream },
      (_, providerIndex) => ({
        canHandle: (ref) => canHandleEntity('logStream', providerIndex, ref),
        streamLogs: (ref, onData, onError) =>
          sandbox.openStream(
            (streamId) => ({ type: 'startLogStream', providerIndex, ref, streamId }),
            {
              onData: (data) => {
                if (typeof data === 'string') {
                  onData(data);
                }
              },
              onError: (error) => onError?.(error),
              onEnd: () => {},
            },
          ),
      }),
    );
    plugin.getLogStreamProviders = () => providers;
  }
  if (descriptor.providers.lifecycle > 0) {
    const providers: EntityLifecycleProvider[] = Array.from(
      { length: descriptor.providers.lifecycle },
      (_, providerIndex) => ({
        canHandle: (ref) => canHandleEntity('lifecycle', providerIndex, ref),
        runLifecycleAction: (ref, action) =>
          sandbox.request<void>({ type: 'runLifecycleAction', providerIndex, ref, action }),
        removeEntity: (ref, requestOptions) =>
          sandbox.request<void>({
            type: 'removeEntity',
            providerIndex,
            ref,
            options: requestOptions,
          }),
      }),
    );
    plugin.getLifecycleProviders = () => providers;
  }
  if (descriptor.providers.inspect > 0) {
    const providers: EntityInspectProvider[] = Array.from(
      { length: descriptor.providers.inspect },
      (_, providerIndex) => ({
        canHandle: (ref) => canHandleEntity('inspect', providerIndex, ref),
        inspect: (ref) =>
          sandbox.request<ContainerInspect>({ type: 'inspect', providerIndex, ref }),
      }),
    );
    plugin.getInspectProviders = () => providers;
  }
  if (descriptor.providers.filesystem > 0) {
    const providers: EntityFilesystemProvider[] = Array.from(
      { length: descriptor.providers.filesystem },
      (_, providerIndex) => ({
        canHandle: (ref) => canHandleEntity('filesystem', providerIndex, ref),
        getTop: (ref) =>
          sandbox.request<ContainerTopResult>({ type: 'getTop', providerIndex, ref }),
        getDiff: (ref) =>
          sandbox.request<ContainerDiffEntry[]>({ type: 'getDiff', providerIndex, ref }),
      }),
    );
    plugin.getFilesystemProviders = () => providers;
  }
  if (descriptor.providers.diagnostic > 0) {
    const providers: EntityDiagnosticProvider[] = Array.from(
      { length: descriptor.providers.diagnostic },
      (_, providerIndex) => ({
        canHandle: (ref) => canHandleEntity('diagnostic', providerIndex, ref),
        diagnose: (ref) =>
          sandbox.request<CrashDiagnostic | null>({ type: 'diagnose', providerIndex, ref }),
      }),
    );
    plugin.getDiagnosticProviders = () => providers;
  }
  if (descriptor.providers.exec > 0) {
    const providers: EntityExecProvider[] = Array.from(
      { length: descriptor.providers.exec },
      (_, providerIndex) => ({
        canHandle: (ref) => canHandleEntity('exec', providerIndex, ref),
        createExecSession: (ref, command) => sandbox.openExecSession(providerIndex, ref, command),
      }),
    );
    plugin.getExecProviders = () => providers;
  }
  if (descriptor.providers.project > 0) {
    const providers: ProjectProvider[] = Array.from(
      { length: descriptor.providers.project },
      (_, providerIndex) => ({
        listProjects: () =>
          sandbox.request<ProjectSummary[]>({ type: 'listProjects', providerIndex }),
        runProjectAction: (project, action) =>
          sandbox.request<string>({
            type: 'runProjectAction',
            providerIndex,
            project,
            action,
          }),
      }),
    );
    plugin.getProjectProviders = () => providers;
  }
  if (descriptor.providers.resource > 0) {
    const providers: ResourceProvider[] = Array.from(
      { length: descriptor.providers.resource },
      (_, providerIndex) => ({
        canHandle: (resourceId) =>
          sandbox.request<boolean>({ type: 'canHandleResource', providerIndex, resourceId }),
        getResourceLogs: (resourceId, requestOptions) =>
          sandbox.request<string>({
            type: 'getResourceLogs',
            providerIndex,
            resourceId,
            options: requestOptions,
          }),
        runResourceAction: (resourceId, action, requestOptions) =>
          sandbox.request<void>({
            type: 'runResourceAction',
            providerIndex,
            resourceId,
            action,
            options: requestOptions,
          }),
      }),
    );
    plugin.getResourceProviders = () => providers;
  }
  return plugin;
}

export async function loadExternalPlugins(
  options: ExternalPluginLoadOptions,
): Promise<ExternalPluginLoadResult> {
  const plugins: DockscopePlugin[] = [];
  const configs = new Map<string, PluginConfig>();
  const errors: PluginLoadError[] = [];
  const policy = allowedPermissionSet(options.permissions);
  const logger = options.logger ?? console;

  for (const manifestPath of await discoverManifestPaths(options.paths)) {
    let phase: PluginLoadError['phase'] = 'manifest';
    let manifestId: string | undefined;
    try {
      const rawManifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as unknown;
      const manifest = validatePluginManifest(rawManifest);
      manifestId = manifest.id;
      const denied = deniedPermissions(manifest, policy);
      if (denied.length > 0) {
        phase = 'permission';
        throw new Error(`Plugin requires disallowed permissions: ${denied.join(', ')}`);
      }

      phase = 'config';
      const config = options.getConfig
        ? await options.getConfig(manifest)
        : defaultPluginConfig(manifest.config);
      phase = 'load';
      const entryPath = resolvePluginEntry(manifestPath, manifest);
      const pluginDir = path.dirname(manifestPath);
      if (manifest.execution?.isolation !== 'in-process') {
        plugins.push(
          await createProcessIsolatedPlugin({
            manifest,
            pluginDir,
            entryPath,
            config,
            secretStore: options.secretStore,
            publishEvent: options.publishEvent,
            timeoutMs: manifest.execution?.commandTimeoutMs ?? options.processCommandTimeoutMs,
            maxStderrBytes: manifest.execution?.maxStderrBytes ?? options.processMaxStderrBytes,
            memoryLimitMb: manifest.execution?.memoryLimitMb ?? options.processMemoryLimitMb,
            logger,
          }),
        );
        configs.set(manifest.id, config);
        continue;
      }
      const entryUrl = pathToFileURL(entryPath);
      if (options.cacheBust) {
        entryUrl.searchParams.set('v', `${Date.now()}`);
      }
      const module = (await import(entryUrl.href)) as ExternalPluginModule;
      const host = createPluginHostApi({
        pluginId: manifest.id,
        pluginDir,
        capabilities: manifest.capabilities,
        permissions: manifest.permissions,
        secrets: manifest.secrets,
        secretStore: options.secretStore,
        publishEvent: options.publishEvent
          ? (type, payload) => options.publishEvent!(manifest.id, type, payload)
          : undefined,
      });
      plugins.push(await instantiatePlugin(module, manifest, pluginDir, config, host, logger));
      configs.set(manifest.id, config);
    } catch (error) {
      errors.push({
        id: manifestId,
        path: manifestPath,
        phase,
        message: errorMessage(error),
      });
    }
  }

  return { plugins, configs, errors };
}

export async function validateExternalPluginManifests(options: {
  paths: readonly string[];
  permissions?: ExternalPluginPermissionPolicy;
}): Promise<ExternalPluginManifestValidationResult> {
  const manifests: PluginManifest[] = [];
  const errors: PluginLoadError[] = [];
  const policy = allowedPermissionSet(options.permissions);

  for (const manifestPath of await discoverManifestPaths(options.paths)) {
    let phase: PluginLoadError['phase'] = 'manifest';
    let manifestId: string | undefined;
    try {
      const rawManifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as unknown;
      const manifest = validatePluginManifest(rawManifest);
      manifestId = manifest.id;
      const denied = deniedPermissions(manifest, policy);
      if (denied.length > 0) {
        phase = 'permission';
        throw new Error(`Plugin requires disallowed permissions: ${denied.join(', ')}`);
      }
      phase = 'load';
      const entryPath = resolvePluginEntry(manifestPath, manifest);
      if (!(await pathExists(entryPath))) {
        throw new Error(`Plugin entry does not exist: ${entryPath}`);
      }
      manifests.push(manifest);
    } catch (error) {
      errors.push({
        id: manifestId,
        path: manifestPath,
        phase,
        message: errorMessage(error),
      });
    }
  }

  return { manifests, errors };
}

export async function loadExternalPluginsFromEnv(
  env: NodeJS.ProcessEnv,
  options: Pick<
    ExternalPluginLoadOptions,
    | 'getConfig'
    | 'secretStore'
    | 'publishEvent'
    | 'cacheBust'
    | 'processCommandTimeoutMs'
    | 'processMaxStderrBytes'
    | 'processMemoryLimitMb'
    | 'logger'
  > = {},
): Promise<ExternalPluginLoadResult> {
  if (env.DOCKSCOPE_DISABLE_EXTERNAL_PLUGINS === '1') {
    return { plugins: [], configs: new Map(), errors: [] };
  }
  return loadExternalPlugins({
    paths: parsePluginPaths(env.DOCKSCOPE_PLUGIN_PATHS),
    permissions: parsePluginPermissionList(env.DOCKSCOPE_PLUGIN_PERMISSIONS),
    ...options,
  });
}
