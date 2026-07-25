// Loading and merging of multiple plugin catalogs.
//
// A DockScope instance browses the pinned official catalog plus any configured
// third-party catalogs at the same time. Each catalog is loaded and verified
// independently so one unreachable or untrusted source cannot hide the others,
// and every merged entry keeps a reference to the catalog it came from, which
// installs need in order to fetch from the right place.

import { loadPluginCatalog, type ResolvedPluginCatalogEntry } from './catalog.js';
import {
  OFFICIAL_PLUGIN_CATALOG_NAME,
  OFFICIAL_PLUGIN_CATALOG_URL,
  resolvePluginCatalogLoadOptions,
  resolvePluginCatalogSources,
  type PluginCatalogConfiguration,
} from './catalogConfig.js';
import { errorMessage } from '../utils.js';

export interface PluginCatalogSourceStatus {
  source: string;
  name?: string;
  official: boolean;
  signatureVerified?: boolean;
  entryCount: number;
  error?: string;
}

export interface AggregatedPluginCatalogEntry {
  entry: ResolvedPluginCatalogEntry;
  source: string;
  catalogName?: string;
  official: boolean;
  catalogSignatureVerified?: boolean;
}

export interface AggregatedPluginCatalogs {
  /** Every configured source, in resolution order, whether or not it loaded. */
  catalogs: readonly PluginCatalogSourceStatus[];
  /** Merged entries; the first catalog providing an id wins. */
  entries: readonly AggregatedPluginCatalogEntry[];
  /** Ids that appeared in more than one catalog, and were taken from the first. */
  shadowedIds: readonly string[];
}

export async function loadAggregatedPluginCatalogs(
  configuration: PluginCatalogConfiguration,
): Promise<AggregatedPluginCatalogs> {
  const sources = resolvePluginCatalogSources(configuration);

  const loaded = await Promise.all(
    sources.map(async (source) => {
      const official = source === OFFICIAL_PLUGIN_CATALOG_URL;
      try {
        const catalog = await loadPluginCatalog(
          source,
          resolvePluginCatalogLoadOptions(source, configuration),
        );
        return { source, official, catalog };
      } catch (error) {
        return { source, official, error: errorMessage(error) };
      }
    }),
  );

  const catalogs: PluginCatalogSourceStatus[] = [];
  const entries: AggregatedPluginCatalogEntry[] = [];
  const shadowedIds: string[] = [];
  const seen = new Set<string>();

  for (const result of loaded) {
    if (!result.catalog) {
      catalogs.push({
        source: result.source,
        name: result.official ? OFFICIAL_PLUGIN_CATALOG_NAME : undefined,
        official: result.official,
        entryCount: 0,
        error: result.error,
      });
      continue;
    }

    const { catalog } = result;
    catalogs.push({
      source: result.source,
      name: catalog.name,
      official: result.official,
      signatureVerified: catalog.signatureVerified,
      entryCount: catalog.entries.length,
    });

    for (const entry of catalog.entries) {
      if (seen.has(entry.id)) {
        shadowedIds.push(entry.id);
        continue;
      }
      seen.add(entry.id);
      entries.push({
        entry,
        source: result.source,
        catalogName: catalog.name,
        official: result.official,
        catalogSignatureVerified: catalog.signatureVerified,
      });
    }
  }

  return { catalogs, entries, shadowedIds };
}

export function findAggregatedEntry(
  aggregated: AggregatedPluginCatalogs,
  pluginId: string,
): AggregatedPluginCatalogEntry | undefined {
  return aggregated.entries.find((candidate) => candidate.entry.id === pluginId);
}
