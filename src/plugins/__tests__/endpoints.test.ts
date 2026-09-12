import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadExternalPlugins } from '../loader';
import { PluginRegistry } from '../../core/plugin-contract/registry';
import { collectSourceGraphs } from '../../core/sources/collect';
import type { PluginFactory, PluginHostApi } from '../../core/plugin-contract/api';
import { validatePluginManifest, type DockscopePlugin } from '../../core/plugin-contract/manifest';

const sourceDir = path.resolve('plugins/official/endpoints');
const factoryPath = path.join(sourceDir, 'plugin.mjs');
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.reverse()) {
    await cleanup();
  }
  cleanups.length = 0;
});

async function listen(server: http.Server | https.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return `${server instanceof https.Server ? 'https' : 'http'}://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function localPlugin(storage = new Map<string, unknown>()): Promise<DockscopePlugin> {
  const factory = (await import(factoryPath)).default as PluginFactory;
  const manifest = validatePluginManifest(
    JSON.parse(await readFile(path.join(sourceDir, 'plugin.json'), 'utf8')),
  );
  const host = {
    readStorage: async (key: string) => structuredClone(storage.get(key)),
    writeStorage: async (key: string, value: unknown) => {
      storage.set(key, structuredClone(value));
    },
  } as PluginHostApi;
  const plugin = await factory({
    manifest,
    pluginDir: sourceDir,
    config: {},
    host,
    logger: console,
  });
  cleanups.push(() => plugin.stop?.());
  await plugin.start?.();
  return plugin;
}

describe('official endpoint monitoring', () => {
  it('loads in an isolated process and exposes live graph metrics and cached read-only panels', async () => {
    let requests = 0;
    const url = await listen(
      http.createServer((_req, res) => {
        requests++;
        res.writeHead(204).end();
      }),
    );
    const temp = await mkdtemp(path.join(tmpdir(), 'dockscope-endpoints-'));
    cleanups.push(() => rm(temp, { recursive: true, force: true }));
    const pluginDir = path.join(temp, 'plugin');
    await cp(sourceDir, pluginDir, { recursive: true });
    const loaded = await loadExternalPlugins({ paths: [pluginDir], permissions: 'all' });
    expect(loaded.errors).toEqual([]);
    const plugin = loaded.plugins[0];
    cleanups.push(() => plugin.stop?.());
    const registry = new PluginRegistry();
    registry.register(plugin);
    await registry.startAll();
    await plugin.getConnectionProviders!()[0].addConnection({ label: 'Home', url });
    const graph = (await collectSourceGraphs(registry.getGraphSources())).graph;
    const node = graph.nodes[0];
    expect(node).toMatchObject({
      runtime: 'official.endpoints',
      kind: 'endpoint',
      entityStatus: 'healthy',
      sourceId: 'official.endpoints',
    });
    expect(node.metrics).toEqual([
      expect.objectContaining({ name: 'response_time', unit: 'ms', value: expect.any(Number) }),
    ]);
    const context = {
      node: {
        id: node.id,
        name: node.name,
        kind: node.kind,
        runtime: node.runtime,
        entityId: node.entityId,
        sourceId: node.sourceId,
      },
    };
    for (let i = 0; i < 3; i++) {
      const panel = await registry.queryPluginUi('official.endpoints', 'health', context);
      expect(panel).toMatchObject({
        type: 'keyValue',
        items: expect.arrayContaining([{ label: 'HTTP status', value: 204 }]),
      });
    }
    expect(requests).toBe(1);
    expect(
      await registry.listEntityOperations({ entityId: node.entityId!, sourceId: node.sourceId }),
    ).toEqual([]);
  });

  it('persists connections, rejects duplicates and removes entities', async () => {
    const url = await listen(http.createServer((_req, res) => res.end('ok')));
    const storage = new Map<string, unknown>();
    const plugin = await localPlugin(storage);
    const connections = plugin.getConnectionProviders!()[0];
    await connections.addConnection({ label: 'Home', url });
    await expect(connections.addConnection({ label: 'Again', url })).rejects.toThrow('already');
    await plugin.stop?.();
    const restored = await localPlugin(storage);
    const saved = await restored.getConnectionProviders!()[0].listConnections();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ label: 'Home', status: 'connected' });
    await restored.getConnectionProviders!()[0].removeConnection(saved[0].id);
    expect((await restored.getEntitySources!()[0].collectEntities()).entities).toEqual([]);
  });

  it('reports failing HTTP responses and does not follow redirects', async () => {
    let targetRequests = 0;
    const target = await listen(
      http.createServer((_req, res) => {
        targetRequests++;
        res.end('ok');
      }),
    );
    const url = await listen(
      http.createServer((req, res) =>
        req.url === '/redirect'
          ? res.writeHead(302, { location: target }).end()
          : res.writeHead(503).end(),
      ),
    );
    const plugin = await localPlugin();
    const connections = plugin.getConnectionProviders!()[0];
    await connections.addConnection({ label: 'Broken', url });
    await connections.addConnection({ label: 'Redirect', url: `${url}/redirect` });
    const entities = (await plugin.getEntitySources!()[0].collectEntities()).entities;
    expect(entities.map((entity) => entity.status)).toEqual(['unhealthy', 'healthy']);
    expect(targetRequests).toBe(0);
  });

  it('bounds stalled probes and does not expose a successful latency for a timeout', async () => {
    const url = await listen(http.createServer(() => {}));
    const plugin = await localPlugin();
    await plugin.getConnectionProviders!()[0].addConnection({ label: 'Stalled', url });
    const entity = (await plugin.getEntitySources!()[0].collectEntities()).entities[0];
    expect(entity).toMatchObject({ status: 'unhealthy', metrics: [] });
    expect(
      await plugin.queryUi!('health', {
        node: {
          id: entity.id,
          name: entity.name,
          entityId: entity.id,
          sourceId: 'official.endpoints',
        },
      }),
    ).toMatchObject({
      items: expect.arrayContaining([{ label: 'Error', value: 'Timed out after 3 seconds' }]),
    });
  });

  it('rejects untrusted TLS and reads expiry only after a verified TLS handshake', async () => {
    const cert = await readFile('src/server/__tests__/fixtures/localhost-cert.pem');
    const key = await readFile('src/server/__tests__/fixtures/localhost-key.pem');
    const url = await listen(https.createServer({ cert, key }, (_req, res) => res.end('ok')));
    const untrusted = await localPlugin();
    await untrusted.getConnectionProviders!()[0].addConnection({ label: 'Untrusted', url });
    expect((await untrusted.getEntitySources!()[0].collectEntities()).entities[0]).toMatchObject({
      status: 'unhealthy',
      metrics: [],
    });
    // Trust this test CA at the network seam, without disabling hostname/certificate verification.
    const get = https.get;
    vi.spyOn(https, 'get').mockImplementation(((
      target: URL,
      options: https.RequestOptions,
      callback: Parameters<typeof https.get>[2],
    ) => get(target, { ...options, ca: cert }, callback)) as typeof https.get);
    const trusted = await localPlugin();
    await trusted.getConnectionProviders!()[0].addConnection({ label: 'Trusted', url });
    const entity = (await trusted.getEntitySources!()[0].collectEntities()).entities[0];
    expect(entity.status).toBe('healthy');
    expect(entity.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'certificate_remaining', unit: 'days' }),
      ]),
    );
    const panel = await trusted.queryUi!('health', {
      node: {
        id: entity.id,
        name: entity.name,
        sourceId: 'official.endpoints',
        entityId: entity.id,
      },
    });
    expect(panel).toMatchObject({
      items: expect.arrayContaining([
        {
          label: 'Certificate expires',
          value: new Date(new X509Certificate(cert).validTo).toISOString(),
        },
      ]),
    });
  });

  it.each([
    'file:///etc/passwd',
    'http://user:password@localhost',
    'http://localhost/?token=secret',
    'http://localhost/#secret',
  ])('rejects unsupported or credential-bearing targets: %s', async (url) => {
    const plugin = await localPlugin();
    await expect(
      plugin.getConnectionProviders!()[0].addConnection({ label: 'Unsafe', url }),
    ).rejects.toThrow();
    expect(await plugin.getConnectionProviders!()[0].listConnections()).toEqual([]);
  });
});
