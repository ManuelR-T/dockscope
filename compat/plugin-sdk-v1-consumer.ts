import {
  definePluginFactory,
  definePluginManifest,
  type EntityActionProvider,
  type GraphSourceAdapter,
} from 'dockscope/plugin-sdk/v1';

const manifest = definePluginManifest({
  id: 'compat.consumer',
  name: 'Compatibility Consumer',
  version: '1.0.0',
  manifestVersion: '1',
  dockscopeApiVersion: '1',
  hostApiVersion: '1',
  entry: './plugin.mjs',
  capabilities: ['source.graph', 'action.lifecycle'],
  permissions: [],
});

const graphProvider: GraphSourceAdapter = {
  describe: () => ({
    id: 'compat.graph',
    label: 'Compatibility graph',
    kind: 'plugin',
    pluginId: manifest.id,
    capabilities: ['source.graph'],
    status: 'connected',
  }),
  collectGraph: async () => ({
    source: graphProvider.describe(),
    graph: { nodes: [], links: [] },
    collectedAt: Date.now(),
  }),
};

const actionProvider: EntityActionProvider = {
  canHandle: () => true,
  listActions: async () => [],
  runAction: async () => ({ ok: true }),
};

export default definePluginFactory(({ manifest: validatedManifest }) => ({
  manifest: validatedManifest,
  getGraphSources: () => [graphProvider],
  getActionProviders: () => [actionProvider],
}));
