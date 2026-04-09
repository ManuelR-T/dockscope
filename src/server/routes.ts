import type { Express, Request, Response } from 'express';
import {
  buildGraph,
  checkConnection,
  composeAction,
  containerAction,
  createDockerClient,
  diagnoseCrash,
  getContainerLogs,
  getContainerStats,
  getContainerDiff,
  getContainerTop,
  getSystemInfo,
  inspectContainer,
  listComposeProjects,
  removeContainer,
} from '../docker/client.js';
import { compareEnvironments } from './compare.js';
import { addHost, removeHost, listHosts, getHost } from '../docker/hosts.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ServerOptions } from '../types.js';
import { shortId } from '../utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'),
).version;

const VALID_ID = /^[a-f0-9]{12,64}$/i;

/** Wrap async route handler with automatic error response */
function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}

/** Get container ID param as string */
function getId(req: Request): string {
  return req.params.id as string;
}

export function setupRoutes(
  app: Express,
  opts: ServerOptions,
  metricHistory: Map<string, { cpu: number; memory: number; time: number }[]>,
): void {
  // Validate container ID format
  app.param('id', (req, res, next) => {
    if (!VALID_ID.test(getId(req))) {
      res.status(400).json({ error: 'Invalid container ID format' });
      return;
    }
    next();
  });

  app.get(
    '/api/graph',
    asyncRoute(async (_req, res) => {
      res.json(await buildGraph());
    }),
  );

  app.get(
    '/api/containers/:id/logs',
    asyncRoute(async (req, res) => {
      const tail = parseInt(req.query.tail as string) || 200;
      res.json({ logs: await getContainerLogs(getId(req), tail) });
    }),
  );

  app.get(
    '/api/containers/:id/stats',
    asyncRoute(async (req, res) => {
      res.json(await getContainerStats(getId(req)));
    }),
  );

  app.get('/api/health', async (_req, res) => {
    const dockerOk = await checkConnection();
    res.json({ status: dockerOk ? 'ok' : 'docker_unavailable' });
  });

  // Container actions — single handler for all action types
  const CONTAINER_ACTIONS = ['start', 'stop', 'restart', 'pause', 'unpause', 'kill'] as const;
  for (const action of CONTAINER_ACTIONS) {
    app.post(
      `/api/containers/:id/${action}`,
      asyncRoute(async (req, res) => {
        await containerAction(getId(req), action);
        res.json({ ok: true });
      }),
    );
  }

  app.delete(
    '/api/containers/:id',
    asyncRoute(async (req, res) => {
      await removeContainer(getId(req), req.query.volumes === 'true');
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/containers/:id/top',
    asyncRoute(async (req, res) => {
      res.json(await getContainerTop(getId(req)));
    }),
  );

  app.get(
    '/api/containers/:id/diff',
    asyncRoute(async (req, res) => {
      res.json(await getContainerDiff(getId(req)));
    }),
  );

  app.get(
    '/api/containers/:id/inspect',
    asyncRoute(async (req, res) => {
      res.json(await inspectContainer(getId(req)));
    }),
  );

  app.get('/api/containers/:id/history', (req, res) => {
    res.json(metricHistory.get(shortId(getId(req))) || []);
  });

  app.get(
    '/api/containers/:id/diagnostic',
    asyncRoute(async (req, res) => {
      res.json((await diagnoseCrash(getId(req))) || null);
    }),
  );

  app.get(
    '/api/system',
    asyncRoute(async (_req, res) => {
      res.json(await getSystemInfo());
    }),
  );

  // Version check (cached, refreshes every 30 min)
  let versionCache: { current: string; latest: string | null; checkedAt: number } | null = null;
  app.get('/api/version', async (_req, res) => {
    const now = Date.now();
    if (!versionCache || now - versionCache.checkedAt > 30 * 60 * 1000) {
      let latest: string | null = null;
      try {
        const r = await fetch('https://registry.npmjs.org/dockscope/latest', {
          signal: AbortSignal.timeout(3000),
        });
        if (r.ok) latest = ((await r.json()) as { version?: string }).version || null;
      } catch {
        /* ignore */
      }
      versionCache = { current: PKG_VERSION, latest, checkedAt: now };
    }
    res.json(versionCache);
  });

  // Host management
  app.get('/api/hosts', (_req, res) => {
    res.json(listHosts());
  });

  app.post(
    '/api/hosts',
    asyncRoute(async (req, res) => {
      const { name, url } = req.body as { name?: string; url?: string };
      if (!name || !url) {
        res.status(400).json({ error: 'Both name and url are required' });
        return;
      }
      const result = await addHost(name, url);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ ok: true });
    }),
  );

  app.delete('/api/hosts/:name', (req, res) => {
    const name = req.params.name as string;
    if (!removeHost(name)) {
      res.status(400).json({ error: `Cannot remove host "${name}"` });
      return;
    }
    res.json({ ok: true });
  });

  const composeEnabled = process.env.DOCKSCOPE_NO_COMPOSE !== '1';

  app.get('/api/features', (_req, res) => {
    res.json({ compose: composeEnabled });
  });

  app.get(
    '/api/projects',
    asyncRoute(async (_req, res) => {
      if (!composeEnabled) {
        res.json([]);
        return;
      }
      res.json(await listComposeProjects());
    }),
  );

  app.post(
    '/api/projects/:name/:action',
    asyncRoute(async (req, res) => {
      if (!composeEnabled) {
        res.status(403).json({ error: 'Compose management is disabled' });
        return;
      }
      const name = req.params.name as string;
      const action = req.params.action as string;
      if (!['up', 'down', 'destroy', 'stop', 'start', 'restart'].includes(action)) {
        res.status(400).json({ error: `Invalid action: ${action}` });
        return;
      }
      res.json({ ok: true, message: await composeAction(name, action as any) });
    }),
  );

  app.post(
    '/api/compare',
    asyncRoute(async (req, res) => {
      const { hostA, hostB } = req.body as { hostA?: string; hostB?: string };
      if (!hostA || !hostB) {
        res.status(400).json({ error: 'Both hostA and hostB are required' });
        return;
      }
      const a = getHost(hostA);
      const b = getHost(hostB);
      if (!a || !b) {
        res.status(400).json({ error: `Unknown host: ${!a ? hostA : hostB}` });
        return;
      }
      const [graphA, graphB] = await Promise.all([
        buildGraph(undefined, hostA, a.client),
        buildGraph(undefined, hostB, b.client),
      ]);
      res.json(compareEnvironments(graphA, graphB));
    }),
  );
}
