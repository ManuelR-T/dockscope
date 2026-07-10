import type { Express, Request, Response } from 'express';
import { buildGraph, checkConnection, getSystemInfo } from '../docker/client.js';
import { compareEnvironments } from './compare.js';
import { addHost, removeHost, listHosts, getHost } from '../docker/hosts.js';
import { PluginOperationError, type PluginRegistry } from '../core/plugins.js';
import { PluginConfigError } from '../core/plugin-config.js';
import { PluginCommandError } from '../core/plugin-commands.js';
import { PluginEventError } from '../core/plugin-events.js';
import { PluginCompatibilityError } from '../core/plugin-compatibility.js';
import { loadPluginCatalog, PluginCatalogError } from '../plugins/catalog.js';
import type { PluginMarketplaceService } from '../plugins/marketplace.js';
import type { EntityRef } from '../core/operations.js';
import type { GraphData, ServerOptions } from '../types.js';
import { errorMessage, shortId } from '../utils.js';
import { PKG_VERSION, fetchLatestVersion } from '../version.js';

const VALID_ID = /^[a-f0-9]{12,64}$/i;
const VALID_NODE_ID = /^([^\s:]+:)?[a-f0-9]{12,64}$/i;
const COMPOSE_ACTIONS = ['up', 'down', 'destroy', 'stop', 'start', 'restart'] as const;
type ComposeAction = (typeof COMPOSE_ACTIONS)[number];

class RouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RouteError';
  }
}

/** Wrap async route handler with automatic error response */
function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status =
        err instanceof RouteError || err instanceof PluginOperationError
          ? err.status
          : err instanceof PluginConfigError ||
              err instanceof PluginCommandError ||
              err instanceof PluginEventError ||
              err instanceof PluginCompatibilityError ||
              err instanceof PluginCatalogError
            ? 400
            : 500;
      res.status(status).json({ error: errorMessage(err) });
    }
  };
}

/** Get container ID param as string */
function getId(req: Request): string {
  return req.params.id as string;
}

