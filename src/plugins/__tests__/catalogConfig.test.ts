import { createPublicKey } from 'crypto';
import { describe, expect, it } from 'vitest';
import { PLUGIN_CATALOG_TRUST_STORE_FORMAT } from '../catalog';
import {
  OFFICIAL_PLUGIN_CATALOG_TRUST_STORE,
  OFFICIAL_PLUGIN_CATALOG_URL,
  parsePluginCatalogSources,
  pluginCatalogLoadOptionsFromEnv,
  pluginCatalogSourceFromEnv,
  pluginCatalogSourcesFromEnv,
  resolvePluginCatalogLoadOptions,
  resolvePluginCatalogSource,
  resolvePluginCatalogSources,
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

  it('keeps the official pin alongside explicit verification settings', () => {
    const source = pluginCatalogSourceFromEnv({});
    const options = pluginCatalogLoadOptionsFromEnv(
      { DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY: 'custom-public-key' },
      source!,
    );

    // A key configured for a third-party catalog must not silently unpin the
    // official one. Both stay usable, so an official mirror still verifies.
    expect(options.publicKey).toBe('custom-public-key');
    expect(options.trustStore).toEqual(OFFICIAL_PLUGIN_CATALOG_TRUST_STORE);
  });

  it('adds configured catalogs to the official one instead of replacing it', () => {
    const custom = 'https://plugins.example.test/catalog.json';

    expect(resolvePluginCatalogSources({ source: custom })).toEqual([
      OFFICIAL_PLUGIN_CATALOG_URL,
      custom,
    ]);
    expect(resolvePluginCatalogSources({ source: custom, disableOfficial: true })).toEqual([
      custom,
    ]);
  });

  it('parses several catalogs and ignores blanks and duplicates', () => {
    const first = 'https://a.example.test/catalog.json';
    const second = 'https://b.example.test/catalog.json';

    expect(parsePluginCatalogSources(` ${first} , , ${second} `)).toEqual([first, second]);
    expect(
      resolvePluginCatalogSources({
        source: `${first},${first}`,
        disableOfficial: true,
      }),
    ).toEqual([first]);
    expect(pluginCatalogSourcesFromEnv({ DOCKSCOPE_PLUGIN_CATALOG: first })).toEqual([
      OFFICIAL_PLUGIN_CATALOG_URL,
      first,
    ]);
  });

  it('merges a configured trust store with the official keys for the official catalog', () => {
    const extra = JSON.stringify({
      format: PLUGIN_CATALOG_TRUST_STORE_FORMAT,
      keys: [
        {
          algorithm: 'ed25519',
          keyId: 'acme-catalog-v1',
          publicKey: 'acme-key',
          status: 'active',
        },
      ],
      revokedKeyIds: ['old-key'],
    });
    const options = resolvePluginCatalogLoadOptions(OFFICIAL_PLUGIN_CATALOG_URL, {
      serializedTrustStore: extra,
    });

    expect(options.trustStore?.keys.map((key) => key.keyId)).toEqual([
      'official-catalog-v1',
      'acme-catalog-v1',
    ]);
    expect(options.trustStore?.revokedKeyIds).toContain('old-key');
  });

  it('uses only the configured trust settings for third-party catalogs', () => {
    const custom = 'https://plugins.example.test/catalog.json';

    expect(resolvePluginCatalogLoadOptions(custom, { publicKey: 'acme-key' })).toEqual({
      publicKey: 'acme-key',
      trustStore: undefined,
    });
  });
});
