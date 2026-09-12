import type { GraphData, ServiceLink, ServiceNode, WSMessage } from '../../types';
import { endpointId } from './graphLinks';

/** A single captured WebSocket message, timestamped relative to recording start */
export interface RecordingFrame {
  t: number;
  msg: WSMessage;
}

/** Serializable session recording — graph state, events and metrics over time */
export interface Recording {
  version: 1;
  app: 'dockscope';
  appVersion: string;
  startedAt: number;
  duration: number;
  initialGraph: GraphData;
  frames: RecordingFrame[];
}

/** Message types worth capturing (log_chunk is per-subscription and too heavy) */
export const RECORDABLE_TYPES: ReadonlySet<string> = new Set([
  'graph',
  'stats',
  'event',
  'anomaly',
  'diagnostic',
]);

export const MAX_RECORDING_FRAMES = 50_000;

export const REPLAY_SPEEDS = [1, 2, 4, 8] as const;

/** Strip d3/Three.js runtime fields (x, y, z, __threeObj, ...) which are cyclic */
export function sanitizeNode(node: ServiceNode): ServiceNode {
  const clean: ServiceNode = {
    id: node.id,
    name: node.name,
    fullName: node.fullName,
    project: node.project,
    host: node.host,
    containerId: node.containerId,
    image: node.image,
    status: node.status,
    health: node.health,
    ports: [...node.ports],
    networks: [...node.networks],
    volumeCount: node.volumeCount,
    cpu: node.cpu,
    memory: node.memory,
    memoryLimit: node.memoryLimit,
    networkRx: node.networkRx,
    networkTx: node.networkTx,
    networkRxRate: node.networkRxRate,
    networkTxRate: node.networkTxRate,
  };
  if (node.runtime !== undefined) {
    clean.runtime = node.runtime;
  }
  if (node.kind !== undefined) {
    clean.kind = node.kind;
  }
  if (node.namespace !== undefined) {
    clean.namespace = node.namespace;
  }
  if (node.entityId !== undefined) {
    clean.entityId = node.entityId;
  }
  if (node.sourceId !== undefined) {
    clean.sourceId = node.sourceId;
  }
  if (node.entityStatus !== undefined) {
    clean.entityStatus = node.entityStatus;
  }
  if (node.metrics !== undefined) {
    clean.metrics = node.metrics.map((metric) => ({ ...metric }));
  }
  if (node.metadata !== undefined) {
    clean.metadata = { ...node.metadata };
  }
  return clean;
}

/** The force graph replaces link endpoints with node object references — restore plain IDs */
export function sanitizeLink(link: ServiceLink): ServiceLink {
  const clean: ServiceLink = {
    source: endpointId(link.source),
    target: endpointId(link.target),
    type: link.type,
  };
  if (link.label !== undefined) {
    clean.label = link.label;
  }
  return clean;
}

export function sanitizeGraph(graph: GraphData): GraphData {
  return {
    nodes: graph.nodes.map(sanitizeNode),
    links: graph.links.map(sanitizeLink),
  };
}

function isValidFrame(frame: unknown): frame is RecordingFrame {
  if (!frame || typeof frame !== 'object') {
    return false;
  }
  const f = frame as Record<string, unknown>;
  if (typeof f.t !== 'number' || !Number.isFinite(f.t) || f.t < 0) {
    return false;
  }
  const msg = f.msg as Record<string, unknown> | undefined;
  return Boolean(msg && typeof msg === 'object' && typeof msg.type === 'string' && 'data' in msg);
}

/** Parse and normalize a recording loaded from a file. Returns null if unusable. */
export function validateRecording(raw: unknown): Recording | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  if (rec.version !== 1 || rec.app !== 'dockscope') {
    return null;
  }
  const graph = rec.initialGraph as Record<string, unknown> | undefined;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    return null;
  }
  if (!Array.isArray(rec.frames)) {
    return null;
  }

  const frames = (rec.frames as unknown[])
    .filter(isValidFrame)
    .filter((frame) => RECORDABLE_TYPES.has(frame.msg.type))
    .sort((a, b) => a.t - b.t);

  const lastT = frames.length > 0 ? frames[frames.length - 1].t : 0;
  const duration =
    typeof rec.duration === 'number' && Number.isFinite(rec.duration)
      ? Math.max(rec.duration, lastT)
      : lastT;

  return {
    version: 1,
    app: 'dockscope',
    appVersion: typeof rec.appVersion === 'string' ? rec.appVersion : 'unknown',
    startedAt: typeof rec.startedAt === 'number' ? rec.startedAt : 0,
    duration,
    initialGraph: rec.initialGraph as GraphData,
    frames,
  };
}

/** Format a millisecond offset as m:ss for the replay timeline */
export function formatClock(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function recordingFilename(startedAt: number): string {
  const d = new Date(startedAt);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `dockscope-recording-${stamp}.json`;
}
