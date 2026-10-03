<script lang="ts">
  import type { GraphData, ServiceNode } from '../../types';
  import type { PluginGraphViewShortcut, PluginUiExtension } from '../../core/plugin-contract/ui';
  import type { StatusFilter } from '../lib/graphFilters';
  import { graphViewState, resolveGraphViewSelection } from '../lib/pluginGraphView';
  import { getDockerState } from '../stores/docker.svelte';
  import PluginFrame from './PluginFrame.svelte';

  interface Props {
    extension: PluginUiExtension;
    data: GraphData;
    selectedNode: ServiceNode | null;
    searchQuery: string;
    statusFilter: Set<StatusFilter>;
    scopeFilter: string;
    colorNetworks: boolean;
    onNodeClick: (node: ServiceNode | null) => void;
    onShortcut: (key: PluginGraphViewShortcut) => void;
    onError: (message: string) => void;
  }
  let {
    extension,
    data,
    selectedNode,
    searchQuery,
    statusFilter,
    scopeFilter,
    colorNetworks,
    onNodeClick,
    onShortcut,
    onError,
  }: Props = $props();
  let frame = $state<PluginFrame>();
  const docker = getDockerState();
  const snapshot = $derived(
    graphViewState(
      data,
      selectedNode,
      { searchQuery, statusFilter, scopeFilter },
      colorNetworks,
      docker.replayMode,
      [...docker.anomalies.values()].map((anomaly) => anomaly.containerId),
    ),
  );

  function select(id: string | null) {
    const node = resolveGraphViewSelection(data, id);
    if (node !== undefined) {
      onNodeClick(node);
    }
  }
  export function zoomToFit() {
    frame?.sendGraphControl('fit');
  }
  export function resetCamera() {
    frame?.sendGraphControl('reset');
  }
  export function centerOnNode(_node: ServiceNode) {
    frame?.sendGraphControl('focus');
  }
  export function toggleImpactMode() {
    frame?.sendGraphControl('impact');
  }
</script>

<div class="plugin-graph-view">
  <PluginFrame
    bind:this={frame}
    {extension}
    context={{}}
    actionAllowed={false}
    onAction={() => {}}
    graphState={snapshot}
    onGraphSelect={select}
    onGraphShortcut={onShortcut}
    onGraphError={onError}
  />
</div>

<style>
  .plugin-graph-view {
    width: 100%;
    height: 100%;
  }
</style>
