import type { Express } from 'express';
import { DockscopeError } from '../../core/errors.js';
import { type PluginRegistry } from '../../core/plugin-contract/registry.js';
import type { GraphData } from '../../types.js';
import { PKG_VERSION, fetchLatestVersion } from '../../version.js';
import { asyncRoute } from '../errors.js';

export function setupSystemRoutes(
  app: Express,
  {
    plugins,
    getGraph,
  }: {
    plugins: PluginRegistry;
    getGraph: () => GraphData;
  },
): void {
  app.get(
    '/api/graph',
    asyncRoute(async (_req, res) => {
      res.json(getGraph());
    }),
  );

  app.get(
    '/api/health',
    asyncRoute(async (_req, res) => {
      const [systems, sources] = await Promise.all([
        plugins.listSystems(),
        Promise.resolve(plugins.listDataSources()),
      ]);
      const available =
        systems.some((system) => system.status === 'connected') ||
        sources.some((source) => source.status === 'connected');
      res.status(available ? 200 : 503).json({
        status: available ? 'ok' : 'sources_unavailable',
        systems,
        sources,
      });
    }),
  );

  app.get(
    '/api/systems',
    asyncRoute(async (_req, res) => {
      res.json(await plugins.listSystems());
    }),
  );

  app.get(
    '/api/system',
    asyncRoute(async (_req, res) => {
      const systems = await plugins.listSystems();
      const system =
        systems.find((candidate) => candidate.id === 'local') ??
        systems.find((candidate) => candidate.status === 'connected') ??
        systems[0];
      if (!system) {
        throw new DockscopeError('No plugin system provider is available', {
          code: 'PROVIDER_NOT_FOUND',
          category: 'not_found',
        });
      }
      res.json({
        dockerVersion: system.version ?? 'unknown',
        os: system.os ?? 'unknown',
        totalMemory: system.memoryBytes ?? 0,
        cpus: system.cpuCount ?? 0,
        containersRunning: system.workloadsRunning ?? 0,
        containersStopped: system.workloadsStopped ?? 0,
        images: system.artifacts ?? 0,
      });
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

  app.get('/api/sources', (_req, res) => {
    res.json(plugins.listDataSources());
  });
}
