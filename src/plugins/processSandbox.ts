import { fork, type ChildProcess } from 'child_process';
import { Duplex } from 'stream';
import { fileURLToPath } from 'url';
import type { PluginConfig } from '../core/plugin-config.js';
import type { PluginEvent } from '../core/plugin-events.js';
import type { PluginManifest } from '../core/plugins.js';
import type { EntityExecSession, EntityRef } from '../core/operations.js';
import type {
  PluginProcessHealthSnapshot,
  PluginProcessMetrics,
  PluginProcessState,
} from '../core/plugin-runtime.js';
import { createPluginHostApi, type PluginHostApi } from './hostApi.js';
import type { PluginSecretStore } from './secretStore.js';
import type {
  SandboxHostCall,
  SandboxHostCallMessage,
  SandboxHostResultMessage,
  SandboxNotificationOperation,
  SandboxParentMessage,
  SandboxPluginDescriptor,
  SandboxRequestOperation,
  SandboxWorkerMessage,
} from './processProtocol.js';

interface PendingRequest {
  operation: string;
  resolve(result: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface StreamHandlers {
  onData(data: unknown): void;
  onError(error: Error): void;
  onEnd(): void;
}

export interface PluginProcessSandboxOptions {
  entryPath: string;
  manifest: PluginManifest;
  pluginDir: string;
  config: PluginConfig;
  timeoutMs?: number;
  maxStderrBytes?: number;
  memoryLimitMb?: number;
  secretStore?: PluginSecretStore;
  publishEvent?: (
    pluginId: string,
    type: string,
    payload: unknown,
  ) => PluginEvent | Promise<PluginEvent>;
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  onCrash?: (error: Error, restartCount: number) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorkerMessage(value: unknown): value is SandboxWorkerMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  switch (value.type) {
    case 'result':
    case 'error':
      return typeof value.requestId === 'string';
    case 'event':
      return typeof value.eventType === 'string';
    case 'stream':
      return typeof value.streamId === 'string' && typeof value.event === 'string';
    case 'log':
      return typeof value.level === 'string' && Array.isArray(value.args);
    case 'hostCall':
      return typeof value.callId === 'string' && isRecord(value.call);
    default:
      return false;
  }
}

function sandboxWorkerPath(): string {
  const current = fileURLToPath(import.meta.url);
  if (current.endsWith('.ts')) {
    return current.replace(/processSandbox\.ts$/, 'processSandboxWorker.ts');
  }
  return current.replace(/processSandbox\.js$/, 'processSandboxWorker.js');
}

function sandboxExecArgv(workerPath: string, memoryLimitMb: number): string[] {
  const loaderArgs = workerPath.endsWith('.ts') ? ['--import', 'tsx'] : [];
  return [...loaderArgs, `--max-old-space-size=${memoryLimitMb}`];
}

function sandboxEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'HOME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'NODE_ENV',
    'NODE_PATH',
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'TMP',
    'TMPDIR',
    'TEMP',
    'WINDIR',
  ];
  const env: NodeJS.ProcessEnv = { DOCKSCOPE_PLUGIN_SANDBOX: '1' };
  for (const key of allowed) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
}

