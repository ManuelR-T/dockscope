import type { PluginCatalog, PluginCatalogEntry } from './catalog.js';

// Frozen vocabulary understood by DockScope <= 0.11. Do not derive this from the
// current host's capabilities: publishing a new capability must not break old hosts.
const LEGACY_CAPABILITIES = new Set([
  'source.graph',
  'source.metrics',
  'source.events',
  'source.logs',
  'source.inspect',
  'source.inventory',
  'source.relationships',
  'source.system',
  'source.connections',
  'action.lifecycle',
  'action.exec',
  'action.filesystem',
  'action.deploy',
  'action.scale',
  'action.remediate',
  'analysis.diagnostics',
  'analysis.anomalies',
  'analysis.health',
  'analysis.policy',
  'analysis.cost',
  'analysis.recommendations',
  'ui.nodePanel',
  'ui.nodeAction',
  'ui.sidebarPanel',
  'ui.navigation',
  'ui.graphOverlay',
  'ui.toolbarAction',
  'ui.settings',
  'ui.command',
  'ui.frontend',
  'integration.export',
  'integration.import',
  'integration.webhook',
  'integration.search',
  'integration.alerts',
]);
const LEGACY_PERMISSIONS = new Set([
  'docker.socket',
  'kubernetes.api',
  'network.local',
  'network.http',
  'filesystem.read',
  'filesystem.write',
  'process.exec',
  'secrets.read',
]);

export function legacyCatalogEntrySupported(entry: PluginCatalogEntry): boolean {
  return (
    entry.capabilities.every((value) => LEGACY_CAPABILITIES.has(value)) &&
    entry.permissions.every((value) => LEGACY_PERMISSIONS.has(value))
  );
}

/** One set of packages and trust metadata, two independently signed documents. */
export function pluginCatalogChannels(catalog: PluginCatalog): {
  legacy: PluginCatalog;
  current: PluginCatalog;
} {
  return {
    legacy: {
      ...catalog,
      signature: undefined,
      entries: catalog.entries.filter(legacyCatalogEntrySupported),
    },
    current: {
      ...catalog,
      signature: undefined,
      entries: catalog.entries.map((entry) => ({
        ...entry,
        // The current catalog lives in v2/; package artifacts remain shared at packages/.
        packageUrl: entry.packageUrl.startsWith('./packages/')
          ? `.${entry.packageUrl}`
          : entry.packageUrl,
      })),
    },
  };
}
