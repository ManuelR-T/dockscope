import type { Express } from 'express';
import { type PluginRegistry } from '../../core/plugin-contract/registry.js';
import type { GraphData } from '../../types.js';
import { shortId } from '../../utils.js';
import { asyncRoute } from '../errors.js';

import { getEntityRef, getId, getMetricNodeId } from './request.js';

export function setupEntitiesRoutes(
  app: Express,
  {
    plugins,
    getGraph,
    metricHistory,
  }: {
    plugins: PluginRegistry;
    getGraph: () => GraphData;
    metricHistory: Map<string, { cpu: number; memory: number; time: number }[]>;
  },
): void {
  app.get(
    '/api/containers/:id/logs',
    asyncRoute(async (req, res) => {
      const tail = parseInt(req.query.tail as string) || 200;
      res.json({ logs: await plugins.getLogs(getEntityRef(req), { tail }) });
    }),
  );

  app.get(
    '/api/entities/:entityId/actions',
    asyncRoute(async (req, res) => {
      res.json(
        await plugins.listEntityActions(
          getEntityRef(req, req.params.entityId as string, getGraph()),
        ),
      );
    }),
  );

  app.get(
    '/api/entities/:entityId/operations',
    asyncRoute(async (req, res) => {
      res.json(
        await plugins.listEntityOperations(
          getEntityRef(req, req.params.entityId as string, getGraph()),
        ),
      );
    }),
  );

  app.post(
    '/api/entities/:entityId/actions/:pluginId/:actionId',
    asyncRoute(async (req, res) => {
      const body = req.body as { input?: unknown } | undefined;
      res.json(
        await plugins.runEntityAction(
          getEntityRef(req, req.params.entityId as string, getGraph()),
          req.params.pluginId as string,
          req.params.actionId as string,
          body?.input,
        ),
      );
    }),
  );

  app.get(
    '/api/entities/:entityId/logs',
    asyncRoute(async (req, res) => {
      const tail = parseInt(req.query.tail as string) || 200;
      res.json({
        logs: await plugins.getLogs(getEntityRef(req, req.params.entityId as string, getGraph()), {
          tail,
        }),
      });
    }),
  );

  app.get(
    '/api/entities/:entityId/stats',
    asyncRoute(async (req, res) => {
      const ref = getEntityRef(req, req.params.entityId as string, getGraph());
      const stats = await plugins.getStats(ref);
      res.json({ ...stats, id: ref.nodeId });
    }),
  );

  app.get(
    '/api/entities/:entityId/inspect',
    asyncRoute(async (req, res) => {
      res.json(await plugins.inspect(getEntityRef(req, req.params.entityId as string, getGraph())));
    }),
  );

  app.get(
    '/api/entities/:entityId/top',
    asyncRoute(async (req, res) => {
      res.json(await plugins.getTop(getEntityRef(req, req.params.entityId as string, getGraph())));
    }),
  );

  app.get(
    '/api/entities/:entityId/diff',
    asyncRoute(async (req, res) => {
      res.json(await plugins.getDiff(getEntityRef(req, req.params.entityId as string, getGraph())));
    }),
  );

  app.get('/api/entities/:entityId/history', (req, res) => {
    const ref = getEntityRef(req, req.params.entityId as string, getGraph());
    res.json(metricHistory.get(ref.nodeId ?? '') || metricHistory.get(shortId(ref.entityId)) || []);
  });

  app.get(
    '/api/entities/:entityId/diagnostic',
    asyncRoute(async (req, res) => {
      const ref = getEntityRef(req, req.params.entityId as string, getGraph());
      const diagnostic = await plugins.diagnose(ref);
      res.json(diagnostic ? { ...diagnostic, containerId: ref.nodeId } : null);
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
}
