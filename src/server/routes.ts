import type { Express } from 'express';
import { type PluginRegistry } from '../core/plugin-contract/registry.js';
import type { PluginMarketplaceService } from '../plugins/marketplace.js';
import type { GraphData, ServerOptions } from '../types.js';

import { setupConnectionsRoutes } from './routes/connections.js';
import { setupEntitiesRoutes } from './routes/entities.js';
import { setupMarketplaceRoutes } from './routes/marketplace.js';
import { setupPluginsRoutes } from './routes/plugins.js';
import { setupProjectsRoutes } from './routes/projects.js';
import { getId, VALID_ENTITY_ID, VALID_ID } from './routes/request.js';
import { setupSystemRoutes } from './routes/system.js';

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

  app.param('entityId', (req, res, next, rawId) => {
    if (typeof rawId !== 'string' || !VALID_ENTITY_ID.test(rawId)) {
      res.status(400).json({ error: 'Invalid entity ID format' });
      return;
    }
    next();
  });

  setupEntitiesRoutes(app, { plugins, getGraph, metricHistory });
  setupConnectionsRoutes(app, { plugins });
  setupPluginsRoutes(app, { plugins, getGraph });
  setupMarketplaceRoutes(app, { opts, marketplace });
  setupProjectsRoutes(app, { plugins });
  setupSystemRoutes(app, { plugins, getGraph });
}
