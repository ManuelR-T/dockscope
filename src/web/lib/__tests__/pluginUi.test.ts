import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginUiExtension } from '../../../core/plugin-ui';
import type { ServiceNode } from '../../../types';
import {
  clearPluginFrontendCache,
  invokePluginUiAction,
  loadPluginFrontendSource,
  pluginUiContextFromNode,
} from '../pluginUi';

const originalFetch = globalThis.fetch;

afterEach(() => {
  clearPluginFrontendCache();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function node(): ServiceNode {
  return {
    id: 'remote-a:123',
    name: 'api',
    fullName: 'project-api-1',
    project: 'project',
    host: 'remote-a',
    runtime: 'docker',
    kind: 'container',
    containerId: '1234567890',
    image: 'api:latest',
    status: 'running',
    health: 'healthy',
    ports: [],
    networks: ['backend'],
    volumeCount: 0,
    cpu: 2,
    memory: 1024,
    memoryLimit: 2048,
    networkRx: 10,
    networkTx: 20,
    networkRxRate: 1,
    networkTxRate: 2,
  };
}

function extension(): PluginUiExtension {
  return {
    pluginId: 'example.plugin',
    id: 'restart',
    slot: 'nodeAction',
    title: 'Restart',
    action: { type: 'run_command', commandId: 'restart' },
  };
}

describe('plugin UI helpers', () => {
  it('exposes only the stable node context fields', () => {
    expect(pluginUiContextFromNode(node())).toEqual({
      node: {
        id: 'remote-a:123',
        name: 'api',
        sourceId: 'remote-a',
        entityId: '1234567890',
        runtime: 'docker',
        kind: 'container',
        namespace: undefined,
        status: 'running',
        project: 'project',
        host: 'remote-a',
      },
    });
    expect(pluginUiContextFromNode(null)).toEqual({});
  });

  it('routes declared actions through the owning extension endpoint', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ type: 'command', result: { ok: true } }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as typeof fetch;

    await invokePluginUiAction(extension(), pluginUiContextFromNode(node()), { force: true });

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe('/api/plugins/example.plugin/ui/restart/action');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      context: { node: { id: 'remote-a:123', runtime: 'docker' } },
      input: { force: true },
    });
  });

  it('caches frontend source and invalidates it explicitly', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('export const mount = () => {};'),
    ) as typeof fetch;

    await expect(loadPluginFrontendSource('example.plugin')).resolves.toContain('mount');
    await expect(loadPluginFrontendSource('example.plugin')).resolves.toContain('mount');
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    clearPluginFrontendCache('example.plugin');
    await loadPluginFrontendSource('example.plugin');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('evicts failed frontend requests so a retry can recover', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'bundle unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('export default () => {};')) as typeof fetch;

    await expect(loadPluginFrontendSource('example.plugin')).rejects.toThrow('bundle unavailable');
    await expect(loadPluginFrontendSource('example.plugin')).resolves.toContain('export default');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
