import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkConnection, initDockerClient } from '../docker/client.js';
import { initHosts } from '../docker/hosts.js';
import { setupRoutes } from './routes.js';
import type { ServerOptions, ServerHandle, WSMessage } from '../types.js';
import { setupWebSocketHandlers } from './websocket.js';
import { createServerMonitor } from './monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  if (opts.host) {
    initDockerClient(opts.host);
  }
  initHosts(opts.host);

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
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  };

  const monitor = createServerMonitor({ metricHistory, broadcast });
  await monitor.start();
  setupWebSocketHandlers(wss, { getGraph: monitor.getGraph });

  const close = async (exit = false) => {
    monitor.stop();
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);

    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    if (exit) {
      process.exit(0);
    }
  };

  const shutdown = () => {
    console.log('\nShutting down DockScope...');
    close(true).catch((err) => {
      console.error('Shutdown failed:', err);
      process.exit(1);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : opts.port;
      resolve({
        port,
        close: () => close(false),
      });
    });
  });
}
