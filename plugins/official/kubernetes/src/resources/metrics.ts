import { Metrics, PodMetric, V1Pod } from '@kubernetes/client-node';
import { KubeClient } from '../client';

/**
 * Kubernetes reports quantities as suffixed strings rather than numbers.
 * CPU arrives as nanocores ("123456789n"), microcores ("1234u"), millicores
 * ("250m") or whole cores ("2"); memory as binary ("128Mi") or decimal ("128M")
 * multiples, or plain bytes.
 */
const CPU_SCALE: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
};

const MEMORY_SCALE: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

/** CPU quantity to cores. Returns 0 for anything unparseable. */
export function parseCpu(quantity: string | undefined): number {
  if (!quantity) {
    return 0;
  }
  const match = /^([0-9.]+)([a-zA-Z]*)$/.exec(quantity.trim());
  if (!match) {
    return 0;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return 0;
  }
  const suffix = match[2] || '';
  return suffix ? value * (CPU_SCALE[suffix] ?? 0) : value;
}

/** Memory quantity to bytes. Returns 0 for anything unparseable. */
export function parseMemory(quantity: string | undefined): number {
  if (!quantity) {
    return 0;
  }
  const match = /^([0-9.]+)([a-zA-Z]*)$/.exec(quantity.trim());
  if (!match) {
    return 0;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return 0;
  }
  const suffix = match[2] || '';
  return suffix ? value * (MEMORY_SCALE[suffix] ?? 0) : value;
}

/** A pod's usage summed across its containers. */
export function sumPodUsage(metric: PodMetric): { cores: number; memoryBytes: number } {
  return metric.containers.reduce(
    (total, container) => ({
      cores: total.cores + parseCpu(container.usage?.cpu),
      memoryBytes: total.memoryBytes + parseMemory(container.usage?.memory),
    }),
    { cores: 0, memoryBytes: 0 },
  );
}

/** A pod's configured memory ceiling, summed across containers. 0 when unset. */
export function podMemoryLimit(pod: V1Pod): number {
  const containers = pod.spec?.containers || [];
  let total = 0;
  for (const container of containers) {
    const limit = parseMemory(container.resources?.limits?.['memory']);
    // One container without a ceiling means the pod as a whole has none.
    if (limit === 0) {
      return 0;
    }
    total += limit;
  }
  return containers.length > 0 ? total : 0;
}

function key(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

interface Snapshot {
  usage: Map<string, { cores: number; memoryBytes: number }>;
  memoryLimits: Map<string, number>;
}

/**
 * One cluster-wide fetch shared by every pod in a polling tick.
 *
 * DockScope asks for stats per node every few seconds, so a naive provider
 * would issue one metrics request per pod per tick. Both the metrics list and
 * the pod list are whole-cluster calls, so this caches a single snapshot just
 * long enough to cover one sweep, and collapses concurrent callers onto the
 * same in-flight request.
 */
export class PodMetricsCache {
  private snapshot: { at: number; data: Snapshot } | null = null;
  private inFlight: Promise<Snapshot> | null = null;

  constructor(
    private readonly client: KubeClient,
    private readonly metrics: Metrics,
    private readonly ttlMs = 2500,
    private readonly now: () => number = Date.now,
  ) {}

  private async fetch(): Promise<Snapshot> {
    const [metricsList, pods] = await Promise.all([
      this.metrics.getPodMetrics(),
      this.client.coreApi.listPodForAllNamespaces(),
    ]);

    const usage = new Map<string, { cores: number; memoryBytes: number }>();
    for (const metric of metricsList.items) {
      usage.set(key(metric.metadata.namespace, metric.metadata.name), sumPodUsage(metric));
    }

    const memoryLimits = new Map<string, number>();
    for (const pod of pods.items) {
      memoryLimits.set(
        key(pod.metadata?.namespace || 'default', pod.metadata?.name || ''),
        podMemoryLimit(pod),
      );
    }

    return { usage, memoryLimits };
  }

  private async load(): Promise<Snapshot> {
    const cached = this.snapshot;
    if (cached && this.now() - cached.at < this.ttlMs) {
      return cached.data;
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.fetch()
      .then((data) => {
        this.snapshot = { at: this.now(), data };
        return data;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  async statsFor(namespace: string, name: string) {
    let snapshot: Snapshot;
    try {
      snapshot = await this.load();
    } catch (error) {
      // metrics.k8s.io only exists once metrics-server is installed, and it is
      // not part of a stock cluster. Say so rather than surfacing a raw 404.
      throw new Error(
        'Kubernetes metrics are unavailable. Install metrics-server to see pod CPU and memory.',
        { cause: error },
      );
    }

    const usage = snapshot.usage.get(key(namespace, name));
    if (!usage) {
      throw new Error(`No metrics reported for pod ${namespace}/${name}`);
    }

    return {
      // Percent of a single core, matching how the Docker source reports CPU:
      // a pod burning two full cores reads as 200%.
      cpu: usage.cores * 100,
      memory: usage.memoryBytes,
      memoryLimit: snapshot.memoryLimits.get(key(namespace, name)) ?? 0,
      // metrics-server exposes no per-pod network counters. Reporting zeroes
      // keeps the shape while the sidebar shows an empty network row.
      networkRx: 0,
      networkTx: 0,
      networkRxRate: 0,
      networkTxRate: 0,
    };
  }
}
