import {
  parsePluginCatalogTrustStore,
  PLUGIN_CATALOG_TRUST_STORE_FORMAT,
  type PluginCatalogLoadOptions,
  type PluginCatalogTrustStore,
} from './catalog.js';
import type { StoredPluginCatalog } from './catalogStore.js';

export const OFFICIAL_PLUGIN_CATALOG_NAME = 'DockScope Official Plugins';
export const OFFICIAL_PLUGIN_CATALOG_URL =
  'https://manuelr-t.github.io/dockscope/plugins/catalog.json';

const OFFICIAL_PLUGIN_CATALOG_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAYB0Ydod72LLaaXPOsGEFeRrrdlE9dSX9uy9Sz8n0RZk=
-----END PUBLIC KEY-----
`;

export const OFFICIAL_PLUGIN_CATALOG_TRUST_STORE: PluginCatalogTrustStore = {
  format: PLUGIN_CATALOG_TRUST_STORE_FORMAT,
  keys: [
    {
      algorithm: 'ed25519',
      keyId: 'official-catalog-v1',
      publicKey: OFFICIAL_PLUGIN_CATALOG_PUBLIC_KEY,
      status: 'active',
    },
  ],
  revokedKeyIds: [],
};

export interface PluginCatalogConfiguration {
  source?: string;
  publicKey?: string;
  serializedTrustStore?: string;
  disableOfficial?: boolean;
  /**
   * Catalogs the user added through the UI, each pinned to the key it presented
   * when trusted. These are resolved after the official catalog and after any
   * catalogs configured by flag or environment variable.
   */
  storedCatalogs?: readonly StoredPluginCatalog[];
}

/**
 * Catalog sources are comma-separated. A comma cannot appear in an unencoded
 * URL authority or path, unlike the platform path delimiter used for plugin
 * paths, which would split `https://`.
 */
export function parsePluginCatalogSources(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Ordered catalog sources. The official catalog comes first unless explicitly
 * disabled, and configured catalogs are added after it rather than replacing
 * it, so a user can browse official and third-party plugins together. Earlier
 * sources win when the same plugin id appears in more than one catalog.
 */
export function resolvePluginCatalogSources(
  configuration: PluginCatalogConfiguration,
): readonly string[] {
  const sources = configuration.disableOfficial ? [] : [OFFICIAL_PLUGIN_CATALOG_URL];
  for (const source of parsePluginCatalogSources(configuration.source)) {
    if (!sources.includes(source)) {
      sources.push(source);
    }
  }
  for (const stored of configuration.storedCatalogs ?? []) {
    if (!sources.includes(stored.source)) {
      sources.push(stored.source);
    }
  }
  return sources;
}

/** @deprecated Use {@link resolvePluginCatalogSources}; returns the first source. */
export function resolvePluginCatalogSource(
  configuration: PluginCatalogConfiguration,
): string | undefined {
  return resolvePluginCatalogSources(configuration)[0];
}

function mergeTrustStores(
  base: PluginCatalogTrustStore,
  extra: PluginCatalogTrustStore | undefined,
): PluginCatalogTrustStore {
  if (!extra) {
    return base;
  }
  const keyIds = new Set(base.keys.map((key) => key.keyId));
  return {
    format: base.format,
    keys: [...base.keys, ...extra.keys.filter((key) => !keyIds.has(key.keyId))],
    revokedKeyIds: [...new Set([...base.revokedKeyIds, ...extra.revokedKeyIds])],
  };
}

export function resolvePluginCatalogLoadOptions(
  source: string,
  configuration: PluginCatalogConfiguration,
): PluginCatalogLoadOptions {
  const publicKey = configuration.publicKey?.trim() || undefined;
  const serializedTrustStore = configuration.serializedTrustStore?.trim();
  const trustStore = serializedTrustStore
    ? parsePluginCatalogTrustStore(serializedTrustStore)
    : undefined;

  // The official catalog keeps its pinned key even when extra verification
  // settings are configured for another catalog, otherwise adding a key for a
  // third-party catalog would silently unpin the official one. Configured keys
  // stay usable alongside the pin, so an official mirror still verifies.
  if (source === OFFICIAL_PLUGIN_CATALOG_URL && !configuration.disableOfficial) {
    return {
      publicKey,
      trustStore: mergeTrustStores(OFFICIAL_PLUGIN_CATALOG_TRUST_STORE, trustStore),
    };
  }

  // A user-added catalog is verified against the single key it was pinned to at
  // trust time, deliberately ignoring the globally configured key. Falling back
  // to the global key here would let an unrelated configured key validate this
  // catalog, which would defeat the point of pinning.
  const stored = configuration.storedCatalogs?.find((entry) => entry.source === source);
  if (stored?.publicKey) {
    return { publicKey: stored.publicKey };
  }

  if (publicKey || trustStore) {
    return { publicKey, trustStore };
  }
  return {};
}

function pluginCatalogConfigurationFromEnv(env: NodeJS.ProcessEnv): PluginCatalogConfiguration {
  return {
    source: env.DOCKSCOPE_PLUGIN_CATALOG,
    publicKey: env.DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY,
    serializedTrustStore: env.DOCKSCOPE_PLUGIN_CATALOG_TRUST,
    disableOfficial: env.DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG === '1',
  };
}

export function pluginCatalogSourcesFromEnv(env: NodeJS.ProcessEnv): readonly string[] {
  return resolvePluginCatalogSources(pluginCatalogConfigurationFromEnv(env));
}

/** @deprecated Use {@link pluginCatalogSourcesFromEnv}; returns the first source. */
export function pluginCatalogSourceFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  return pluginCatalogSourcesFromEnv(env)[0];
}

export function pluginCatalogConfigFromEnv(env: NodeJS.ProcessEnv): PluginCatalogConfiguration {
  return pluginCatalogConfigurationFromEnv(env);
}

export function pluginCatalogLoadOptionsFromEnv(
  env: NodeJS.ProcessEnv,
  source: string,
): PluginCatalogLoadOptions {
  return resolvePluginCatalogLoadOptions(source, pluginCatalogConfigurationFromEnv(env));
}
