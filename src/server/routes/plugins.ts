import type { Express } from 'express';
import type { AccessRole } from '../../core/access.js';
import { DockscopeError } from '../../core/errors.js';
import { type PluginRegistry } from '../../core/plugin-contract/registry.js';
import { pluginUiContextFromNode } from '../../core/plugin-contract/ui.js';
import type { GraphData } from '../../types.js';
import { PKG_VERSION } from '../../version.js';
import { asyncRoute } from '../errors.js';

import { getNumberQuery, getStringQuery } from './request.js';

export function setupPluginsRoutes(
  app: Express,
  {
    plugins,
    getGraph,
  }: {
    plugins: PluginRegistry;
    getGraph: () => GraphData;
  },
): void {
  app.get('/api/plugins', (_req, res) => {
    res.json(plugins.listPlugins());
  });

  app.get('/api/plugins/errors', (_req, res) => {
    res.json(plugins.listPluginErrors());
  });

  app.get('/api/plugins/warnings', (_req, res) => {
    res.json(plugins.listPluginWarnings());
  });

  app.get(
    '/api/plugins/health',
    asyncRoute(async (_req, res) => {
      res.json(await plugins.listPluginRuntimeHealth());
    }),
  );

  app.get('/api/plugins/ui', (_req, res) => {
    res.json(plugins.listUiExtensions());
  });

  app.get(
    '/api/plugins/:pluginId/ui/:extensionId/query',
    asyncRoute(async (req, res) => {
      const nodeId = getStringQuery(req, 'nodeId');
      const node = nodeId
        ? getGraph().nodes.find((candidate) => candidate.id === nodeId)
        : undefined;
      if (nodeId && !node) {
        throw new DockscopeError('Entity not found', {
          code: 'ENTITY_NOT_FOUND',
          category: 'not_found',
        });
      }
      // Resolve context server-side; clients cannot fabricate another source or entity.
      const context = pluginUiContextFromNode(node);
      res.setHeader('Cache-Control', 'no-store');
      res.json(
        await plugins.queryPluginUi(
          req.params.pluginId as string,
          req.params.extensionId as string,
          context,
        ),
      );
    }),
  );

  app.get(
    '/api/plugins/:pluginId/frontend',
    asyncRoute(async (req, res) => {
      const source = await plugins.getPluginFrontendBundle(req.params.pluginId as string);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.type('application/javascript').send(source);
    }),
  );

  app.post(
    '/api/plugins/:pluginId/ui/:extensionId/action',
    asyncRoute(async (req, res) => {
      const body = req.body as { context?: unknown; input?: unknown } | undefined;
      res.json(
        await plugins.runPluginUiAction(
          req.params.pluginId as string,
          req.params.extensionId as string,
          body ?? {},
          { accessRole: (res.locals.accessRole as AccessRole | undefined) ?? 'operator' },
        ),
      );
    }),
  );

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

  app.get('/api/plugins/approvals', (_req, res) => {
    res.json(plugins.listPluginApprovals());
  });

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
}
