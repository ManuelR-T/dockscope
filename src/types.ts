export interface ServiceNode {
  id: string;
  name: string;
  fullName: string;
  project: string;
  host: string;
  runtime?: 'docker' | 'kubernetes';
  kind?: 'container' | 'pod' | 'service' | 'ingress' | 'hpa';
  namespace?: string;
  rolloutPhase?: 'terminating';
  rolloutUntil?: number;
  metadata?: Record<string, string | number | boolean>;
  containerId: string;
  image: string;
  status:
    | 'running'
    | 'exited'
    | 'paused'
    | 'restarting'
    | 'dead'
    | 'created'
    | 'removing'
    | 'pending'
    | 'unknown';
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  ports: string[];
  networks: string[];
  volumeCount: number;
  cpu: number;
  memory: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
  networkRxRate: number;
  networkTxRate: number;
}

export interface ServiceLink {
  source: string | { id: string };
  target: string | { id: string };
  type: 'depends_on' | 'network' | 'kubernetes';
  label?: string;
}

export interface GraphData {
  nodes: ServiceNode[];
  links: ServiceLink[];
}

export interface RuntimeEvent {
  id: string;
  entityId?: string;
  containerId?: string;
  sourceId?: string;
  host?: string;
  type: string;
  action: string;
  actor: string;
  time: number;
  message: string;
}

/** @deprecated Use RuntimeEvent. */
export type DockerEvent = RuntimeEvent;

export interface ContainerStats {
  id: string;
  cpu: number;
  memory: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
  networkRxRate: number; // bytes/sec
  networkTxRate: number; // bytes/sec
}

export interface ContainerInspect {
  id: string;
  env: string[];
  labels: Record<string, string>;
  mounts: { type: string; source: string; destination: string; mode: string }[];
  restartPolicy: string;
  entrypoint: string[] | null;
  cmd: string[] | null;
  workingDir: string;
  created: string;
}

export interface LogChunk {
  entityId?: string;
  containerId: string;
  text: string;
}

export interface WSMessage {
  type:
    | 'graph'
    | 'stats'
    | 'event'
    | 'error'
    | 'log_chunk'
    | 'subscribe_logs'
    | 'unsubscribe_logs'
    | 'anomaly'
    | 'diagnostic';
  data:
    | GraphData
    | ContainerStats
    | DockerEvent
    | LogChunk
    | Anomaly
    | CrashDiagnostic
    | { message: string }
    | { containerId: string };
}

export interface SystemInfo {
  dockerVersion: string;
  os: string;
  totalMemory: number;
  cpus: number;
  containersRunning: number;
  containersStopped: number;
  images: number;
}

export interface ContainerDiffEntry {
  kind: 'A' | 'C' | 'D'; // Added, Changed, Deleted
  path: string;
}

export interface ContainerTopResult {
  titles: string[];
  processes: string[][];
}

export interface MetricPoint {
  cpu: number;
  memory: number;
  time: number;
}

export interface Anomaly {
  analyzerId?: string;
  containerId: string;
  containerName: string;
  metric: 'cpu' | 'memory';
  value: number;
  average: number;
  threshold: number;
  time: number;
}
export interface CrashDiagnostic {
  containerId: string;
  containerName: string;
  exitCode: number;
  oomKilled: boolean;
  cause: string;
  details: string[];
  logSnippet: string[];
  time: number;
}

export interface ServerOptions {
  port: number;
  open: boolean;
  host?: string;
  bind?: string;
  pluginPaths?: string;
  pluginPermissions?: string;
  pluginConfig?: string;
  pluginState?: string;
  pluginSecrets?: string;
  pluginSecretKey?: string;
  pluginEvents?: string;
  pluginApprovals?: string;
  pluginCatalog?: string;
  pluginCatalogPublicKey?: string;
  pluginCatalogTrust?: string;
  disableOfficialPluginCatalog?: boolean;
  pluginRegistry?: string;
  allowUnsignedPlugins?: boolean;
  disableExternalPlugins?: boolean;
}

export interface ServerHandle {
  port: number;
  close(): Promise<void>;
}
