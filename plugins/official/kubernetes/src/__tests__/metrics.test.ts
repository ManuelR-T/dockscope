import { describe, expect, it, vi } from 'vitest';
import type { Metrics, PodMetric } from '@kubernetes/client-node';
import type { KubeClient } from '../client';
import {
  PodMetricsCache,
  parseCpu,
  parseMemory,
  podMemoryLimit,
  sumPodUsage,
} from '../resources/metrics';

/**
 * Kubernetes hands back suffixed quantity strings, and the stats endpoint is
 * polled per pod every few seconds, so the two things worth pinning down are
 * the unit parsing and the fact that a sweep costs one request, not one per
 * pod.
 */

describe('parseCpu', () => {
  it.each([
    ['250m', 0.25],
    ['1', 1],
    ['2500m', 2.5],
    ['123456789n', 0.123456789],
    ['1500u', 0.0015],
    ['0', 0],
  ])('reads %s as %s cores', (quantity, cores) => {
    expect(parseCpu(quantity)).toBeCloseTo(cores, 9);
  });

  it.each([undefined, '', 'abc', '12x'])('returns 0 for the unparseable %s', (quantity) => {
    expect(parseCpu(quantity)).toBe(0);
  });
});

describe('parseMemory', () => {
  it.each([
    ['128Mi', 128 * 1024 * 1024],
    ['1Gi', 1024 ** 3],
    ['512Ki', 512 * 1024],
    ['1000000', 1000000],
    ['100M', 100e6],
  ])('reads %s as %s bytes', (quantity, bytes) => {
    expect(parseMemory(quantity)).toBe(bytes);
  });

  it.each([undefined, '', 'lots'])('returns 0 for the unparseable %s', (quantity) => {
    expect(parseMemory(quantity)).toBe(0);
  });
});

describe('sumPodUsage', () => {
  it('adds every container in the pod', () => {
    const metric = {
      metadata: { namespace: 'default', name: 'web' },
      containers: [
        { name: 'app', usage: { cpu: '100m', memory: '64Mi' } },
        { name: 'sidecar', usage: { cpu: '50m', memory: '32Mi' } },
      ],
    } as unknown as PodMetric;

    const usage = sumPodUsage(metric);
    expect(usage.cores).toBeCloseTo(0.15, 9);
    expect(usage.memoryBytes).toBe(96 * 1024 * 1024);
  });
});

describe('podMemoryLimit', () => {
  it('sums the container limits', () => {
    expect(
      podMemoryLimit({
        spec: {
          containers: [
            { resources: { limits: { memory: '64Mi' } } },
            { resources: { limits: { memory: '64Mi' } } },
          ],
        },
      }),
    ).toBe(128 * 1024 * 1024);
  });

  // A single unbounded container means the pod as a whole can grow without a
  // ceiling, so reporting the partial sum would invent a limit that is not real.
  it('reports no limit when any container is unbounded', () => {
    expect(
      podMemoryLimit({
        spec: {
          containers: [{ resources: { limits: { memory: '64Mi' } } }, { resources: {} }],
        },
      }),
    ).toBe(0);
  });

  it('reports no limit for a pod with no containers', () => {
    expect(podMemoryLimit({ spec: { containers: [] } })).toBe(0);
  });
});

function fixture() {
  const getPodMetrics = vi.fn(async () => ({
    items: [
      {
        metadata: { namespace: 'default', name: 'web' },
        containers: [{ name: 'app', usage: { cpu: '250m', memory: '64Mi' } }],
      },
      {
        metadata: { namespace: 'default', name: 'busy' },
        containers: [{ name: 'app', usage: { cpu: '2', memory: '1Gi' } }],
      },
    ],
  }));

  const listPodForAllNamespaces = vi.fn(async () => ({
    items: [
      {
        metadata: { namespace: 'default', name: 'web' },
        spec: { containers: [{ resources: { limits: { memory: '128Mi' } } }] },
      },
      {
        metadata: { namespace: 'default', name: 'busy' },
        spec: { containers: [{ resources: {} }] },
      },
    ],
  }));

  const client = { coreApi: { listPodForAllNamespaces } } as unknown as KubeClient;
  const metrics = { getPodMetrics } as unknown as Metrics;
  return { client, metrics, getPodMetrics, listPodForAllNamespaces };
}

