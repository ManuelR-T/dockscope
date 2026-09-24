import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { EntityRef } from '../core/entities/operations.js';
import type { MetricPoint } from '../types.js';

export const HISTORY_RANGES = { '5m': 5 * 60_000, '1h': 60 * 60_000, '24h': 24 * 60 * 60_000 };
export type HistoryRange = keyof typeof HISTORY_RANGES;
const MAX_SERIES = 512;
interface Bucket extends MetricPoint {
  count: number;
}
interface Series {
  sourceId: string;
  entityId: string;
  recent: MetricPoint[];
  minutes: Bucket[];
}
function key(ref: Pick<EntityRef, 'sourceId' | 'entityId'>): string {
  return JSON.stringify([ref.sourceId || 'local', ref.entityId]);
}
function validPoint(value: unknown): value is MetricPoint {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const p = value as MetricPoint;
  return [p.cpu, p.memory, p.time].every(
    (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0,
  );
}

/** Bounded per-source history; disk snapshots never block the polling loop. */
export class MetricHistory {
  private series = new Map<string, Series>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private writing: Promise<void> | null = null;
  private stopped = false;
  private warned = false;
  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    try {
      const lines = createInterface({
        input: createReadStream(this.file, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        try {
          const s = JSON.parse(line) as Series;
          if (
            !s ||
            typeof s.sourceId !== 'string' ||
            typeof s.entityId !== 'string' ||
            !Array.isArray(s.recent) ||
            !Array.isArray(s.minutes)
          ) {
            throw new Error('Invalid history record');
          }
          s.recent = s.recent
            .filter(validPoint)
            .sort((a, b) => a.time - b.time)
            .slice(-100);
          s.minutes = s.minutes
            .filter((p) => validPoint(p) && Number.isInteger(p.count) && p.count > 0)
            .sort((a, b) => a.time - b.time)
            .slice(-1441);
          this.series.set(key(s), s);
          while (this.series.size > MAX_SERIES) {
            this.series.delete(this.series.keys().next().value!);
          }
        } catch {
          console.warn('Metric history: skipped an invalid record');
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(
          'Metric history: could not load saved history; continuing with available samples',
        );
      }
    }
    this.prune();
  }

  start(): void {
    this.timer ??= setInterval(() => {
      void this.flush();
    }, 30_000);
  }

  record(ref: EntityRef, point: MetricPoint): void {
    if (this.stopped || !validPoint(point)) {
      return;
    }
    const id = key(ref);
    const s = this.series.get(id) ?? {
      sourceId: ref.sourceId || 'local',
      entityId: ref.entityId,
      recent: [],
      minutes: [],
    };
    const last = s.recent.at(-1);
    // Ignore backwards clock jumps rather than write an out-of-order timeline.
    if (last && point.time < last.time) {
      return;
    }
    s.recent.push({ ...point });
    s.recent = s.recent.filter((p) => p.time >= this.now() - HISTORY_RANGES['5m']).slice(-100);
    const minute = Math.floor(point.time / 60_000) * 60_000;
    const bucket = s.minutes.at(-1);
    if (bucket?.time === minute) {
      bucket.cpu = (bucket.cpu * bucket.count + point.cpu) / (bucket.count + 1);
      bucket.memory = (bucket.memory * bucket.count + point.memory) / (bucket.count + 1);
      bucket.count++;
    } else {
      s.minutes.push({ ...point, time: minute, count: 1 });
    }
    s.minutes = s.minutes.filter((p) => p.time >= this.now() - HISTORY_RANGES['24h']);
    this.series.delete(id);
    this.series.set(id, s);
    while (this.series.size > MAX_SERIES) {
      this.series.delete(this.series.keys().next().value!);
    }
  }

  query(ref: EntityRef, range: HistoryRange = '5m'): MetricPoint[] {
    let s = this.series.get(key(ref));
    // Legacy Docker routes accept short IDs. Never fall back across sources.
    if (!s && /^[a-f0-9]{12,64}$/i.test(ref.entityId)) {
      const matches = [...this.series.values()].filter(
        (candidate) =>
          candidate.sourceId === (ref.sourceId || 'local') &&
          candidate.entityId.startsWith(ref.entityId),
      );
      if (matches.length === 1) {
        s = matches[0];
      }
    }
    const cutoff = this.now() - HISTORY_RANGES[range];
    return (
      (range === '5m' ? s?.recent : s?.minutes)
        ?.filter((p) => p.time >= cutoff && p.time <= this.now())
        .map(({ cpu, memory, time }) => ({ cpu, memory, time })) ?? []
    );
  }

  private prune(): void {
    const now = this.now();
    for (const [id, s] of this.series) {
      s.recent = s.recent
        .filter((p) => p.time >= now - HISTORY_RANGES['5m'] && p.time <= now)
        .slice(-100);
      s.minutes = s.minutes
        .filter((p) => p.time >= now - HISTORY_RANGES['24h'] && p.time <= now)
        .slice(-1441);
      if (!s.recent.length && !s.minutes.length) {
        this.series.delete(id);
      }
    }
    while (this.series.size > MAX_SERIES) {
      this.series.delete(this.series.keys().next().value!);
    }
  }

  flush(): Promise<void> {
    if (this.writing) {
      return this.writing;
    }
    this.prune();
    const data = [...this.series.values()].map((s) => JSON.stringify(s)).join('\n');
    this.writing = (async () => {
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(temporary, data ? `${data}\n` : '', { mode: 0o600 });
        await rename(temporary, this.file);
        this.warned = false;
      } catch {
        if (!this.warned) {
          console.warn('Metric history: could not persist samples; will retry');
        }
        this.warned = true;
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    })().finally(() => {
      this.writing = null;
    });
    return this.writing;
  }

  async close(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.writing;
    await this.flush();
  }
}
