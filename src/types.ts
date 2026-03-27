export interface ServiceNode {
  id: string;
  name: string;
  fullName: string;
  project: string;
  containerId: string;
  image: string;
  status: 'running' | 'exited' | 'paused' | 'restarting' | 'dead' | 'created' | 'removing';
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
  source: string;
  target: string;
  type: 'depends_on' | 'network';
  label?: string;
}

export interface GraphData {
  nodes: ServiceNode[];
  links: ServiceLink[];
}

export interface DockerEvent {
  id: string;
  type: string;
  action: string;
  actor: string;
  time: number;
  message: string;
}

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
  containerId: string;
  text: string;
}

export interface WSMessage {
  type: 'graph' | 'stats' | 'event' | 'error' | 'log_chunk' | 'subscribe_logs' | 'unsubscribe_logs';
  data:
    | GraphData
    | ContainerStats
    | DockerEvent
    | LogChunk
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

export interface ServerOptions {
  port: number;
  open: boolean;
}
