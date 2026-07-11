export type PluginProcessState = 'starting' | 'running' | 'stopped' | 'crashed';

export interface PluginProcessMetrics {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  cpuPercent: number;
  uptimeSeconds: number;
}

export interface PluginProcessHealthSnapshot {
  state: PluginProcessState;
  pid?: number;
  startedAt?: number;
  lastOperationAt?: number;
  restartCount: number;
  pendingOperations: number;
  openStreams: number;
  stderrBytes: number;
  operationTimeoutMs: number;
  memoryLimitMb: number;
  maxStderrBytes: number;
  lastCrashAt?: number;
  lastCrashError?: string;
  metrics?: PluginProcessMetrics;
}

export interface PluginRuntimeHealth extends PluginProcessHealthSnapshot {
  pluginId: string;
  isolation: 'in-process' | 'process';
  enabled: boolean;
  crashCount: number;
  quarantinedAt?: number;
  quarantineReason?: string;
}

export interface PluginRuntimeCrash {
  message: string;
  restartCount: number;
  time: number;
}