function errorFromUnknown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export class PluginProcessSandbox {
  private child?: ChildProcess;
  private initializing?: Promise<SandboxPluginDescriptor>;
  private descriptor?: SandboxPluginDescriptor;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly streams = new Map<string, StreamHandlers>();
  private readonly host: PluginHostApi;
  private requestSequence = 0;
  private streamSequence = 0;
  private stderrBytes = 0;
  private stderrTail = '';
  private restartCount = 0;
  private processState: PluginProcessState = 'stopped';
  private startedAt?: number;
  private lastOperationAt?: number;
  private lastCrashAt?: number;
  private lastCrashError?: string;
  private disposed = false;
  private pluginStarted = false;

  constructor(private readonly options: PluginProcessSandboxOptions) {
    this.host = createPluginHostApi({
      pluginId: options.manifest.id,
      pluginDir: options.pluginDir,
      capabilities: options.manifest.capabilities,
      permissions: options.manifest.permissions,
      secrets: options.manifest.secrets,
      secretStore: options.secretStore,
      publishEvent: options.publishEvent
        ? (type, payload) => options.publishEvent!(options.manifest.id, type, payload)
        : undefined,
    });
  }

  async initialize(): Promise<SandboxPluginDescriptor> {
    return this.ensureInitialized();
  }

  async configure(config: PluginConfig): Promise<void> {
    this.options.config = config;
    await this.request({ type: 'configure', config });
  }

  async start(): Promise<void> {
    await this.ensureInitialized();
    this.pluginStarted = true;
    await this.sendRequest({ type: 'start' });
  }

  async stop(): Promise<void> {
    this.pluginStarted = false;
    if (!this.child?.connected) {
      this.disposeProcess();
      return;
    }
    try {
      await this.request({ type: 'stop' });
    } finally {
      this.disposeProcess();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pluginStarted = false;
    this.disposeProcess();
  }

  async request<T>(operation: SandboxRequestOperation): Promise<T> {
    await this.ensureInitialized();
    return this.sendRequest<T>(operation);
  }

  async getRuntimeHealth(): Promise<PluginProcessHealthSnapshot> {
    let metrics: PluginProcessMetrics | undefined;
    if (this.child?.connected) {
      try {
        metrics = await this.sendRequest<PluginProcessMetrics>(
          { type: 'runtimeMetrics' },
          1000,
          false,
        );
      } catch {
        // The crash/timeout path updates the process snapshot.
      }
    }
    return {
      state: this.processState,
      pid: this.child?.pid,
      startedAt: this.startedAt,
      lastOperationAt: this.lastOperationAt,
      restartCount: this.restartCount,
      pendingOperations: this.pending.size,
      openStreams: this.streams.size,
      stderrBytes: this.stderrBytes,
      operationTimeoutMs: this.options.timeoutMs ?? 30_000,
      memoryLimitMb: this.options.memoryLimitMb ?? 128,
      maxStderrBytes: this.options.maxStderrBytes ?? 64_000,
      lastCrashAt: this.lastCrashAt,
      lastCrashError: this.lastCrashError,
      metrics,
    };
  }

  openStream(
    createOperation: (streamId: string) => SandboxRequestOperation,
    handlers: StreamHandlers,
  ): () => void {
    const streamId = `${this.options.manifest.id}:stream:${++this.streamSequence}`;
    let stopped = false;
    this.streams.set(streamId, handlers);
    void this.request(createOperation(streamId)).catch((error) => {
      if (!stopped) {
        handlers.onError(errorFromUnknown(error));
      }
      this.streams.delete(streamId);
    });
    return () => {
      if (stopped) {
        return;
      }
      stopped = true;
      this.streams.delete(streamId);
      this.notify({ type: 'stopStream', streamId });
    };
  }

  async openExecSession(
    providerIndex: number,
    ref: EntityRef,
    command?: string[],
  ): Promise<EntityExecSession> {
    const streamId = `${this.options.manifest.id}:exec:${++this.streamSequence}`;
    const stream = new Duplex({
      read() {},
      write: (chunk: Buffer | string, _encoding, callback) => {
        this.notify({
          type: 'execInput',
          streamId,
          data: typeof chunk === 'string' ? chunk : new Uint8Array(chunk),
        });
        callback();
      },
      destroy: (error, callback) => {
        this.streams.delete(streamId);
        this.notify({ type: 'stopStream', streamId });
        callback(error);
      },
    });
    this.streams.set(streamId, {
      onData: (data) => {
        if (typeof data === 'string') {
          stream.push(data);
          return;
        }
        if (data instanceof Uint8Array) {
          stream.push(Buffer.from(data));
        }
      },
      onError: (error) => stream.destroy(error),
      onEnd: () => stream.push(null),
    });
    try {
      await this.request({
        type: 'startExecSession',
        providerIndex,
        ref,
        command,
        streamId,
      });
    } catch (error) {
      this.streams.delete(streamId);
      stream.destroy();
      throw error;
    }
    return {
      stream,
      inspect: () => this.request({ type: 'inspectExecSession', streamId }),
    };
  }

  private async ensureInitialized(): Promise<SandboxPluginDescriptor> {
    if (this.disposed) {
      throw new Error(`Plugin sandbox is disposed: ${this.options.manifest.id}`);
    }
    if (this.child?.connected && this.descriptor) {
      return this.descriptor;
    }
    if (this.initializing) {
      return this.initializing;
    }
    this.spawn();
    this.initializing = this.sendRequest<SandboxPluginDescriptor>({
      type: 'initialize',
      bootstrap: {
        entryPath: this.options.entryPath,
        manifest: this.options.manifest,
        pluginDir: this.options.pluginDir,
        config: this.options.config,
      },
    })
      .then(async (descriptor) => {
        this.descriptor = descriptor;
        this.processState = 'running';
        if (this.pluginStarted) {
          await this.sendRequest({ type: 'configure', config: this.options.config });
          await this.sendRequest({ type: 'start' });
        }
        return descriptor;
      })
      .finally(() => {
        this.initializing = undefined;
      });
    return this.initializing;
  }

  private spawn(): void {
    const workerPath = sandboxWorkerPath();
    this.stderrBytes = 0;
    this.stderrTail = '';
    this.processState = 'starting';
    this.startedAt = Date.now();
    const child = fork(workerPath, [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      execArgv: sandboxExecArgv(workerPath, this.options.memoryLimitMb ?? 128),
      env: sandboxEnvironment(),
      serialization: 'advanced',
    });
    this.child = child;
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (this.child === child) {
        this.handleStderr(chunk);
      }
    });
    child.on('message', (message: unknown) => {
      if (this.child === child) {
        this.handleMessage(child, message);
      }
    });
    child.on('error', (error) => {
      if (this.child === child) {
        this.handleCrash(error);
      }
    });
    child.on('exit', (code, signal) => {
      if (this.child !== child) {
        return;
      }
      const detail = this.stderrTail.trim();
      this.handleCrash(
        new Error(`Plugin process exited (${signal ?? code})${detail ? `: ${detail}` : ''}`),
      );
    });
  }

  private sendRequest<T>(
    operation: SandboxRequestOperation,
    timeoutMs = this.options.timeoutMs ?? 30_000,
    terminateOnTimeout = true,
  ): Promise<T> {
    const child = this.child;
    if (!child?.connected) {
      return Promise.reject(
        new Error(`Plugin process is not connected: ${this.options.manifest.id}`),
      );
    }
    const requestId = `${this.options.manifest.id}:${++this.requestSequence}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        const error = new Error(
          `Plugin operation "${operation.type}" timed out after ${timeoutMs}ms`,
        );
        reject(error);
        if (terminateOnTimeout) {
          this.terminate(error);
        }
      }, timeoutMs);
      this.pending.set(requestId, {
        operation: operation.type,
        resolve: (result) => resolve(result as T),
        reject,
        timeout,
      });
      const message: SandboxParentMessage = { type: 'request', requestId, operation };
      child.send(message, (error) => {
        if (error) {
          const pending = this.pending.get(requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pending.delete(requestId);
            pending.reject(error);
          }
        }
      });
    });
  }

  private notify(operation: SandboxNotificationOperation): void {
    if (!this.child?.connected) {
      return;
    }
    const message: SandboxParentMessage = { type: 'notification', operation };
    this.child.send(message);
  }

  private handleMessage(child: ChildProcess, raw: unknown): void {
    if (!isWorkerMessage(raw)) {
      return;
    }
    if (raw.type === 'result' || raw.type === 'error') {
      const pending = this.pending.get(raw.requestId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(raw.requestId);
      if (raw.type === 'error') {
        pending.reject(new Error(raw.message));
      } else {
        this.lastOperationAt = Date.now();
        pending.resolve(raw.result);
      }
      return;
    }
    if (raw.type === 'event') {
      void this.options.publishEvent?.(this.options.manifest.id, raw.eventType, raw.payload);
      return;
    }
    if (raw.type === 'stream') {
      const handlers = this.streams.get(raw.streamId);
      if (!handlers) {
        return;
      }
      if (raw.event === 'data') {
        handlers.onData(raw.data);
        return;
      }
      this.streams.delete(raw.streamId);
      if (raw.event === 'error') {
        handlers.onError(new Error(raw.message ?? 'Plugin stream failed'));
      } else {
        handlers.onEnd();
      }
      return;
    }
    if (raw.type === 'log') {
      this.options.logger?.[raw.level](`[plugin:${this.options.manifest.id}]`, ...raw.args);
      return;
    }
    void this.handleHostCall(child, raw);
  }

  private async handleHostCall(
    child: ChildProcess,
    message: SandboxHostCallMessage,
  ): Promise<void> {
    let response: SandboxHostResultMessage;
    try {
      response = {
        type: 'hostResult',
        callId: message.callId,
        result: await this.runHostCall(message.call),
      };
    } catch (error) {
      response = {
        type: 'hostResult',
        callId: message.callId,
        error: errorFromUnknown(error).message,
      };
    }
    if (this.child === child && child.connected) {
      child.send(response);
    }
  }

  private runHostCall(call: SandboxHostCall): Promise<unknown> {
    switch (call.method) {
      case 'readTextFile':
        return this.host.readTextFile(call.relativePath);
      case 'writeTextFile':
        return this.host.writeTextFile(call.relativePath, call.contents);
      case 'fetchJson':
        return this.host.fetchJson(call.url, call.init);
      case 'execFile':
        return this.host.execFile(call.command, call.args);
      case 'readSecret':
        return this.host.readSecret(call.key);
      case 'readStorage':
        return this.host.readStorage(call.key);
      case 'writeStorage':
        return this.host.writeStorage(call.key, call.value);
      case 'deleteStorage':
        return this.host.deleteStorage(call.key);
      case 'publishEvent':
        return this.host.publishEvent(call.eventType, call.payload);
    }
  }

  private handleStderr(chunk: Buffer | string): void {
    const text = chunk.toString();
    this.stderrBytes += Buffer.byteLength(text);
    this.stderrTail = `${this.stderrTail}${text}`.slice(-8192);
    if (this.stderrBytes > (this.options.maxStderrBytes ?? 64_000)) {
      this.terminate(new Error('Plugin process stderr limit exceeded'));
    }
  }

  private terminate(error: Error): void {
    const child = this.child;
    if (child && !child.killed) {
      child.kill();
    }
    this.handleCrash(error);
  }

  private handleCrash(error: Error): void {
    if (!this.child && this.pending.size === 0) {
      return;
    }
    const child = this.child;
    this.child = undefined;
    this.initializing = undefined;
    this.processState = 'crashed';
    this.lastCrashAt = Date.now();
    this.lastCrashError = error.message;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const handlers of this.streams.values()) {
      handlers.onError(error);
    }
    this.streams.clear();
    if (child?.connected) {
      child.disconnect();
    }
    if (child && !child.killed) {
      child.kill();
    }
    if (!this.disposed) {
      this.restartCount += 1;
      this.options.onCrash?.(error, this.restartCount);
    }
  }

  private disposeProcess(): void {
    const child = this.child;
    this.child = undefined;
    this.initializing = undefined;
    this.processState = 'stopped';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Plugin process stopped: ${this.options.manifest.id}`));
    }
    this.pending.clear();
    for (const handlers of this.streams.values()) {
      handlers.onEnd();
    }
    this.streams.clear();
    if (child?.connected) {
      child.disconnect();
    }
    if (child && !child.killed) {
      child.kill();
    }
  }
}
