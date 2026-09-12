import type { Express } from 'express';
import { type PluginRegistry } from '../../core/plugin-contract/registry.js';
import { compareEnvironments } from '../compare.js';
import { asyncRoute } from '../errors.js';

export function setupConnectionsRoutes(
  app: Express,
  {
    plugins,
  }: {
    plugins: PluginRegistry;
  },
): void {
  // Host management
  app.get(
    '/api/connections',
    asyncRoute(async (_req, res) => {
      res.json(await plugins.listConnections());
    }),
  );

  app.get('/api/connections/providers', (_req, res) => {
    res.json(plugins.listConnectionProviders());
  });

  app.post(
    '/api/connections/:pluginId/:providerId',
    asyncRoute(async (req, res) => {
      await plugins.addConnection(
        req.params.pluginId as string,
        req.params.providerId as string,
        req.body,
      );
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/connections/:pluginId/:providerId/:connectionId',
    asyncRoute(async (req, res) => {
      await plugins.removeConnection(
        req.params.pluginId as string,
        req.params.providerId as string,
        req.params.connectionId as string,
      );
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/hosts',
    asyncRoute(async (_req, res) => {
      const hosts = (await plugins.listConnections()).filter(
        (connection) => connection.pluginId === 'core.docker' && connection.providerId === 'hosts',
      );
      res.json(
        hosts.map((host) => ({
          name: host.id,
          url: host.endpoint ?? '',
          connected: host.status === 'connected',
          containers: typeof host.metadata?.containers === 'number' ? host.metadata.containers : 0,
          version: typeof host.metadata?.version === 'string' ? host.metadata.version : '',
        })),
      );
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
      await plugins.addConnection('core.docker', 'hosts', { name, url });
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/hosts/:name',
    asyncRoute(async (req, res) => {
      await plugins.removeConnection('core.docker', 'hosts', req.params.name as string);
      res.json({ ok: true });
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
      const sourcesA = plugins.getGraphSources().filter((source) => source.describe().id === hostA);
      const sourcesB = plugins.getGraphSources().filter((source) => source.describe().id === hostB);
      if (sourcesA.length !== 1 || sourcesB.length !== 1) {
        res.status(400).json({
          error: `Unknown or ambiguous source: ${sourcesA.length !== 1 ? hostA : hostB}`,
        });
        return;
      }
      const [snapshotA, snapshotB] = await Promise.all([
        sourcesA[0].collectGraph(),
        sourcesB[0].collectGraph(),
      ]);
      res.json(compareEnvironments(snapshotA.graph, snapshotB.graph));
    }),
  );
}
