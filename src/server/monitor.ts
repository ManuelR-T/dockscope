import { diagnoseCrash, getContainerStats, watchEvents } from '../docker/client.js';
import { buildMultiHostGraph, refreshHostStatus } from '../docker/hosts.js';
import type { DockerEvent, GraphData, WSMessage } from '../types.js';
import { shortId } from '../utils.js';
import { checkAnomaly } from './anomaly.js';

interface MonitorOptions {
  metricHistory: Map<string, { cpu: number; memory: number; time: number }[]>;
  broadcast(msg: WSMessage): void;
}

export interface ServerMonitor {
  getGraph(): GraphData;
  start(): Promise<void>;
  stop(): void;
}

const GRAPH_REFRESH_ACTIONS = ['start', 'stop', 'die', 'destroy', 'create', 'pause', 'unpause'];

export function createServerMonitor(opts: MonitorOptions): ServerMonitor {
  let cachedGraph: GraphData = { nodes: [], links: [] };
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let statsInterval: ReturnType<typeof setInterval> | null = null;
  let graphInterval: ReturnType<typeof setInterval> | null = null;
  let hostStatusInterval: ReturnType<typeof setInterval> | null = null;
  let stopWatching: (() => void) | null = null;
  const activeAnomalies = new Map<string, Set<string>>();

  const refreshGraph = async () => {
    try {
      cachedGraph = await buildMultiHostGraph();
      opts.broadcast({ type: 'graph', data: cachedGraph });
      const activeIds = new Set(cachedGraph.nodes.map((n) => n.id));
      for (const id of opts.metricHistory.keys()) {
        if (!activeIds.has(id)) {
          opts.metricHistory.delete(id);
        }
      }
    } catch {
      /* Docker may be temporarily unavailable */
    }
  };

  function detectAndBroadcastAnomaly(
    containerId: string,
    name: string,
    metric: 'cpu' | 'memory',
    value: number,
    history: number[],
  ) {
    const result = checkAnomaly(metric, value, history);
    if (result) {
      if (!activeAnomalies.has(containerId)) {
        activeAnomalies.set(containerId, new Set());
      }
      const active = activeAnomalies.get(containerId)!;
      if (active.has(metric)) {
        return;
      }
      active.add(metric);
      opts.broadcast({
        type: 'anomaly',
        data: {
          containerId,
          containerName: name,
          metric,
          value,
          average: result.median,
          threshold: result.threshold,
          time: Date.now(),
        },
      });
    } else {
      activeAnomalies.get(containerId)?.delete(metric);
    }
  }

  const refreshStats = async () => {
    for (const node of cachedGraph.nodes) {
      if (node.status !== 'running') {
        continue;
      }
      try {
        const stats = await getContainerStats(node.containerId);
        opts.broadcast({ type: 'stats', data: stats });

        const sid = shortId(node.containerId);
        if (!opts.metricHistory.has(sid)) {
          opts.metricHistory.set(sid, []);
        }
        const history = opts.metricHistory.get(sid)!;
        history.push({ cpu: stats.cpu, memory: stats.memory, time: Date.now() });
        if (history.length > 100) {
          history.splice(0, history.length - 100);
        }

        detectAndBroadcastAnomaly(
          sid,
          node.name,
          'cpu',
          stats.cpu,
          history.map((h) => h.cpu),
        );

        const hasMemLimit = stats.memoryLimit > 0 && stats.memoryLimit < 32 * 1024 * 1024 * 1024;
        if (hasMemLimit) {
          const memPct = (stats.memory / stats.memoryLimit) * 100;
          detectAndBroadcastAnomaly(
            sid,
            node.name,
            'memory',
            memPct,
            history.map((h) => (h.memory / stats.memoryLimit) * 100),
          );
        }
      } catch {
        /* Container may have stopped */
      }
    }
  };

  function debouncedRefreshGraph() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshGraph();
    }, 500);
  }

  const handleDockerEvent = (event: DockerEvent) => {
    opts.broadcast({ type: 'event', data: event });
    if (GRAPH_REFRESH_ACTIONS.includes(event.action)) {
      debouncedRefreshGraph();
    }
    if (event.action === 'die') {
      diagnoseCrash(event.id).then((diag) => {
        if (diag) {
          opts.broadcast({ type: 'diagnostic', data: diag });
        }
      });
    }
  };

  return {
    getGraph: () => cachedGraph,
    async start() {
      stopWatching = watchEvents(handleDockerEvent, (err) =>
        console.error('Docker event stream error:', err.message),
      );
      await refreshGraph();
      statsInterval = setInterval(refreshStats, 3000);
      graphInterval = setInterval(refreshGraph, 10000);
      hostStatusInterval = setInterval(() => refreshHostStatus().catch(() => {}), 10000);
      refreshHostStatus().catch(() => {});
    },
    stop() {
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
      if (hostStatusInterval) {
        clearInterval(hostStatusInterval);
      }
      stopWatching?.();
    },
  };
}
