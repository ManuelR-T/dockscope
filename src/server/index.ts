import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildGraph,
  checkConnection,
  createExecSession,
  diagnoseCrash,
  getContainerStats,
  streamContainerLogs,
  watchEvents,
} from '../docker/client.js';
import { setupRoutes } from './routes.js';
import type { ServerOptions, GraphData, WSMessage, Anomaly } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function startServer(opts: ServerOptions): Promise<void> {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const connected = await checkConnection();
  if (!connected) {
    console.error('Cannot connect to Docker daemon. Is Docker running?');
    console.error('If running inside a container, mount the Docker socket:');
    console.error('  docker run -v /var/run/docker.sock:/var/run/docker.sock ...');
    process.exit(1);
  }

  // Metric history storage (shared with routes)
  const metricHistory = new Map<string, { cpu: number; memory: number; time: number }[]>();

  // REST routes
  setupRoutes(app, opts, metricHistory);

  // Frontend: Vite dev server (HMR) or static files (production)
  if (process.env.DOCKSCOPE_DEV === '1') {
    try {
      const { createServer: createVite } = await import('vite');
      const vite = await createVite({
        server: { middlewareMode: true, hmr: { server } },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch {
      console.error('Vite not found — install devDependencies for dev mode');
      process.exit(1);
    }
  } else {
    const webDir = path.resolve(__dirname, '../web');
    app.use(express.static(webDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDir, 'index.html'));
    });
  }

  // --- WebSocket ---

  const broadcast = (msg: WSMessage) => {
    const data = JSON.stringify(msg);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  };

  let cachedGraph: GraphData = { nodes: [], links: [] };

  const refreshGraph = async () => {
    try {
      cachedGraph = await buildGraph();
      broadcast({ type: 'graph', data: cachedGraph });
      // Clean stale metric history for removed containers
      const activeIds = new Set(cachedGraph.nodes.map((n) => n.id));
      for (const id of metricHistory.keys()) {
        if (!activeIds.has(id)) metricHistory.delete(id);
      }
    } catch {
      /* Docker may be temporarily unavailable */
    }
  };

  // Track active anomalies to avoid repeated alerts (cleared when value returns to normal)
  const activeAnomalies = new Map<string, Set<string>>();
  const ANOMALY_IQR_FACTOR = 2.5; // Tukey fence multiplier (1.5 = mild outlier, 3 = extreme)
  const ANOMALY_MIN_SAMPLES = 20;
  // Minimum absolute values to trigger — ignores low-usage spikes
  const ANOMALY_MIN_ABS: Record<string, number> = { cpu: 70, memory: 75 };

  function percentile(sorted: number[], p: number): number {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function detectAnomaly(
    shortId: string,
    name: string,
    metric: 'cpu' | 'memory',
    value: number,
    history: { cpu: number; memory: number }[],
  ): Anomaly | null {
    if (history.length < ANOMALY_MIN_SAMPLES) return null;

    // Sanity: values should be percentages; skip if clearly raw bytes
    if (value > 1000) return null;

    // Must exceed minimum absolute threshold
    if (value < (ANOMALY_MIN_ABS[metric] || 0)) {
      activeAnomalies.get(shortId)?.delete(metric);
      return null;
    }

    const sorted = history.map((h) => h[metric]).sort((a, b) => a - b);
    const q1 = percentile(sorted, 0.25);
    const q3 = percentile(sorted, 0.75);
    const iqr = q3 - q1;

    // Skip if data is too uniform (IQR near zero) — use a fallback based on median
    const median = percentile(sorted, 0.5);
    const threshold = iqr > 1 ? q3 + ANOMALY_IQR_FACTOR * iqr : median * 2;

    if (value > threshold) {
      if (!activeAnomalies.has(shortId)) activeAnomalies.set(shortId, new Set());
      const active = activeAnomalies.get(shortId)!;
      if (active.has(metric)) return null; // Already alerted
      active.add(metric);
      return {
        containerId: shortId,
        containerName: name,
        metric,
        value,
        average: median,
        threshold,
        time: Date.now(),
      };
    } else {
      // Clear anomaly flag when value returns to normal
      activeAnomalies.get(shortId)?.delete(metric);
      return null;
    }
  }

  const refreshStats = async () => {
    for (const node of cachedGraph.nodes) {
      if (node.status !== 'running') continue;
      try {
        const stats = await getContainerStats(node.containerId);
        broadcast({ type: 'stats', data: stats });

        const shortId = node.containerId.substring(0, 12);
        if (!metricHistory.has(shortId)) metricHistory.set(shortId, []);
        const history = metricHistory.get(shortId)!;
        history.push({ cpu: stats.cpu, memory: stats.memory, time: Date.now() });
        if (history.length > 100) history.splice(0, history.length - 100);

        // Anomaly detection — CPU always, memory only with a real limit
        const cpuAnomaly = detectAnomaly(
          shortId, node.name, 'cpu', stats.cpu,
          history.map((h) => ({ cpu: h.cpu, memory: 0 })),
        );
        if (cpuAnomaly) broadcast({ type: 'anomaly', data: cpuAnomaly });

        // Memory: convert to percentage (skip if no limit or limit is host RAM > 32GB)
        const hasMemLimit = stats.memoryLimit > 0 && stats.memoryLimit < 32 * 1024 * 1024 * 1024;
        if (hasMemLimit) {
          const memPct = (stats.memory / stats.memoryLimit) * 100;
          const memPctHistory = history.map((h) => ({
            cpu: 0,
            memory: (h.memory / stats.memoryLimit) * 100,
          }));
          const memAnomaly = detectAnomaly(shortId, node.name, 'memory', memPct, memPctHistory);
          if (memAnomaly) broadcast({ type: 'anomaly', data: memAnomaly });
        }
      } catch {
        /* Container may have stopped */
      }
    }
  };

  // Debounce graph refresh so rapid events (die+stop, create+start) collapse
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  function debouncedRefreshGraph() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshGraph();
    }, 500);
  }

  const stopWatching = watchEvents(
    (event) => {
      broadcast({ type: 'event', data: event });
      if (
        ['start', 'stop', 'die', 'destroy', 'create', 'pause', 'unpause'].includes(event.action)
      ) {
        debouncedRefreshGraph();
      }
      if (event.action === 'die') {
        diagnoseCrash(event.id).then((diag) => {
          if (diag) broadcast({ type: 'diagnostic', data: diag });
        });
      }
    },
    (err) => console.error('Docker event stream error:', err.message),
  );

  await refreshGraph();

  const statsInterval = setInterval(refreshStats, 3000);
  const graphInterval = setInterval(refreshGraph, 10000);

  // Per-client log streams and exec sessions
  const clientLogStreams = new Map<WebSocket, () => void>();
  const clientExecStreams = new Map<WebSocket, NodeJS.ReadWriteStream>();

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'graph', data: cachedGraph }));

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'subscribe_logs' && msg.data?.containerId) {
          clientLogStreams.get(ws)?.();
          const stop = streamContainerLogs(
            msg.data.containerId,
            (text) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'log_chunk',
                    data: { containerId: msg.data.containerId, text },
                  }),
                );
              }
            },
            (err) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'error',
                    data: { message: `Log stream error: ${err.message}` },
                  }),
                );
              }
            },
          );
          clientLogStreams.set(ws, stop);
        }
        if (msg.type === 'unsubscribe_logs') {
          clientLogStreams.get(ws)?.();
          clientLogStreams.delete(ws);
        }

        if (msg.type === 'exec_start' && msg.data?.containerId) {
          // Clean up previous exec session
          const prevStream = clientExecStreams.get(ws);
          if (prevStream) (prevStream as any).destroy?.();

          try {
            const { stream: execStream } = await createExecSession(
              msg.data.containerId,
              msg.data.cmd || ['/bin/sh'],
            );
            clientExecStreams.set(ws, execStream);

            // Pipe exec stdout → WS
            execStream.on('data', (chunk: Buffer) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({ type: 'exec_output', data: { text: chunk.toString('utf-8') } }),
                );
              }
            });

            execStream.on('end', () => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'exec_exit' }));
              }
              clientExecStreams.delete(ws);
            });
          } catch (err: any) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({ type: 'error', data: { message: `Exec failed: ${err.message}` } }),
              );
            }
          }
        }

        if (msg.type === 'exec_input' && msg.data?.text) {
          const execStream = clientExecStreams.get(ws);
          if (execStream) execStream.write(msg.data.text);
        }

        if (msg.type === 'exec_resize' && msg.data) {
          // Resize is handled at the TTY level — not directly supported via dockerode exec stream
          // but the terminal will still work, just without dynamic resize
        }

        if (msg.type === 'exec_stop') {
          const execStream = clientExecStreams.get(ws);
          if (execStream) (execStream as any).destroy?.();
          clientExecStreams.delete(ws);
        }
      } catch {
        /* ignore */
      }
    });

    ws.on('close', () => {
      clientLogStreams.get(ws)?.();
      clientLogStreams.delete(ws);
      const execStream = clientExecStreams.get(ws);
      if (execStream) (execStream as any).destroy?.();
      clientExecStreams.delete(ws);
    });
  });

  const shutdown = () => {
    console.log('\nShutting down DockScope...');
    clearInterval(statsInterval);
    clearInterval(graphInterval);
    stopWatching();
    wss.close();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return new Promise((resolve) => {
    server.listen(opts.port, () => resolve());
  });
}
