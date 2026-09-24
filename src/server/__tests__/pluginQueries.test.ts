import { MetricHistory } from '../metricHistory';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { setupRoutes } from '../routes';
import { apiRequestAllowed } from '../../core/access';
import { PluginRegistry } from '../../core/plugin-contract/registry';
import { collectSourceGraphs } from '../../core/sources/collect';
import type { DockscopePlugin } from '../../core/plugin-contract/manifest';
import type { ServerOptions } from '../../types';
import type { PluginMarketplaceService } from '../../plugins/marketplace';

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

function plugin(): DockscopePlugin {
  return {
    manifest: {
      id: 'test.monitor',
      name: 'Monitor',
      version: '1.0.0',
      manifestVersion: '1',
      dockscopeApiVersion: '1',
      hostApiVersion: '1',
      capabilities: ['source.graph', 'ui.nodePanel', 'ui.query'],
      permissions: [],
      ui: [
        {
          id: 'health',
          slot: 'nodePanel',
          title: 'Health',
          query: true,
          context: { kinds: ['probe'] },
        },
      ],
    },
    getEntitySources: () => [
      {
        describe: () => ({
          id: 'monitor',
          label: 'Monitor',
          pluginId: 'test.monitor',
          kind: 'plugin',
          status: 'connected',
          capabilities: ['source.graph'],
        }),
        collectEntities: async () => ({
          collectedAt: 1,
          entities: [{ id: 'home', name: 'Home', kind: 'probe', status: 'healthy' }],
        }),
      },
    ],
    queryUi: (_id, context) => ({
      type: 'text',
      body: `${context.node?.sourceId}/${context.node?.entityId}`,
    }),
  };
}

describe('read-only plugin panel queries', () => {
  it('lets Readers query declared panels with server-resolved context, but not commands', async () => {
    const registry = new PluginRegistry();
    registry.register(plugin());
    const { graph } = await collectSourceGraphs(registry.getGraphSources());
    const app = express();
    app.use('/api', (req, res, next) => {
      if (!apiRequestAllowed('reader', { method: req.method, path: req.path })) {
        res.sendStatus(403);
        return;
      }
      next();
    });
    setupRoutes(
      app,
      {} as ServerOptions,
      new MetricHistory('/unused-metric-history.jsonl'),
      () => graph,
      registry,
      {} as PluginMarketplaceService,
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/plugins/test.monitor/ui/health`;
    const response = await fetch(
      `${base}/query?nodeId=monitor:home&sourceId=forged&entityId=forged`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ type: 'text', body: 'monitor/home' });
    expect((await fetch(`${base}/query?nodeId=missing`)).status).toBe(404);
    expect((await fetch(`${base}/query`)).status).toBe(400);
    expect((await fetch(`${base}/action`, { method: 'POST' })).status).toBe(403);
    expect((await fetch(`${base}/query`, { method: 'POST' })).status).toBe(403);
  });

  it('rejects undeclared, disabled, mismatched and malformed queries', async () => {
    const registry = new PluginRegistry();
    const monitor = plugin();
    registry.register(monitor);
    const context = { node: { id: 'home', name: 'Home', kind: 'probe' } };
    await expect(registry.queryPluginUi('test.monitor', 'missing', context)).rejects.toMatchObject({
      status: 404,
    });
    await expect(registry.queryPluginUi('test.monitor', 'health', {})).rejects.toMatchObject({
      status: 400,
    });
    const malformed = new PluginRegistry();
    malformed.register({
      ...plugin(),
      queryUi: () => ({ type: 'metrics', items: [{ label: 'Latency', value: NaN }] }),
    });
    await expect(malformed.queryPluginUi('test.monitor', 'health', context)).rejects.toThrow(
      'finite',
    );
    await registry.disablePlugin('test.monitor');
    await expect(registry.queryPluginUi('test.monitor', 'health', context)).rejects.toMatchObject({
      status: 404,
    });
  });
});
