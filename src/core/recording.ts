import type { GraphData, WSMessage } from '../types.js';

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
