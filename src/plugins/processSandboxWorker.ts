import { pathToFileURL } from 'url';
import type { PluginCommandResult } from '../core/plugin-commands.js';
import { validatePluginCommandResult } from '../core/plugin-commands.js';
import type { GraphSourceAdapter } from '../core/model.js';
import type {
  EntityActionProvider,
  EntityDiagnosticProvider,
  EntityExecProvider,
  EntityFilesystemProvider,
  EntityInspectProvider,
  EntityLifecycleProvider,
  EntityLogsProvider,
  EntityLogStreamProvider,
  EntityStatsProvider,
  ProjectProvider,
  ResourceProvider,
} from '../core/operations.js';
import { validateEntityActionResult, validateEntityActions } from '../core/entity-actions.js';
import type { MetricAnalysisProvider } from '../core/plugin-analysis.js';
import { validateMetricAnalysisResult } from '../core/plugin-analysis.js';
import type { PluginSystemProvider } from '../core/plugin-system.js';
import { validatePluginSystems } from '../core/plugin-system.js';
import type { PluginConnectionProvider } from '../core/plugin-connections.js';
import {
  validatePluginConnectionProvider,
  validatePluginConnections,
} from '../core/plugin-connections.js';
import type { DockscopePlugin, PluginManifest } from '../core/plugins.js';
import { validatePluginManifest } from '../core/plugins.js';
import type { PluginUiExtensionDeclaration } from '../core/plugin-ui.js';
import { validatePluginUiExtensions } from '../core/plugin-ui.js';
import { errorMessage } from '../utils.js';
import type { PluginHostApi } from './hostApi.js';
import type { PluginFactory, PluginFactoryContext } from '../core/plugin-api.js';
import type {
  SandboxBootstrap,
  SandboxHostCall,
  SandboxHostCallMessage,
  SandboxHostResultMessage,
  SandboxNotificationOperation,
  SandboxParentMessage,
  SandboxPluginDescriptor,
  SandboxRequestMessage,
  SandboxRequestOperation,
  SandboxWorkerMessage,
} from './processProtocol.js';

type ExternalPluginModule = Record<string, unknown>;

interface PendingHostCall {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

let plugin: DockscopePlugin | undefined;
let previousRuntimeMetrics:
  | { cpuUserMicros: number; cpuSystemMicros: number; sampledAt: number }
  | undefined;
let hostCallSequence = 0;
const pendingHostCalls = new Map<string, PendingHostCall>();
const streamStops = new Map<string, () => void>();
const execSessions = new Map<
  string,
  Awaited<ReturnType<EntityExecProvider['createExecSession']>>
>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isParentMessage(value: unknown): value is SandboxParentMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  if (value.type === 'request') {
    return typeof value.requestId === 'string' && isRecord(value.operation);
  }
  if (value.type === 'notification') {
    return isRecord(value.operation);
  }
  return value.type === 'hostResult' && typeof value.callId === 'string';
}

function send(message: SandboxWorkerMessage): void {
  process.send?.(message);
}

