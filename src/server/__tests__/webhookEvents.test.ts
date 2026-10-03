import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNode, CrashDiagnostic } from '../../types';
import type { GraphSourceAdapter, SourceEvent } from '../../core/sources/model';
import type { PluginRegistry } from '../../core/plugin-contract/registry';
import { createServerMonitor, type ServerMonitor } from '../monitor';
import { MetricHistory } from '../metricHistory';
import type { WebhookAlert } from '../webhookEvents';

const node: ServiceNode = {
  id: 'abc',
  containerId: 'abc-full',
  entityId: 'abc-full',
  sourceId: 'east',
  host: 'east',
  name: 'web',
  fullName: 'web',
  project: 'prod',
  status: 'running',
  health: 'healthy',
  image: 'web:latest',
  ports: [],
  networks: [],
  volumeCount: 0,
  cpu: 0,
  memory: 0,
  memoryLimit: 100,
  networkRx: 0,
  networkTx: 0,
  networkRxRate: 0,
  networkTxRate: 0,
};
let monitor: ServerMonitor | undefined;
afterEach(() => {
  monitor?.stop();
  vi.useRealTimers();
});
async function setup() {
  vi.useFakeTimers();
  let nodes = [{ ...node }];
  let unavailable = false;
  let callback: ((event: SourceEvent) => void) | undefined;
  const descriptor = {
    id: 'east',
    label: 'East host',
    kind: 'docker' as const,
    pluginId: 'test',
    capabilities: [],
    status: 'connected' as const,
  };
  const source: GraphSourceAdapter = {
    describe: () => descriptor,
    collectGraph: async () => {
      if (unavailable) {
        throw new Error('offline');
      }
      return { source: descriptor, collectedAt: Date.now(), graph: { nodes, links: [] } };
    },
    startEvents: (cb) => {
      callback = cb;
      return () => {};
    },
  };
  const analyzeMetric = vi.fn().mockResolvedValue([]);
  const diagnose = vi.fn().mockResolvedValue(null);
  const plugins = {
    getGraphSources: () => [source],
    refreshConnections: async () => {},
    getStats: async () => ({ cpu: 90, memory: 80, memoryLimit: 100 }),
    analyzeMetric,
    diagnose,
  } as unknown as PluginRegistry;
  const alerts: WebhookAlert[] = [];
  monitor = createServerMonitor({
    plugins,
    metricHistory: new MetricHistory('/unused'),
    broadcast: () => {},
    alert: (alert) => alerts.push(alert),
  });
  await monitor.start();
  return {
    alerts,
    analyzeMetric,
    diagnose,
    nodes: (next: ServiceNode[]) => {
      nodes = next;
    },
    offline: (value: boolean) => {
      unavailable = value;
    },
    event: (action: string, extra: Partial<SourceEvent['event']> = {}) =>
      callback!({
        source: descriptor,
        receivedAt: Date.now(),
        event: {
          id: 'abc',
          containerId: 'abc-full',
          type: 'container',
          action,
          actor: 'web',
          time: Date.now() / 1000,
          message: action,
          ...extra,
        },
      }),
  };
}

describe('monitor webhook signals', () => {
  it('does not invent startup/lifecycle events or deletions during outages, and retains health until reconnection', async () => {
    const s = await setup();
    expect(s.alerts).toEqual([]);
    s.nodes([{ ...node, health: 'unhealthy' }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.alerts.map((a) => a.eventType)).toEqual(['health.unhealthy']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.alerts).toHaveLength(1);
    s.offline(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.alerts.map((a) => a.eventType)).toEqual(['health.unhealthy', 'source.disconnected']);
    s.offline(false);
    s.nodes([{ ...node, health: 'healthy' }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.alerts.map((a) => a.eventType)).toEqual([
      'health.unhealthy',
      'source.disconnected',
      'source.reconnected',
      'health.healthy',
    ]);
    s.nodes([]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.alerts.filter((a) => a.family === 'lifecycle')).toHaveLength(0);
  });
  it('emits anomaly recovery once, without treating missing stats as recovery', async () => {
    const s = await setup();
    s.analyzeMetric.mockImplementation(async ({ metric }) =>
      metric === 'cpu' ? [{ pluginId: 'test', average: 10, threshold: 70 }] : [],
    );
    await vi.advanceTimersByTimeAsync(6000);
    expect(s.alerts.map((a) => a.eventType)).toEqual(['anomaly.cpu']);
    s.offline(true);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(s.alerts.some((a) => a.family === 'recovery')).toBe(false);
    s.offline(false);
    await vi.advanceTimersByTimeAsync(13_000);
    expect(s.alerts.filter((a) => a.eventType === 'anomaly.cpu')).toHaveLength(1);
    s.analyzeMetric.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(6000);
    const recoveries = s.alerts.filter((a) => a.family === 'recovery');
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]).toMatchObject({
      eventType: 'anomaly.cpu.recovered',
      sourceId: 'east',
      workload: { entityId: 'abc-full', project: 'prod' },
      data: { metric: 'cpu', value: 90, analyzerId: 'test' },
    });
  });
  it('correlates die/stop even with slow diagnostics and only reports explicit restarts', async () => {
    const s = await setup();
    let resolve!: (value: CrashDiagnostic) => void;
    s.diagnose.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    s.event('die');
    s.event('stop');
    await vi.advanceTimersByTimeAsync(8000);
    expect(s.alerts).toHaveLength(0);
    expect(s.diagnose).toHaveBeenCalledOnce();
    resolve({
      containerId: 'abc-full',
      containerName: 'web',
      exitCode: 1,
      oomKilled: false,
      cause: 'Error',
      details: [],
      logSnippet: [],
      time: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(s.alerts.map((a) => a.eventType)).toEqual(['crash', 'lifecycle.stopped']);
    expect(s.alerts[1]).toMatchObject({ data: { crash: true } });
    s.event('start');
    s.event('restart');
    s.event('create', { type: 'image' });
    expect(s.alerts.map((a) => a.eventType)).toEqual([
      'crash',
      'lifecycle.stopped',
      'lifecycle.started',
      'lifecycle.restarted',
    ]);
  });
  it('includes source and project identity for new workloads before their first graph snapshot', async () => {
    const s = await setup();
    s.event('create', { id: 'new', containerId: 'new-full', actor: 'new-web', project: 'prod' });
    expect(s.alerts[0]).toMatchObject({
      eventType: 'lifecycle.created',
      sourceId: 'east',
      workload: { entityId: 'new-full', project: 'prod', name: 'new-web' },
    });
  });
});

it('reports an ordinary stop after diagnosis times out and ignores late results', async () => {
  const s = await setup();
  let resolve!: (value: CrashDiagnostic) => void;
  s.diagnose.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  s.event('die');
  await vi.advanceTimersByTimeAsync(30_000);
  expect(s.alerts).toHaveLength(1);
  expect(s.alerts[0]).toMatchObject({ eventType: 'lifecycle.stopped', data: { crash: false } });
  resolve({
    containerId: 'abc-full',
    containerName: 'web',
    exitCode: 1,
    oomKilled: false,
    cause: 'Error',
    details: [],
    logSnippet: [],
    time: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(s.alerts).toHaveLength(1);
});
