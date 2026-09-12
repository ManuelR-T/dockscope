import { describe, expect, it } from 'vitest';
import { pluginCatalogChannels } from '../catalogChannels';
import { validatePluginCatalog } from '../catalog';

function catalog(packageUrl = './packages/demo.dockscope-plugin') {
  return validatePluginCatalog({
    format: 'dockscope-plugin-catalog/v1',
    name: 'Official',
    entries: [
      {
        id: 'official.kubernetes',
        name: 'Kubernetes',
        version: '1.0.0',
        capabilities: ['source.graph'],
        permissions: ['kubernetes.api'],
        packageUrl,
      },
      {
        id: 'official.endpoints',
        name: 'Endpoints',
        version: '0.1.0',
        capabilities: ['source.graph', 'ui.query'],
        permissions: ['network.local'],
        packageUrl,
      },
      {
        id: 'future.plugin',
        name: 'Future',
        version: '1.0.0',
        capabilities: ['future.capability'],
        permissions: [],
        packageUrl,
      },
      {
        id: 'future.permission',
        name: 'Future permission',
        version: '1.0.0',
        capabilities: [],
        permissions: ['future.permission'],
        packageUrl,
      },
    ],
  });
}

describe('official catalog channels', () => {
  it('keeps the legacy catalog vocabulary frozen while publishing all current entries', () => {
    const input = catalog();
    const { legacy, current } = pluginCatalogChannels(input);
    expect(legacy.entries.map((entry) => entry.id)).toEqual(['official.kubernetes']);
    expect(current.entries.map((entry) => entry.id)).toEqual(
      input.entries.map((entry) => entry.id),
    );
    expect(legacy.entries[0].packageUrl).toBe('./packages/demo.dockscope-plugin');
    expect(current.entries[0].packageUrl).toBe('../packages/demo.dockscope-plugin');
    expect(input.entries[0].packageUrl).toBe('./packages/demo.dockscope-plugin');
    expect(current.entries[1].capabilities).toContain('ui.query');
  });

  it('preserves absolute package URLs and trust policy but requires each channel to be signed', () => {
    const input = {
      ...catalog('https://example.test/packages/demo.dockscope-plugin'),
      trust: { packageKeys: [], revokedPackageKeyIds: ['revoked'], revokedPackages: [] },
      signature: { algorithm: 'ed25519' as const, value: 'old-signature' },
    };
    for (const document of Object.values(pluginCatalogChannels(input))) {
      expect(document.entries[0].packageUrl).toBe(input.entries[0].packageUrl);
      expect(document.trust).toEqual(input.trust);
      expect(document.signature).toBeUndefined();
    }
  });
});
