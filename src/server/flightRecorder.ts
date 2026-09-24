import type { GraphData, WSMessage } from '../types.js';
import { RECORDABLE_TYPES, type Recording, type RecordingFrame } from '../core/recording.js';

export const FLIGHT_RECORDER_WINDOW_MS = 15 * 60 * 1000;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_FRAMES = 50_000;

interface CapturedFrame {
  time: number;
  payload: Buffer;
}

interface Segment {
  frames: CapturedFrame[];
  bytes: number;
}

/**
 * Every segment starts with a graph snapshot. Evict whole segments so an
 * exported clip always has a baseline, even when a size limit shortens it.
 * Buffers detach captured data from provider mutations and bound payload memory.
 */
export class FlightRecorder {
  private segments: Segment[] = [];
  private bytes = 0;
  private frames = 0;

  constructor(
    private readonly appVersion: string,
    private readonly options: {
      now?: () => number;
      windowMs?: number;
      maxBytes?: number;
      maxFrames?: number;
    } = {},
  ) {}

  capture(message: WSMessage): void {
    const now = this.now();
    this.prune(now);
    if (!RECORDABLE_TYPES.has(message.type)) {
      return;
    }
    if (message.type === 'graph') {
      this.segments.push({ frames: [], bytes: 0 });
    }
    const segment = this.segments.at(-1);
    if (!segment) {
      return;
    }
    const payload = Buffer.from(JSON.stringify(message));
    segment.frames.push({ time: now, payload });
    segment.bytes += payload.length;
    this.bytes += payload.length;
    this.frames++;
    this.prune(now);
  }

  export(): Recording | null {
    const now = this.now();
    this.prune(now);
    const first = this.segments[0]?.frames[0];
    if (!first) {
      return null;
    }
    const initialGraph = (JSON.parse(first.payload.toString()) as WSMessage).data as GraphData;
    const frames: RecordingFrame[] = [];
    for (const segment of this.segments) {
      for (const frame of segment.frames) {
        if (frame !== first) {
          frames.push({
            t: frame.time - first.time,
            msg: JSON.parse(frame.payload.toString()) as WSMessage,
          });
        }
      }
    }
    return {
      version: 1,
      app: 'dockscope',
      appVersion: this.appVersion,
      startedAt: first.time,
      duration: Math.max(0, now - first.time),
      initialGraph,
      frames,
    };
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private prune(now: number): void {
    const cutoff = now - (this.options.windowMs ?? FLIGHT_RECORDER_WINDOW_MS);
    while (this.segments.length) {
      const first = this.segments[0];
      if (
        first.frames[0]?.time >= cutoff &&
        this.bytes <= (this.options.maxBytes ?? MAX_BYTES) &&
        this.frames <= (this.options.maxFrames ?? MAX_FRAMES)
      ) {
        break;
      }
      this.segments.shift();
      this.bytes -= first.bytes;
      this.frames -= first.frames.length;
    }
  }
}