function safeLogValue(value: unknown): unknown {
  if (
    value === undefined ||
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

function sandboxLogger(): PluginFactoryContext['logger'] {
  const write = (level: 'debug' | 'info' | 'warn' | 'error', args: unknown[]) => {
    send({ type: 'log', level, args: args.map(safeLogValue) });
  };
  return {
    debug: (...args) => write('debug', args),
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
  };
}

function callHost<T>(call: SandboxHostCall): Promise<T> {
  const callId = `host:${++hostCallSequence}`;
  return new Promise<T>((resolve, reject) => {
    pendingHostCalls.set(callId, {
      resolve: (result) => resolve(result as T),
      reject,
    });
    const message: SandboxHostCallMessage = { type: 'hostCall', callId, call };
    if (!process.send) {
      pendingHostCalls.delete(callId);
      reject(new Error('Plugin host IPC is unavailable'));
      return;
    }
    process.send(message, (error) => {
      if (error) {
        pendingHostCalls.delete(callId);
        reject(error);
      }
    });
  });
}

function createHostProxy(pluginManifest: PluginManifest): PluginHostApi {
  return {
    permissions: [...pluginManifest.permissions],
    readTextFile: (relativePath) => callHost({ method: 'readTextFile', relativePath }),
    writeTextFile: (relativePath, contents) =>
      callHost({ method: 'writeTextFile', relativePath, contents }),
    fetchJson: (url, init) => callHost({ method: 'fetchJson', url, init }),
    execFile: (command, args = []) => callHost({ method: 'execFile', command, args: [...args] }),
    readSecret: (key) => callHost({ method: 'readSecret', key }),
    readStorage: (key) => callHost({ method: 'readStorage', key }),
    writeStorage: (key, value) => callHost({ method: 'writeStorage', key, value }),
    deleteStorage: (key) => callHost({ method: 'deleteStorage', key }),
    publishEvent: (eventType, payload) => callHost({ method: 'publishEvent', eventType, payload }),
  };
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

async function instantiatePlugin(bootstrap: SandboxBootstrap): Promise<DockscopePlugin> {
  const validatedManifest = validatePluginManifest(bootstrap.manifest);
  const module = (await import(pathToFileURL(bootstrap.entryPath).href)) as ExternalPluginModule;
  const candidate = pluginFactoryFromModule(module);
  const context: PluginFactoryContext = {
    manifest: validatedManifest,
    pluginDir: bootstrap.pluginDir,
    config: bootstrap.config,
    host: createHostProxy(validatedManifest),
    logger: sandboxLogger(),
  };
  const instance = isPluginFactory(candidate) ? await candidate(context) : candidate;
  if (!instance || typeof instance !== 'object') {
    throw new Error('Plugin module did not return a plugin object');
  }
  const instanceManifest = validatePluginManifest(instance.manifest);
  if (instanceManifest.id !== validatedManifest.id) {
    throw new Error(
      `Plugin module manifest id "${instanceManifest.id}" does not match plugin.json id "${validatedManifest.id}"`,
    );
  }
  return { ...instance, manifest: instanceManifest };
}

function requirePlugin(): DockscopePlugin {
  if (!plugin) {
    throw new Error('Plugin process is not initialized');
  }
  return plugin;
}

function itemAt<T>(items: readonly T[], index: number, kind: string): T {
  const item = items[index];
  if (!item) {
    throw new Error(`Plugin ${kind} provider not found at index ${index}`);
  }
  return item;
}

function graphSources(): readonly GraphSourceAdapter[] {
  return requirePlugin().getGraphSources?.() ?? [];
}

function statsProviders(): readonly EntityStatsProvider[] {
  return requirePlugin().getStatsProviders?.() ?? [];
}

function actionProviders(): readonly EntityActionProvider[] {
  return requirePlugin().getActionProviders?.() ?? [];
}

function metricAnalysisProviders(): readonly MetricAnalysisProvider[] {
  return requirePlugin().getMetricAnalysisProviders?.() ?? [];
}

function systemProviders(): readonly PluginSystemProvider[] {
  return requirePlugin().getSystemProviders?.() ?? [];
}

function connectionProviders(): readonly PluginConnectionProvider[] {
  return requirePlugin().getConnectionProviders?.() ?? [];
}

function logsProviders(): readonly EntityLogsProvider[] {
  return requirePlugin().getLogsProviders?.() ?? [];
}

function logStreamProviders(): readonly EntityLogStreamProvider[] {
  return requirePlugin().getLogStreamProviders?.() ?? [];
}

function lifecycleProviders(): readonly EntityLifecycleProvider[] {
  return requirePlugin().getLifecycleProviders?.() ?? [];
}

function inspectProviders(): readonly EntityInspectProvider[] {
  return requirePlugin().getInspectProviders?.() ?? [];
}

function filesystemProviders(): readonly EntityFilesystemProvider[] {
  return requirePlugin().getFilesystemProviders?.() ?? [];
}

function diagnosticProviders(): readonly EntityDiagnosticProvider[] {
  return requirePlugin().getDiagnosticProviders?.() ?? [];
}

function execProviders(): readonly EntityExecProvider[] {
  return requirePlugin().getExecProviders?.() ?? [];
}

function projectProviders(): readonly ProjectProvider[] {
  return requirePlugin().getProjectProviders?.() ?? [];
}

function resourceProviders(): readonly ResourceProvider[] {
  return requirePlugin().getResourceProviders?.() ?? [];
}

function describePlugin(): SandboxPluginDescriptor {
  const instance = requirePlugin();
  const ui: PluginUiExtensionDeclaration[] = validatePluginUiExtensions(
    instance.getUiExtensions?.() ?? [],
  );
  return {
    manifest: instance.manifest,
    graphSources: graphSources().map((source) => ({
      descriptor: source.describe(),
      supportsEvents: Boolean(source.startEvents),
    })),
    providers: {
      action: actionProviders().length,
      metricAnalysis: metricAnalysisProviders().length,
      stats: statsProviders().length,
      logs: logsProviders().length,
      logStream: logStreamProviders().length,
      lifecycle: lifecycleProviders().length,
      inspect: inspectProviders().length,
      filesystem: filesystemProviders().length,
      diagnostic: diagnosticProviders().length,
      exec: execProviders().length,
      project: projectProviders().length,
      resource: resourceProviders().length,
      system: systemProviders().length,
    },
    commands: [...(instance.getCommands?.() ?? [])],
    ui,
    connectionProviders: connectionProviders().map((provider) =>
      validatePluginConnectionProvider(provider.describe()),
    ),
  };
}

async function canHandleEntity(
  operation: Extract<SandboxRequestOperation, { type: 'canHandleEntity' }>,
) {
  switch (operation.provider) {
    case 'action':
      return actionProviders()[operation.providerIndex]?.canHandle(operation.ref) ?? false;
    case 'metricAnalysis':
      return metricAnalysisProviders()[operation.providerIndex]?.canHandle(operation.ref) ?? false;
    case 'stats':
      return statsProviders()[operation.providerIndex]?.canHandle(operation.ref) ?? false;
    case 'logs':
      return logsProviders()[operation.providerIndex]?.canHandle(operation.ref) ?? false;
    case 'logStream':
      return logStreamProviders()[operation.providerIndex]?.canHandle(operation.ref) ?? false;
    case 'lifecycle':
      return lifecycleProviders()[operation.providerIndex]?.canHandle(operation.ref) ?? false;
    case 'inspect':
      return inspectProviders()[operation.providerIndex]?.canHandle(operation.ref) ?? false;
    case 'filesystem':
      return filesystemProviders()[operation.providerIndex]?.canHandle(operation.ref) ?? false;
    case 'diagnostic':
      return diagnosticProviders()[operation.providerIndex]?.canHandle(operation.ref) ?? false;
    case 'exec':
      return execProviders()[operation.providerIndex]?.canHandle(operation.ref) ?? false;
  }
}

function stopStream(streamId: string): void {
  streamStops.get(streamId)?.();
  streamStops.delete(streamId);
  const session = execSessions.get(streamId);
  if (session) {
    const destroy = (session.stream as NodeJS.ReadWriteStream & { destroy?: () => void }).destroy;
    destroy?.call(session.stream);
    execSessions.delete(streamId);
  }
}

function stopAllStreams(): void {
  for (const streamId of new Set([...streamStops.keys(), ...execSessions.keys()])) {
    stopStream(streamId);
  }
}

async function handleOperation(operation: SandboxRequestOperation): Promise<unknown> {
  switch (operation.type) {
    case 'initialize':
      if (!plugin) {
        plugin = await instantiatePlugin(operation.bootstrap);
      }
      return describePlugin();
    case 'configure':
      await requirePlugin().configure?.(operation.config);
      return undefined;
    case 'start':
      await requirePlugin().start?.();
      return undefined;
    case 'stop':
      stopAllStreams();
      await requirePlugin().stop?.();
      return undefined;
    case 'runCommand': {
      const instance = requirePlugin();
      if (!instance.runCommand) {
        throw new Error(`Plugin does not implement commands: ${instance.manifest.id}`);
      }
      return validatePluginCommandResult(
        await instance.runCommand(operation.commandId, operation.input),
      ) satisfies PluginCommandResult;
    }
    case 'runtimeMetrics': {
      const memory = process.memoryUsage();
      const cpu = process.cpuUsage();
      const sampledAt = Date.now();
      const uptimeSeconds = process.uptime();
      const elapsedMicros = previousRuntimeMetrics
        ? (sampledAt - previousRuntimeMetrics.sampledAt) * 1000
        : uptimeSeconds * 1_000_000;
      const cpuMicros = previousRuntimeMetrics
        ? cpu.user -
          previousRuntimeMetrics.cpuUserMicros +
          (cpu.system - previousRuntimeMetrics.cpuSystemMicros)
        : cpu.user + cpu.system;
      previousRuntimeMetrics = {
        cpuUserMicros: cpu.user,
        cpuSystemMicros: cpu.system,
        sampledAt,
      };
      return {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        cpuUserMicros: cpu.user,
        cpuSystemMicros: cpu.system,
        cpuPercent: elapsedMicros > 0 ? Math.max(0, (cpuMicros / elapsedMicros) * 100) : 0,
        uptimeSeconds,
      };
    }
    case 'collectGraph': {
      const source = graphSources().find(
        (candidate) => candidate.describe().id === operation.sourceId,
      );
      if (!source) {
        throw new Error(`Plugin graph source not found: ${operation.sourceId}`);
      }
      return source.collectGraph();
    }
    case 'listSystems':
      return validatePluginSystems(
        await itemAt(systemProviders(), operation.providerIndex, 'system').listSystems(),
      );
    case 'listConnections':
      return validatePluginConnections(
        await itemAt(
          connectionProviders(),
          operation.providerIndex,
          'connection',
        ).listConnections(),
      );
    case 'addConnection':
      return itemAt(connectionProviders(), operation.providerIndex, 'connection').addConnection(
        operation.input,
      );
    case 'removeConnection':
      return itemAt(connectionProviders(), operation.providerIndex, 'connection').removeConnection(
        operation.connectionId,
      );
    case 'refreshConnections':
      return itemAt(
        connectionProviders(),
        operation.providerIndex,
        'connection',
      ).refreshConnections?.();
    case 'canHandleEntity':
      return Boolean(await canHandleEntity(operation));
    case 'getStats':
      return itemAt(statsProviders(), operation.providerIndex, 'stats').getStats(operation.ref);
    case 'analyzeMetric':
      return validateMetricAnalysisResult(
        await itemAt(metricAnalysisProviders(), operation.providerIndex, 'metric analysis').analyze(
          operation.sample,
        ),
      );
    case 'listEntityActions':
      return validateEntityActions(
        await itemAt(actionProviders(), operation.providerIndex, 'action').listActions(
          operation.ref,
        ),
      );
    case 'runEntityAction':
      return validateEntityActionResult(
        await itemAt(actionProviders(), operation.providerIndex, 'action').runAction(
          operation.ref,
          operation.actionId,
          operation.input,
        ),
      );
    case 'getLogs':
      return itemAt(logsProviders(), operation.providerIndex, 'logs').getLogs(
        operation.ref,
        operation.options,
      );
    case 'runLifecycleAction':
      return itemAt(lifecycleProviders(), operation.providerIndex, 'lifecycle').runLifecycleAction(
        operation.ref,
        operation.action,
      );
    case 'removeEntity':
      return itemAt(lifecycleProviders(), operation.providerIndex, 'lifecycle').removeEntity(
        operation.ref,
        operation.options,
      );
    case 'inspect':
      return itemAt(inspectProviders(), operation.providerIndex, 'inspect').inspect(operation.ref);
    case 'getTop':
      return itemAt(filesystemProviders(), operation.providerIndex, 'filesystem').getTop(
        operation.ref,
      );
    case 'getDiff':
      return itemAt(filesystemProviders(), operation.providerIndex, 'filesystem').getDiff(
        operation.ref,
      );
    case 'diagnose':
      return itemAt(diagnosticProviders(), operation.providerIndex, 'diagnostic').diagnose(
        operation.ref,
      );
    case 'listProjects':
      return itemAt(projectProviders(), operation.providerIndex, 'project').listProjects();
    case 'canHandleProject': {
      const provider = itemAt(projectProviders(), operation.providerIndex, 'project');
      return provider.canHandle
        ? provider.canHandle(operation.project)
        : (await provider.listProjects()).some((project) => project.name === operation.project);
    }
    case 'runProjectAction':
      return itemAt(projectProviders(), operation.providerIndex, 'project').runProjectAction(
        operation.project,
        operation.action,
      );
    case 'canHandleResource':
      return Boolean(
        await resourceProviders()[operation.providerIndex]?.canHandle(operation.resourceId),
      );
    case 'getResourceLogs':
      return itemAt(resourceProviders(), operation.providerIndex, 'resource').getResourceLogs(
        operation.resourceId,
        operation.options,
      );
    case 'runResourceAction':
      return itemAt(resourceProviders(), operation.providerIndex, 'resource').runResourceAction(
        operation.resourceId,
        operation.action,
        operation.options,
      );
    case 'startGraphEvents': {
      const source = graphSources().find(
        (candidate) => candidate.describe().id === operation.sourceId,
      );
      if (!source?.startEvents) {
        throw new Error(`Plugin graph source does not implement events: ${operation.sourceId}`);
      }
      const stop = source.startEvents(
        (event) =>
          send({ type: 'stream', streamId: operation.streamId, event: 'data', data: event }),
        (error) =>
          send({
            type: 'stream',
            streamId: operation.streamId,
            event: 'error',
            message: error.message,
          }),
        () => send({ type: 'stream', streamId: operation.streamId, event: 'end' }),
      );
      streamStops.set(operation.streamId, stop);
      return true;
    }
    case 'startLogStream': {
      const provider = itemAt(logStreamProviders(), operation.providerIndex, 'log stream');
      const stop = await provider.streamLogs(
        operation.ref,
        (text) => send({ type: 'stream', streamId: operation.streamId, event: 'data', data: text }),
        (error) =>
          send({
            type: 'stream',
            streamId: operation.streamId,
            event: 'error',
            message: error.message,
          }),
      );
      streamStops.set(operation.streamId, stop);
      return true;
    }
    case 'startExecSession': {
      const session = await itemAt(
        execProviders(),
        operation.providerIndex,
        'exec',
      ).createExecSession(operation.ref, operation.command);
      execSessions.set(operation.streamId, session);
      session.stream.on('data', (chunk: Buffer | string) => {
        send({
          type: 'stream',
          streamId: operation.streamId,
          event: 'data',
          data: typeof chunk === 'string' ? chunk : new Uint8Array(chunk),
        });
      });
      session.stream.on('end', () => {
        execSessions.delete(operation.streamId);
        send({ type: 'stream', streamId: operation.streamId, event: 'end' });
      });
      session.stream.on('error', (error: Error) => {
        execSessions.delete(operation.streamId);
        send({
          type: 'stream',
          streamId: operation.streamId,
          event: 'error',
          message: error.message,
        });
      });
      return true;
    }
    case 'inspectExecSession': {
      const session = execSessions.get(operation.streamId);
      if (!session) {
        throw new Error(`Plugin exec session not found: ${operation.streamId}`);
      }
      return session.inspect();
    }
    case 'stopStream':
      stopStream(operation.streamId);
      return undefined;
  }
}

function handleNotification(operation: SandboxNotificationOperation): void {
  if (operation.type === 'stopStream') {
    stopStream(operation.streamId);
    return;
  }
  const session = execSessions.get(operation.streamId);
  if (session) {
    session.stream.write(
      typeof operation.data === 'string' ? operation.data : Buffer.from(operation.data),
    );
  }
}

function handleHostResult(message: SandboxHostResultMessage): void {
  const pending = pendingHostCalls.get(message.callId);
  if (!pending) {
    return;
  }
  pendingHostCalls.delete(message.callId);
  if (message.error) {
    pending.reject(new Error(message.error));
  } else {
    pending.resolve(message.result);
  }
}

async function handleRequest(message: SandboxRequestMessage): Promise<void> {
  try {
    const result = await handleOperation(message.operation);
    send({ type: 'result', requestId: message.requestId, result });
  } catch (error) {
    send({ type: 'error', requestId: message.requestId, message: errorMessage(error) });
  }
}

process.on('message', (raw: unknown) => {
  if (!isParentMessage(raw)) {
    return;
  }
  if (raw.type === 'hostResult') {
    handleHostResult(raw);
    return;
  }
  if (raw.type === 'notification') {
    handleNotification(raw.operation);
    return;
  }
  void handleRequest(raw);
});

process.on('disconnect', () => {
  stopAllStreams();
  for (const pending of pendingHostCalls.values()) {
    pending.reject(new Error('Plugin host disconnected'));
  }
  pendingHostCalls.clear();
});
