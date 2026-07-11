import {
  parsePluginCatalogTrustStore,
  PLUGIN_CATALOG_TRUST_STORE_FORMAT,
  type PluginCatalogLoadOptions,
  type PluginCatalogTrustStore,
} from './catalog.js';

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
}

export function resolvePluginCatalogSource(
  configuration: PluginCatalogConfiguration,
): string | undefined {
  const source = configuration.source?.trim();
  if (source) {
    return source;
  }
  return configuration.disableOfficial ? undefined : OFFICIAL_PLUGIN_CATALOG_URL;
}

export function resolvePluginCatalogLoadOptions(
  source: string,
  configuration: PluginCatalogConfiguration,
): PluginCatalogLoadOptions {
  const publicKey = configuration.publicKey?.trim() || undefined;
  const serializedTrustStore = configuration.serializedTrustStore?.trim();
  if (publicKey || serializedTrustStore) {
    return {
      publicKey,
      trustStore: serializedTrustStore
        ? parsePluginCatalogTrustStore(serializedTrustStore)
        : undefined,
    };
  }
  return source === OFFICIAL_PLUGIN_CATALOG_URL
    ? { trustStore: OFFICIAL_PLUGIN_CATALOG_TRUST_STORE }
    : {};
}

function pluginCatalogConfigurationFromEnv(env: NodeJS.ProcessEnv): PluginCatalogConfiguration {
  return {
    source: env.DOCKSCOPE_PLUGIN_CATALOG,
    publicKey: env.DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY,
    serializedTrustStore: env.DOCKSCOPE_PLUGIN_CATALOG_TRUST,
    disableOfficial: env.DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG === '1',
  };
}

export function pluginCatalogSourceFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  return resolvePluginCatalogSource(pluginCatalogConfigurationFromEnv(env));
}

export function pluginCatalogLoadOptionsFromEnv(
  env: NodeJS.ProcessEnv,
  source: string,
): PluginCatalogLoadOptions {
  return resolvePluginCatalogLoadOptions(source, pluginCatalogConfigurationFromEnv(env));
}
