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
  const ANOMALY_STDDEV_FACTOR = 2;
  const ANOMALY_MIN_SAMPLES = 10;

  function detectAnomaly(
    shortId: string,
    name: string,
    metric: 'cpu' | 'memory',
    value: number,
    history: { cpu: number; memory: number }[],
  ): Anomaly | null {
    if (history.length < ANOMALY_MIN_SAMPLES) return null;
    const values = history.map((h) => h[metric]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    if (stddev < 1) return null; // Skip if nearly constant

    const threshold = mean + ANOMALY_STDDEV_FACTOR * stddev;

    if (value > threshold) {
      if (!activeAnomalies.has(shortId)) activeAnomalies.set(shortId, new Set());
      const active = activeAnomalies.get(shortId)!;
      if (active.has(metric)) return null; // Already alerted
      active.add(metric);
      return { containerId: shortId, containerName: name, metric, value, average: mean, threshold, time: Date.now() };
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

        // Anomaly detection (need enough samples)
        for (const metric of ['cpu', 'memory'] as const) {
          const anomaly = detectAnomaly(shortId, node.name, metric, stats[metric], history);
          if (anomaly) broadcast({ type: 'anomaly', data: anomaly });
        }
      } catch {
        /* Container may have stopped */
      }
    }
  };

  const stopWatching = watchEvents(
    (event) => {
      broadcast({ type: 'event', data: event });
      if (
        ['start', 'stop', 'die', 'destroy', 'create', 'pause', 'unpause'].includes(event.action)
      ) {
        refreshGraph();
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
