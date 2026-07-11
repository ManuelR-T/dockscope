import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDockerClient } from '../docker/client.js';
import { initHosts } from '../docker/hosts.js';
import { setupRoutes } from './routes.js';
import type { ServerOptions, ServerHandle, WSMessage } from '../types.js';
import { setupWebSocketHandlers } from './websocket.js';
import { createServerMonitor } from './monitor.js';
import { createPluginRegistry } from '../plugins/internal.js';
import {
  createPluginMarketplaceService,
  pluginRegistryDirFromEnv,
} from '../plugins/marketplace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function pluginEnvironment(opts: ServerOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.pluginPaths !== undefined) {
    env.DOCKSCOPE_PLUGIN_PATHS = opts.pluginPaths;
  }
  if (opts.pluginPermissions !== undefined) {
    env.DOCKSCOPE_PLUGIN_PERMISSIONS = opts.pluginPermissions;
  }
  if (opts.pluginConfig !== undefined) {
    env.DOCKSCOPE_PLUGIN_CONFIG = opts.pluginConfig;
  }
  if (opts.pluginState !== undefined) {
    env.DOCKSCOPE_PLUGIN_STATE = opts.pluginState;
  }
  if (opts.pluginSecrets !== undefined) {
    env.DOCKSCOPE_PLUGIN_SECRETS = opts.pluginSecrets;
  }
  if (opts.pluginSecretKey !== undefined) {
    env.DOCKSCOPE_PLUGIN_SECRET_KEY = opts.pluginSecretKey;
  }
  if (opts.pluginEvents !== undefined) {
    env.DOCKSCOPE_PLUGIN_EVENTS = opts.pluginEvents;
  }
  if (opts.pluginApprovals !== undefined) {
    env.DOCKSCOPE_PLUGIN_APPROVALS = opts.pluginApprovals;
  }
  if (opts.pluginCatalog !== undefined) {
    env.DOCKSCOPE_PLUGIN_CATALOG = opts.pluginCatalog;
  }
  if (opts.pluginCatalogPublicKey !== undefined) {
    env.DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY = opts.pluginCatalogPublicKey;
  }
  if (opts.pluginCatalogTrust !== undefined) {
    env.DOCKSCOPE_PLUGIN_CATALOG_TRUST = opts.pluginCatalogTrust;
  }
  if (opts.disableOfficialPluginCatalog) {
    env.DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG = '1';
  }
  if (opts.pluginRegistry !== undefined) {
    env.DOCKSCOPE_PLUGIN_REGISTRY = opts.pluginRegistry;
  }
  if (opts.allowUnsignedPlugins) {
    env.DOCKSCOPE_PLUGIN_ALLOW_UNSIGNED = '1';
  }
  if (opts.disableExternalPlugins) {
    env.DOCKSCOPE_DISABLE_EXTERNAL_PLUGINS = '1';
  }
  if (!opts.disableExternalPlugins) {
    const registryDir = pluginRegistryDirFromEnv(env);
    const paths = (env.DOCKSCOPE_PLUGIN_PATHS ?? '')
      .split(path.delimiter)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!paths.includes(registryDir)) {
      env.DOCKSCOPE_PLUGIN_PATHS = [registryDir, ...paths].join(path.delimiter);
    }
  }
  return env;
}

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  if (opts.host) {
    initDockerClient(opts.host);
  }
  initHosts(opts.host);
  const pluginEnv = pluginEnvironment(opts);
  const plugins = await createPluginRegistry(pluginEnv);
  const marketplace = createPluginMarketplaceService(pluginEnv, plugins);
  await plugins.startAll();

  const app = express();
  app.use(cors());
  app.use(express.json());

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Metric history storage (shared with routes)
  const metricHistory = new Map<string, { cpu: number; memory: number; time: number }[]>();

  const broadcast = (msg: WSMessage) => {
    const data = JSON.stringify(msg);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  };

  const monitor = createServerMonitor({ metricHistory, broadcast, plugins });
  setupRoutes(app, opts, metricHistory, monitor.getGraph, plugins, marketplace);

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

  await monitor.start();
  setupWebSocketHandlers(wss, { getGraph: monitor.getGraph, plugins });

  const close = async (exit = false) => {
    monitor.stop();
    await plugins.stopAll();
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
    server.listen(opts.port, opts.bind ?? '127.0.0.1', () => {
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
