import { createPublicKey } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_PLUGIN_CATALOG_TRUST_STORE,
  OFFICIAL_PLUGIN_CATALOG_URL,
  pluginCatalogLoadOptionsFromEnv,
  pluginCatalogSourceFromEnv,
  resolvePluginCatalogLoadOptions,
  resolvePluginCatalogSource,
} from '../catalogConfig';

describe('official plugin catalog configuration', () => {
  it('uses the official catalog and pinned signing key by default', () => {
    const source = resolvePluginCatalogSource({});

    expect(source).toBe(OFFICIAL_PLUGIN_CATALOG_URL);
    expect(resolvePluginCatalogLoadOptions(source!, {})).toEqual({
      trustStore: OFFICIAL_PLUGIN_CATALOG_TRUST_STORE,
    });
    const key = OFFICIAL_PLUGIN_CATALOG_TRUST_STORE.keys[0];
    expect(key).toMatchObject({
      keyId: 'official-catalog-v1',
      algorithm: 'ed25519',
      status: 'active',
    });
    expect(() => createPublicKey(key.publicKey)).not.toThrow();
  });

  it('supports an explicit opt-out and leaves custom catalogs unpinned by default', () => {
    expect(resolvePluginCatalogSource({ disableOfficial: true })).toBeUndefined();
    expect(
      pluginCatalogSourceFromEnv({ DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG: '1' }),
    ).toBeUndefined();

    const customSource = 'https://plugins.example.test/catalog.json';
    expect(resolvePluginCatalogSource({ source: customSource, disableOfficial: true })).toBe(
      customSource,
    );
    expect(resolvePluginCatalogLoadOptions(customSource, {})).toEqual({});
  });

  it('allows explicit verification settings to replace the official pin', () => {
    const source = pluginCatalogSourceFromEnv({});
    const options = pluginCatalogLoadOptionsFromEnv(
      { DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY: 'custom-public-key' },
      source!,
    );

    expect(options).toEqual({ publicKey: 'custom-public-key', trustStore: undefined });
  });
});
