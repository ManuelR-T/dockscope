import type { Express } from 'express';
import { type PluginRegistry } from '../../core/plugin-contract/registry.js';
import { asyncRoute } from '../errors.js';

import { getStringQuery, isComposeAction } from './request.js';

export function setupProjectsRoutes(
  app: Express,
  {
    plugins,
  }: {
    plugins: PluginRegistry;
  },
): void {
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
      res.json({
        ok: true,
        message: await plugins.runProjectAction(name, action, {
          pluginId: getStringQuery(req, 'pluginId'),
          providerId: getStringQuery(req, 'providerId'),
        }),
      });
    }),
  );
}
