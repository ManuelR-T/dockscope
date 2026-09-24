import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricHistory, HISTORY_RANGES } from '../metricHistory';

let directory: string;
let now: number;
const ref = { sourceId: 'local', entityId: '123456789abcdef' };
let history: MetricHistory;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'dockscope-metrics-'));
  now = 1_800_000_000_000;
  history = new MetricHistory(path.join(directory, 'history.jsonl'), () => now);
  await history.load();
});
afterEach(async () => {
  await history.close();
  await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const record = (cpu: number, memory = cpu * 1024) =>
  history.record(ref, { cpu, memory, time: now });

describe('MetricHistory', () => {
  it('restores raw samples and weighted minute averages after restart', async () => {
    record(10);
    now += 3000;
    record(30);
    await history.flush();
    const restored = new MetricHistory(path.join(directory, 'history.jsonl'), () => now);
    await restored.load();
    expect(restored.query(ref)).toEqual(history.query(ref));
    expect(restored.query(ref, '24h')).toEqual([{ cpu: 20, memory: 20 * 1024, time: now - 3000 }]);
    restored.record(ref, { cpu: 50, memory: 50 * 1024, time: now });
    expect(restored.query(ref, '1h')[0].cpu).toBe(30);
  });
  it('isolates sources and supports unambiguous legacy Docker IDs', () => {
    record(10);
    history.record({ ...ref, sourceId: 'remote' }, { cpu: 90, memory: 1, time: now });
    expect(history.query({ entityId: '123456789abc' })[0].cpu).toBe(10);
    expect(history.query({ entityId: '123456789abc', sourceId: 'remote' })[0].cpu).toBe(90);
    expect(history.query({ ...ref, sourceId: 'missing' })).toEqual([]);
    history.record({ ...ref, entityId: '123456789abc000' }, { cpu: 50, memory: 1, time: now });
    expect(history.query({ entityId: '123456789abc' })).toEqual([]);
  });
  it('retains old workloads until time expiry and selects the requested range', async () => {
    record(10);
    now += 2 * 60 * 60_000;
    record(20);
    expect(history.query(ref)).toHaveLength(1);
    expect(history.query(ref, '1h')).toHaveLength(1);
    expect(history.query(ref, '24h')).toHaveLength(2);
    now += HISTORY_RANGES['24h'] + 60_000;
    await history.flush();
    expect(history.query(ref, '24h')).toEqual([]);
    expect(await readFile(path.join(directory, 'history.jsonl'), 'utf8')).toBe('');
  });
  it('bounds raw samples, rejects invalid points, and returns detached values', () => {
    for (let i = 0; i < 120; i++) {
      record(i);
      now += 1000;
    }
    record(NaN);
    expect(history.query(ref)).toHaveLength(100);
    const points = history.query(ref);
    points[0].cpu = -100;
    expect(history.query(ref)[0].cpu).toBe(20);
  });
  it('keeps only the 512 most recently sampled workloads', () => {
    for (let i = 0; i < 513; i++) {
      history.record({ entityId: `entity-${i}` }, { cpu: i, memory: 1, time: now });
    }
    expect(history.query({ entityId: 'entity-0' })).toEqual([]);
    expect(history.query({ entityId: 'entity-512' })).toHaveLength(1);
  });
  it('recovers valid JSONL records around a damaged record', async () => {
    record(10);
    await history.flush();
    const file = path.join(directory, 'history.jsonl');
    await writeFile(file, `broken\n${await readFile(file, 'utf8')}\n`);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restored = new MetricHistory(file, () => now);
    await restored.load();
    expect(restored.query(ref)).toEqual(history.query(ref));
  });
  it('preserves live data when persistence fails', async () => {
    const blocker = path.join(directory, 'not-a-directory');
    await writeFile(blocker, 'file');
    const failed = new MetricHistory(path.join(blocker, 'history.jsonl'), () => now);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failed.record(ref, { cpu: 10, memory: 1, time: now });
    await failed.flush();
    await failed.flush();
    expect(failed.query(ref)).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('flushes the final samples on shutdown', async () => {
    record(45);
    await history.close();
    const restored = new MetricHistory(path.join(directory, 'history.jsonl'), () => now);
    await restored.load();
    expect(restored.query(ref)[0].cpu).toBe(45);
  });
});
