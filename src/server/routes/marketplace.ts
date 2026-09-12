import type { Express } from 'express';
import { DockscopeError } from '../../core/errors.js';
import { loadAggregatedPluginCatalogs } from '../../plugins/catalogAggregate.js';
import { previewPluginCatalog } from '../../plugins/catalogPreview.js';
import type { PluginMarketplaceService } from '../../plugins/marketplace.js';
import type { ServerOptions } from '../../types.js';
import { asyncRoute } from '../errors.js';

export function setupMarketplaceRoutes(
  app: Express,
  {
    opts,
    marketplace,
  }: {
    opts: ServerOptions;
    marketplace: PluginMarketplaceService;
  },
): void {
  app.get(
    '/api/plugins/catalog',
    asyncRoute(async (_req, res) => {
      const configuration = {
        source: opts.pluginCatalog ?? process.env.DOCKSCOPE_PLUGIN_CATALOG,
        publicKey: opts.pluginCatalogPublicKey ?? process.env.DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY,
        serializedTrustStore: opts.pluginCatalogTrust ?? process.env.DOCKSCOPE_PLUGIN_CATALOG_TRUST,
        disableOfficial:
          opts.disableOfficialPluginCatalog ||
          process.env.DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG === '1',
      };
      const aggregated = await loadAggregatedPluginCatalogs(configuration);
      if (aggregated.catalogs.length === 0) {
        res.json({ configured: false, catalogs: [], entries: [] });
        return;
      }
      res.json({
        configured: true,
        catalogs: aggregated.catalogs,
        shadowedIds: aggregated.shadowedIds,
        entries: aggregated.entries.map((aggregatedEntry) => ({
          ...aggregatedEntry.entry,
          catalogName: aggregatedEntry.catalogName,
          catalogSource: aggregatedEntry.source,
          official: aggregatedEntry.official,
        })),
      });
    }),
  );

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

  app.get(
    '/api/plugins/catalogs',
    asyncRoute(async (_req, res) => {
      res.json(await marketplace.listCatalogs());
    }),
  );

  // Inspects a catalog without trusting it, so the user can compare the key
  // fingerprint against what the publisher advertises before adding it.
  app.post(
    '/api/plugins/catalogs/preview',
    asyncRoute(async (req, res) => {
      const source = (req.body as { source?: unknown } | undefined)?.source;
      if (typeof source !== 'string' || !source.trim()) {
        throw new DockscopeError('A catalog "source" string is required', {
          code: 'INVALID_REQUEST',
          category: 'validation',
        });
      }
      res.json(await previewPluginCatalog(source));
    }),
  );

  app.post(
    '/api/plugins/catalogs',
    asyncRoute(async (req, res) => {
      const source = (req.body as { source?: unknown } | undefined)?.source;
      if (typeof source !== 'string' || !source.trim()) {
        throw new DockscopeError('A catalog "source" string is required', {
          code: 'INVALID_REQUEST',
          category: 'validation',
        });
      }
      res.json(await marketplace.addCatalog(source));
    }),
  );

  app.delete(
    '/api/plugins/catalogs',
    asyncRoute(async (req, res) => {
      const source = (req.query.source as string | undefined) ?? '';
      if (!source.trim()) {
        throw new DockscopeError('A catalog "source" query parameter is required', {
          code: 'INVALID_REQUEST',
          category: 'validation',
        });
      }
      res.json(await marketplace.removeCatalog(source));
    }),
  );
}
