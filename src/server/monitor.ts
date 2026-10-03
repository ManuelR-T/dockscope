import { WebhookTransitions, workloadIdentity, type WebhookAlert } from './webhookEvents.js';
import type { MetricHistory } from './metricHistory.js';
import { collectSourceGraphs } from '../core/sources/collect.js';
import type { PluginRegistry } from '../core/plugin-contract/registry.js';
import type { GraphSourceAdapter, SourceEvent } from '../core/sources/model.js';
import type { DockerEvent, GraphData, ServiceNode, WSMessage } from '../types.js';
import { shortId } from '../utils.js';

interface MonitorOptions {
  metricHistory: MetricHistory;
  plugins: PluginRegistry;
  broadcast(msg: WSMessage): void;
  alert?(alert: WebhookAlert): void;
}

export interface ServerMonitor {
  getGraph(): GraphData;
  start(): Promise<void>;
  stop(): void;
}

const GRAPH_REFRESH_ACTIONS = [
  'start',
  'stop',
  'die',
  'destroy',
  'create',
  'pause',
  'unpause',
  'restart',
];
const STATS_CONCURRENCY = 8;
const STATS_TIMEOUT_MS = 2500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Stats timed out')), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(timeout));
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(workers);
}

export function createServerMonitor(opts: MonitorOptions): ServerMonitor {
  let cachedGraph: GraphData = { nodes: [], links: [] };
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let statsInterval: ReturnType<typeof setInterval> | null = null;
  let graphInterval: ReturnType<typeof setInterval> | null = null;
  let connectionStatusInterval: ReturnType<typeof setInterval> | null = null;
  const eventWatchers = new Map<string, () => void>();
  let statsRefreshInFlight = false;
  let graphRefreshInFlight = false;
  const emitAlert = (alert: WebhookAlert) => {
    if (!stopped) {
      opts.alert?.(alert);
    }
  };
  const transitions = new WebhookTransitions(emitAlert);
  const activeAnomalies = new Map<string, Set<string>>();
  const terminations = new Map<string, number>();
  let stopped = false;
  const anomalySources = new Map<string, string>();

  const refreshGraph = async () => {
    if (graphRefreshInFlight || stopped) {
      return;
    }
    graphRefreshInFlight = true;
    try {
      const collection = await collectSourceGraphs(opts.plugins.getGraphSources(), {
        timeoutMs: 5000,
      });
      if (stopped) {
        return;
      }
      transitions.observe(collection);
      cachedGraph = collection.graph;
      opts.broadcast({ type: 'graph', data: cachedGraph });
      const activeIds = new Set(cachedGraph.nodes.map((n) => n.id));
      const failedSources = new Set(collection.errors.map((e) => e.source.id));
      for (const id of activeAnomalies.keys()) {
        if (!activeIds.has(id) && !failedSources.has(anomalySources.get(id) ?? 'local')) {
          activeAnomalies.delete(id);
          anomalySources.delete(id);
        }
      }
    } catch {
      /* Docker may be temporarily unavailable */
    } finally {
      graphRefreshInFlight = false;
    }
  };

  async function detectAndBroadcastAnomaly(
    node: ServiceNode,
    metric: 'cpu' | 'memory',
    value: number,
    history: number[],
  ): Promise<void> {
    const findings = await opts.plugins.analyzeMetric({
      ref: {
        entityId: node.containerId,
        sourceId: node.host,
        nodeId: node.id,
        context: {
          nodeId: node.id,
          name: node.name,
          runtime: node.runtime,
          kind: node.kind,
          status: node.status,
          health: node.health,
          metadata: node.metadata,
        },
      },
      metric,
      value,
      history,
    });
    if (!activeAnomalies.has(node.id)) {
      activeAnomalies.set(node.id, new Set());
    }
    anomalySources.set(node.id, node.sourceId || node.host || 'local');
    const active = activeAnomalies.get(node.id)!;
    const findingKeys = new Set(findings.map((finding) => `${finding.pluginId}:${metric}`));
    for (const key of [...active]) {
      if (key.endsWith(`:${metric}`) && !findingKeys.has(key)) {
        active.delete(key);
        emitAlert({
          ...workloadIdentity(node),
          family: 'recovery',
          eventType: `anomaly.${metric}.recovered`,
          type: 'transition',
          time: Date.now(),
          data: {
            message: `${node.name}: ${metric.toUpperCase()} anomaly cleared`,
            metric,
            value,
            analyzerId: key.slice(0, -(metric.length + 1)),
          },
        });
      }
    }
    for (const finding of findings) {
      const key = `${finding.pluginId}:${metric}`;
      if (active.has(key)) {
        continue;
      }
      active.add(key);
      const message = {
        type: 'anomaly' as const,
        data: {
          analyzerId: finding.pluginId,
          containerId: node.id,
          containerName: node.name,
          metric,
          value,
          average: finding.average,
          threshold: finding.threshold,
          time: Date.now(),
        },
      };
      opts.broadcast(message);
      emitAlert({
        ...message,
        ...workloadIdentity(node),
        family: metric,
        eventType: `anomaly.${metric}`,
        time: message.data.time,
      });
    }
  }

  const refreshStats = async () => {
    if (statsRefreshInFlight) {
      return;
    }

    statsRefreshInFlight = true;
    try {
      const nodes = cachedGraph.nodes.filter((node) => node.status === 'running');
      await runWithConcurrency(nodes, STATS_CONCURRENCY, async (node) => {
        try {
          const stats = await withTimeout(
            opts.plugins.getStats({
              entityId: node.containerId,
              sourceId: node.host || 'local',
              nodeId: node.id,
              context: {
                nodeId: node.id,
                name: node.name,
                runtime: node.runtime,
                kind: node.kind,
                status: node.status,
                health: node.health,
                metadata: node.metadata,
              },
            }),
            STATS_TIMEOUT_MS,
          );
          const nodeStats = { ...stats, id: node.id };
          opts.broadcast({ type: 'stats', data: nodeStats });

          const historyRef = {
            entityId: node.entityId ?? node.containerId,
            sourceId: node.sourceId ?? node.host ?? 'local',
          };
          opts.metricHistory.record(historyRef, {
            cpu: stats.cpu,
            memory: stats.memory,
            time: Date.now(),
          });
          const history = opts.metricHistory.query(historyRef);

          await detectAndBroadcastAnomaly(
            node,
            'cpu',
            stats.cpu,
            history.map((h) => h.cpu),
          );

          const hasMemLimit = stats.memoryLimit > 0;
          if (hasMemLimit) {
            const memPct = (stats.memory / stats.memoryLimit) * 100;
            await detectAndBroadcastAnomaly(
              node,
              'memory',
              memPct,
              history.map((h) => (h.memory / stats.memoryLimit) * 100),
            );
          }
        } catch {
          /* Container may have stopped */
        }
      });
    } finally {
      statsRefreshInFlight = false;
    }
  };

  function findEventNode(event: DockerEvent): ServiceNode | undefined {
    const rawId = event.entityId || event.containerId || event.id;
    const sourceId = event.sourceId || event.host;
    const sid = shortId(rawId.includes(':') ? rawId.split(':').at(-1) || rawId : rawId);
    const direct = cachedGraph.nodes.find(
      (node) => node.id === event.id && (!sourceId || (node.sourceId || node.host) === sourceId),
    );
    if (direct) {
      return direct;
    }
    const candidates = cachedGraph.nodes.filter(
      (node) =>
        (!sourceId || (node.sourceId || node.host) === sourceId) &&
        (node.containerId === rawId || shortId(node.containerId) === sid),
    );
    return candidates.find((node) => node.host === 'local') || candidates[0];
  }

  function syncEventWatchers() {
    const sourceEntries = opts.plugins
      .getGraphSources()
      .filter(
        (
          source,
        ): source is GraphSourceAdapter & Required<Pick<GraphSourceAdapter, 'startEvents'>> =>
          Boolean(source.startEvents),
      )
      .map((source) => ({ source, descriptor: source.describe() }));
    const activeSourceIds = new Set(sourceEntries.map((entry) => entry.descriptor.id));

    for (const [sourceId, stop] of eventWatchers) {
      const entry = sourceEntries.find((item) => item.descriptor.id === sourceId);
      if (!entry || entry.descriptor.status !== 'connected') {
        stop();
        eventWatchers.delete(sourceId);
      }
    }

    for (const { source, descriptor } of sourceEntries) {
      if (descriptor.status !== 'connected' || eventWatchers.has(descriptor.id)) {
        continue;
      }

      let stopWatching: (() => void) | null = null;
      const forgetWatcher = () => {
        if (stopWatching && eventWatchers.get(descriptor.id) === stopWatching) {
          eventWatchers.delete(descriptor.id);
        }
      };

      stopWatching = source.startEvents(
        handleSourceEvent,
        (err) => {
          console.error(`Source event stream error (${descriptor.id}):`, err.message);
          forgetWatcher();
        },
        forgetWatcher,
      );
      eventWatchers.set(descriptor.id, stopWatching);
    }

    for (const sourceId of eventWatchers.keys()) {
      if (!activeSourceIds.has(sourceId)) {
        eventWatchers.get(sourceId)?.();
        eventWatchers.delete(sourceId);
      }
    }
  }

  function debouncedRefreshGraph() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshGraph();
    }, 500);
  }

  const handleSourceEvent = (sourceEvent: SourceEvent) => {
    const event: DockerEvent = {
      ...sourceEvent.event,
      sourceId: sourceEvent.event.sourceId || sourceEvent.source.id,
      host: sourceEvent.event.host || sourceEvent.source.id,
    };
    const node = findEventNode(event);
    const graphEvent = {
      ...event,
      id: node?.id || event.id,
    };
    opts.broadcast({ type: 'event', data: graphEvent });
    if (GRAPH_REFRESH_ACTIONS.includes(event.action)) {
      debouncedRefreshGraph();
    }
    const identity = node
      ? workloadIdentity(node)
      : {
          sourceId: event.sourceId || sourceEvent.source.id,
          workload: {
            entityId: event.entityId || event.containerId || event.id,
            name: event.actor,
            project: event.project || '',
          },
        };
    const lifecycle: Record<string, string> = {
      create: 'created',
      start: 'started',
      stop: 'stopped',
      restart: 'restarted',
      pause: 'paused',
      unpause: 'resumed',
      destroy: 'removed',
    };
    const emitLifecycle = (action: string, crash = false) => {
      emitAlert({
        ...identity,
        family: 'lifecycle',
        type: 'transition',
        eventType: `lifecycle.${action}`,
        time: event.time * 1000,
        data: {
          message: `${identity.workload?.name || event.actor} ${action}`,
          current: action,
          crash,
        },
      });
    };
    const terminalKey = JSON.stringify([identity.sourceId, identity.workload?.entityId]);
    if (event.action === 'start' || event.action === 'create') {
      terminations.delete(terminalKey);
    }
    if (event.type === 'container' && ['die', 'stop'].includes(event.action)) {
      // Docker commonly emits both die and stop for one exit. Resolve diagnostics once,
      // then emit a correlated lifecycle result even if diagnosis is slow or unavailable.
      const now = Date.now();
      for (const [key, time] of terminations) {
        if (now - time > 60_000 || terminations.size >= 512) {
          terminations.delete(key);
        }
      }
      if (terminations.has(terminalKey)) {
        return;
      }
      terminations.set(terminalKey, now);
      withTimeout(
        opts.plugins.diagnose({
          entityId: event.entityId || event.containerId || event.id,
          sourceId: identity.sourceId,
          nodeId: node?.id,
        }),
        30_000,
      )
        .then((diag) => {
          if (diag) {
            const message = {
              type: 'diagnostic' as const,
              data: { ...diag, containerId: node?.id || diag.containerId },
            };
            if (!stopped) {
              opts.broadcast(message);
            }
            emitAlert({
              ...message,
              ...identity,
              family: 'crash',
              eventType: 'crash',
              time: diag.time,
            });
          }
          emitLifecycle('stopped', Boolean(diag));
        })
        .catch(() => emitLifecycle('stopped'));
    } else if (['container', 'pod', 'workload'].includes(event.type) && lifecycle[event.action]) {
      emitLifecycle(lifecycle[event.action]);
    }
  };

  return {
    getGraph: () => cachedGraph,
    async start() {
      await refreshGraph();
      syncEventWatchers();
      statsInterval = setInterval(refreshStats, 3000);
      graphInterval = setInterval(() => {
        refreshGraph()
          .then(syncEventWatchers)
          .catch(() => {});
      }, 10000);
      connectionStatusInterval = setInterval(() => {
        opts.plugins
          .refreshConnections()
          .then(syncEventWatchers)
          .catch(() => {});
      }, 10000);
      opts.plugins
        .refreshConnections()
        .then(syncEventWatchers)
        .catch(() => {});
    },
    stop() {
      stopped = true;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      if (statsInterval) {
        clearInterval(statsInterval);
      }
      if (graphInterval) {
        clearInterval(graphInterval);
      }
      if (connectionStatusInterval) {
        clearInterval(connectionStatusInterval);
      }
      for (const stop of eventWatchers.values()) {
        stop();
      }
      eventWatchers.clear();
    },
  };
}
