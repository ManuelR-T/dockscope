import type { GraphData, ServiceNode } from '../../types';
import type { PluginGraphViewState, PluginUiExtension } from '../../core/plugin-contract/ui';
import type { GraphFilters } from './graphFilters';
import { sanitizeGraph } from './recording';

export function graphViewKey(extension: Pick<PluginUiExtension, 'pluginId' | 'id'>): string {
  return `${extension.pluginId}/${extension.id}`;
}

/** Serialize only the display model. Three.js objects, credentials and inspect data stay in the host. */
export function graphViewState(
  graph: GraphData,
  selectedNode: ServiceNode | null,
  filters: GraphFilters,
  colorNetworks: boolean,
  replayMode: boolean,
  anomalyEntityIds: Iterable<string>,
): PluginGraphViewState {
  return {
    graph: sanitizeGraph(graph),
    selectedNodeId: selectedNode?.id ?? null,
    filters: {
      searchQuery: filters.searchQuery,
      statusFilter: [...filters.statusFilter],
      scopeFilter: filters.scopeFilter,
    },
    colorNetworks,
    replayMode,
    anomalyEntityIds: [...new Set(anomalyEntityIds)],
  };
}

/** Unknown IDs must not turn a plugin message into an arbitrary inspect/API target. */
export function resolveGraphViewSelection(
  graph: GraphData,
  id: string | null,
): ServiceNode | null | undefined {
  return id === null ? null : graph.nodes.find((node) => node.id === id);
}