describe('PodMetricsCache', () => {
  it('reports CPU as percent of one core, matching the Docker source', async () => {
    const { client, metrics } = fixture();
    const cache = new PodMetricsCache(client, metrics);

    expect(await cache.statsFor('default', 'web')).toMatchObject({
      cpu: 25,
      memory: 64 * 1024 * 1024,
      memoryLimit: 128 * 1024 * 1024,
    });

    // Two full cores reads as 200%, the way `docker stats` reports it.
    expect(await cache.statsFor('default', 'busy')).toMatchObject({ cpu: 200 });
  });

  it('reports no memory limit when the pod sets none', async () => {
    const { client, metrics } = fixture();
    const cache = new PodMetricsCache(client, metrics);
    expect((await cache.statsFor('default', 'busy')).memoryLimit).toBe(0);
  });

  it('leaves network counters at zero, which metrics-server does not report', async () => {
    const { client, metrics } = fixture();
    const cache = new PodMetricsCache(client, metrics);
    expect(await cache.statsFor('default', 'web')).toMatchObject({
      networkRx: 0,
      networkTx: 0,
      networkRxRate: 0,
      networkTxRate: 0,
    });
  });

  // The monitor asks for stats per node every few seconds; without sharing,
  // a 200-pod cluster would issue 200 metrics requests per tick.
  it('serves a whole sweep of pods from one cluster-wide fetch', async () => {
    const { client, metrics, getPodMetrics, listPodForAllNamespaces } = fixture();
    const cache = new PodMetricsCache(client, metrics);

    await Promise.all([
      cache.statsFor('default', 'web'),
      cache.statsFor('default', 'busy'),
      cache.statsFor('default', 'web'),
    ]);

    expect(getPodMetrics).toHaveBeenCalledTimes(1);
    expect(listPodForAllNamespaces).toHaveBeenCalledTimes(1);
  });

  it('refetches once the snapshot goes stale', async () => {
    const { client, metrics, getPodMetrics } = fixture();
    let now = 1000;
    const cache = new PodMetricsCache(client, metrics, 2500, () => now);

    await cache.statsFor('default', 'web');
    now += 1000;
    await cache.statsFor('default', 'web');
    expect(getPodMetrics).toHaveBeenCalledTimes(1);

    now += 2000;
    await cache.statsFor('default', 'web');
    expect(getPodMetrics).toHaveBeenCalledTimes(2);
  });

  it('explains that metrics-server is missing rather than leaking a 404', async () => {
    const client = {
      coreApi: { listPodForAllNamespaces: vi.fn(async () => ({ items: [] })) },
    } as unknown as KubeClient;
    const metrics = {
      getPodMetrics: vi.fn(async () => {
        throw new Error('HTTP-Code: 404');
      }),
    } as unknown as Metrics;

    await expect(new PodMetricsCache(client, metrics).statsFor('default', 'web')).rejects.toThrow(
      /metrics-server/,
    );
  });

  it('retries after a failed fetch instead of caching the failure', async () => {
    const getPodMetrics = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({
        items: [
          {
            metadata: { namespace: 'default', name: 'web' },
            containers: [{ name: 'app', usage: { cpu: '100m', memory: '8Mi' } }],
          },
        ],
      });
    const client = {
      coreApi: { listPodForAllNamespaces: vi.fn(async () => ({ items: [] })) },
    } as unknown as KubeClient;
    const cache = new PodMetricsCache(client, { getPodMetrics } as unknown as Metrics);

    await expect(cache.statsFor('default', 'web')).rejects.toThrow();
    expect((await cache.statsFor('default', 'web')).cpu).toBe(10);
  });

  it('reports a pod that metrics-server has no sample for', async () => {
    const { client, metrics } = fixture();
    const cache = new PodMetricsCache(client, metrics);
    await expect(cache.statsFor('default', 'ghost')).rejects.toThrow('default/ghost');
  });
});