function getStringQuery(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function getNumberQuery(req: Request, key: string): number | undefined {
  const value = getStringQuery(req, key);
  if (!value) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function getEntityRef(req: Request): EntityRef {
  const sourceId = getStringQuery(req, 'host');
  return {
    entityId: getId(req),
    ...(sourceId ? { sourceId } : {}),
    nodeId: getMetricNodeId(req),
  };
}

function getMetricNodeId(req: Request): string {
  const nodeId = getStringQuery(req, 'nodeId');
  if (nodeId && VALID_NODE_ID.test(nodeId)) {
    return nodeId;
  }
  return shortId(getId(req));
}

function isComposeAction(value: string): value is ComposeAction {
  return COMPOSE_ACTIONS.includes(value as ComposeAction);
}

export function setupRoutes(
  app: Express,
  opts: ServerOptions,
  metricHistory: Map<string, { cpu: number; memory: number; time: number }[]>,
  getGraph: () => GraphData,
  plugins: PluginRegistry,
  marketplace: PluginMarketplaceService,
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
      res.json(getGraph());
    }),
  );

  app.get(
    '/api/containers/:id/logs',
    asyncRoute(async (req, res) => {
      const tail = parseInt(req.query.tail as string) || 200;
      res.json({ logs: await plugins.getLogs(getEntityRef(req), { tail }) });
    }),
  );

  app.get(
    '/api/containers/:id/stats',
    asyncRoute(async (req, res) => {
      const nodeId = getMetricNodeId(req);
      const stats = await plugins.getStats(getEntityRef(req));
      res.json({ ...stats, id: nodeId });
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
        await plugins.runLifecycleAction(getEntityRef(req), action);
        res.json({ ok: true });
      }),
    );
  }

  app.delete(
    '/api/containers/:id',
    asyncRoute(async (req, res) => {
      await plugins.removeEntity(getEntityRef(req), { volumes: req.query.volumes === 'true' });
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/containers/:id/top',
    asyncRoute(async (req, res) => {
      res.json(await plugins.getTop(getEntityRef(req)));
    }),
  );

  app.get(
    '/api/containers/:id/diff',
    asyncRoute(async (req, res) => {
      res.json(await plugins.getDiff(getEntityRef(req)));
    }),
  );

  app.get(
    '/api/containers/:id/inspect',
    asyncRoute(async (req, res) => {
      res.json(await plugins.inspect(getEntityRef(req)));
    }),
  );

  app.get('/api/containers/:id/history', (req, res) => {
    const nodeId = getMetricNodeId(req);
    res.json(metricHistory.get(nodeId) || metricHistory.get(shortId(getId(req))) || []);
  });

  app.get(
    '/api/containers/:id/diagnostic',
    asyncRoute(async (req, res) => {
      const diagnostic = await plugins.diagnose(getEntityRef(req));
      res.json(diagnostic ? { ...diagnostic, containerId: getMetricNodeId(req) } : null);
    }),
  );

  app.get(
    '/api/system',
    asyncRoute(async (_req, res) => {
      res.json(await getSystemInfo());
    }),
  );

  app.post(
    '/api/kubernetes/action',
    asyncRoute(async (req, res) => {
      const { id, action, minReplicas, maxReplicas } = req.body as {
        id?: string;
        action?: string;
        minReplicas?: number;
        maxReplicas?: number;
      };
      if (!id || !action) {
        res.status(400).json({ error: 'Both id and action are required' });
        return;
      }
      if (!['delete', 'restart', 'set_hpa_constraints'].includes(action)) {
        res.status(400).json({ error: `Invalid Kubernetes action: ${action}` });
        return;
      }
      await plugins.runResourceAction(id, action as 'delete' | 'restart' | 'set_hpa_constraints', {
        minReplicas,
        maxReplicas,
      });
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/kubernetes/logs',
    asyncRoute(async (req, res) => {
      const { id, tail } = req.body as { id?: string; tail?: number };
      if (!id) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      res.json({ logs: await plugins.getResourceLogs(id, { tail: tail || 200 }) });
    }),
  );

  // Version check (cached, refreshes every 30 min)
  let versionCache: { current: string; latest: string | null; checkedAt: number } | null = null;
  app.get('/api/version', async (_req, res) => {
    const now = Date.now();
    if (!versionCache || now - versionCache.checkedAt > 30 * 60 * 1000) {
      versionCache = { current: PKG_VERSION, latest: await fetchLatestVersion(), checkedAt: now };
    }
    res.json(versionCache);
  });

  // Host management
  app.get('/api/hosts', (_req, res) => {
    res.json(listHosts());
  });

  app.get('/api/sources', (_req, res) => {
    res.json(plugins.listDataSources());
  });

  app.get('/api/plugins', (_req, res) => {
    res.json(plugins.listPlugins());
  });

  app.get('/api/plugins/errors', (_req, res) => {
    res.json(plugins.listPluginErrors());
  });

  app.get('/api/plugins/warnings', (_req, res) => {
    res.json(plugins.listPluginWarnings());
  });

  app.get('/api/plugins/ui', (_req, res) => {
    res.json(plugins.listUiExtensions());
  });

  app.get('/api/plugins/commands', (_req, res) => {
    res.json(plugins.listPluginCommands());
  });

  app.get('/api/plugins/events', (req, res) => {
    res.json(
      plugins.listPluginEvents({
        pluginId: getStringQuery(req, 'pluginId'),
        type: getStringQuery(req, 'type'),
        since: getNumberQuery(req, 'since'),
        limit: getNumberQuery(req, 'limit'),
      }),
    );
  });

  app.get('/api/plugins/compatibility', (_req, res) => {
    res.json(plugins.listPluginCompatibility(PKG_VERSION));
  });

  app.get('/api/plugins/review', (_req, res) => {
    res.json(plugins.listPluginReviews(PKG_VERSION));
  });

  app.get(
    '/api/plugins/catalog',
    asyncRoute(async (_req, res) => {
      if (!opts.pluginCatalog && !process.env.DOCKSCOPE_PLUGIN_CATALOG) {
        res.json({ configured: false, entries: [] });
        return;
      }
      const catalog = await loadPluginCatalog(
        opts.pluginCatalog ?? (process.env.DOCKSCOPE_PLUGIN_CATALOG as string),
        {
          publicKey: opts.pluginCatalogPublicKey ?? process.env.DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY,
        },
      );
      res.json({ configured: true, ...catalog });
    }),
  );

  app.get('/api/plugins/approvals', (_req, res) => {
    res.json(plugins.listPluginApprovals());
  });

  app.get(
    '/api/plugins/marketplace',
    asyncRoute(async (_req, res) => {
      res.json(await marketplace.list());
    }),
  );

  app.post(
    '/api/plugins/marketplace/:pluginId/install',
    asyncRoute(async (req, res) => {
      res.json(await marketplace.install(req.params.pluginId as string));
    }),
  );

  app.post(
    '/api/plugins/marketplace/:pluginId/update',
    asyncRoute(async (req, res) => {
      res.json(await marketplace.update(req.params.pluginId as string));
    }),
  );

  app.delete(
    '/api/plugins/marketplace/:pluginId',
    asyncRoute(async (req, res) => {
      res.json(await marketplace.uninstall(req.params.pluginId as string));
    }),
  );

  app.get('/api/plugins/config', (_req, res) => {
    res.json(plugins.listPluginConfigs());
  });

  app.get(
    '/api/plugins/secrets',
    asyncRoute(async (_req, res) => {
      res.json(await plugins.listPluginSecrets());
    }),
  );

  app.get(
    '/api/plugins/:pluginId/config',
    asyncRoute(async (req, res) => {
      res.json(plugins.getPluginConfig(req.params.pluginId as string));
    }),
  );

  app.put(
    '/api/plugins/:pluginId/config',
    asyncRoute(async (req, res) => {
      res.json(await plugins.updatePluginConfig(req.params.pluginId as string, req.body));
    }),
  );

  app.put(
    '/api/plugins/:pluginId/secrets/:secretKey',
    asyncRoute(async (req, res) => {
      const { value } = req.body as { value?: unknown };
      res.json(
        await plugins.updatePluginSecret(
          req.params.pluginId as string,
          req.params.secretKey as string,
          value,
        ),
      );
    }),
  );

  app.post(
    '/api/plugins/:pluginId/enable',
    asyncRoute(async (req, res) => {
      res.json(await plugins.enablePlugin(req.params.pluginId as string));
    }),
  );

  app.post(
    '/api/plugins/:pluginId/disable',
    asyncRoute(async (req, res) => {
      res.json(await plugins.disablePlugin(req.params.pluginId as string));
    }),
  );

  app.post(
    '/api/plugins/:pluginId/reload',
    asyncRoute(async (req, res) => {
      res.json(await plugins.reloadPlugin(req.params.pluginId as string));
    }),
  );

  app.post(
    '/api/plugins/:pluginId/commands/:commandId',
    asyncRoute(async (req, res) => {
      const { input } = req.body as { input?: unknown };
      res.json(
        await plugins.runPluginCommand(
          req.params.pluginId as string,
          req.params.commandId as string,
          input,
        ),
      );
    }),
  );

  app.post(
    '/api/plugins/:pluginId/migrate',
    asyncRoute(async (req, res) => {
      const { from, to, input } = req.body as { from?: string; to?: string; input?: unknown };
      if (!from || !to) {
        res.status(400).json({ error: 'from and to are required' });
        return;
      }
      res.json(await plugins.runPluginMigration(req.params.pluginId as string, from, to, input));
    }),
  );

  app.post(
    '/api/plugins/:pluginId/approve',
    asyncRoute(async (req, res) => {
      res.json(await plugins.approvePlugin(req.params.pluginId as string));
    }),
  );

  app.post(
    '/api/plugins/:pluginId/revoke-approval',
    asyncRoute(async (req, res) => {
      res.json(await plugins.revokePluginApproval(req.params.pluginId as string));
    }),
  );

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
      res.json(await plugins.listProjects());
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
      if (!isComposeAction(action)) {
        res.status(400).json({ error: `Invalid action: ${action}` });
        return;
      }
      res.json({ ok: true, message: await plugins.runProjectAction(name, action) });
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
