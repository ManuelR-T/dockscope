import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePluginManifest } from '../plugin-contract/manifest';
import { PluginRegistry } from '../plugin-contract/registry';
import { createGraphView2dPlugin } from '../../plugins/graphView2d';
import { createPluginRegistry } from '../../plugins/internal';

const manifest = {
  id: 'example.map',
  name: 'Example Map',
  version: '1.0.0',
  manifestVersion: '1',
  dockscopeApiVersion: '1',
  hostApiVersion: '1',
  capabilities: ['ui.graphView', 'ui.frontend'],
  permissions: [],
  frontend: { entry: './frontend.mjs', slots: ['graphView'] },
  ui: [{ id: 'map', slot: 'graphView', title: 'Map', frontendView: 'map' }],
};

describe('graph view plugins', () => {
  it('discovers an external renderer through the same contract as the official renderer', async () => {
    const registry = new PluginRegistry();
    registry.register({
      manifest: validatePluginManifest(manifest),
      getFrontendBundle: async () => 'export default function mount() {}',
    });
    expect(registry.listUiExtensions()).toMatchObject([
      { pluginId: 'example.map', slot: 'graphView', frontendView: 'map' },
    ]);
    expect(await registry.getPluginFrontendBundle('example.map')).toContain('mount');
    await registry.disablePlugin('example.map');
    expect(registry.listUiExtensions()).toEqual([]);
    await expect(registry.getPluginFrontendBundle('example.map')).rejects.toThrow();
  });

  it.each([
    { capabilities: ['ui.frontend'] },
    { capabilities: ['ui.graphView'] },
    { frontend: undefined },
    { frontend: { entry: './frontend.mjs', slots: ['sidebar'] } },
    { ui: [{ ...manifest.ui[0], frontendView: undefined }] },
    { ui: [{ ...manifest.ui[0], action: { type: 'open_url', url: 'https://example.com' } }] },
    { ui: [{ ...manifest.ui[0], query: true }] },
    { ui: [{ ...manifest.ui[0], content: { type: 'text', body: 'no' } }] },
    { ui: [{ ...manifest.ui[0], context: { runtimes: ['docker'] } }] },
  ])('rejects invalid graph view declarations: %j', (overrides) => {
    expect(() => validatePluginManifest({ ...manifest, ...overrides })).toThrow();
  });

  it('keeps a renderer with no frontend provider out of the view selector', () => {
    const registry = new PluginRegistry();
    registry.register({ manifest: validatePluginManifest(manifest) });
    expect(registry.listUiExtensions()).toEqual([]);
  });

  it('allows disabling optional built-ins but protects essential ones', async () => {
    const registry = new PluginRegistry();
    registry.register(createGraphView2dPlugin());
    registry.register({
      manifest: { ...validatePluginManifest(manifest), id: 'core.essential', builtin: true },
    });
    await registry.disablePlugin('official.graph-view-2d');
    expect(registry.listUiExtensions().map((item) => item.pluginId)).not.toContain(
      'official.graph-view-2d',
    );
    await registry.enablePlugin('official.graph-view-2d');
    expect(registry.listUiExtensions().map((item) => item.pluginId)).toContain(
      'official.graph-view-2d',
    );
    await expect(registry.disablePlugin('core.essential')).rejects.toThrow();
    await expect(registry.unregisterPlugin('official.graph-view-2d')).rejects.toThrow();
  });

  it('restores the disabled built-in renderer after restarting', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dockscope-graph-plugin-test-'));
    const env = { DOCKSCOPE_STATE_DIR: dir, DOCKSCOPE_DISABLE_EXTERNAL_PLUGINS: '1' };
    try {
      const first = await createPluginRegistry(env);
      await first.disablePlugin('official.graph-view-2d');
      const restarted = await createPluginRegistry(env);
      expect(restarted.listUiExtensions().filter((item) => item.slot === 'graphView')).toEqual([]);
      await restarted.enablePlugin('official.graph-view-2d');
      const enabled = await createPluginRegistry(env);
      expect(enabled.listUiExtensions().filter((item) => item.slot === 'graphView')).toHaveLength(
        1,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
