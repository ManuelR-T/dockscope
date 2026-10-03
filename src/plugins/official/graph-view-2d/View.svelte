<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    PluginFrontendApi,
    PluginGraphViewState,
    PluginGraphViewControl,
    PluginGraphViewShortcut,
  } from '../../../core/plugin-contract/ui';
  import { GRAPH_VIEW_SHORTCUTS } from '../../../core/plugin-contract/ui';
  import GraphView from './GraphView.svelte';

  let { api }: { api: PluginFrontendApi } = $props();
  let snapshot = $state<Readonly<PluginGraphViewState> | null>(null);
  let graphView = $state<GraphView>();
  const statusKey = $derived(JSON.stringify(snapshot?.filters.statusFilter ?? []));
  const statusFilter = $derived(
    new Set<'running' | 'stopped' | 'unhealthy'>(JSON.parse(statusKey)),
  );
  const selectedNode = $derived(
    snapshot?.graph.nodes.find((node) => node.id === snapshot?.selectedNodeId) ?? null,
  );

  function control(command: PluginGraphViewControl) {
    if (command === 'fit') {
      graphView?.zoomToFit();
    }
    if (command === 'reset') {
      graphView?.resetCamera();
    }
    if (command === 'focus' && selectedNode) {
      graphView?.centerOnNode(selectedNode);
    }
    if (command === 'impact') {
      graphView?.toggleImpactMode();
    }
  }

  onMount(() => {
    const graph = api.graph!;
    const unsubscribe = graph.subscribe((state) => (snapshot = state));
    const stopControls = graph.onControl(control);
    const keyboard = (event: KeyboardEvent) => {
      if ((event.target as Element)?.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        graph.requestShortcut('/');
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (!(GRAPH_VIEW_SHORTCUTS as readonly string[]).includes(key)) {
        return;
      }
      event.preventDefault();
      graph.requestShortcut(key as PluginGraphViewShortcut);
    };
    window.addEventListener('keydown', keyboard);
    return () => {
      unsubscribe();
      stopControls();
      window.removeEventListener('keydown', keyboard);
    };
  });
</script>

{#if snapshot}
  <GraphView
    bind:this={graphView}
    data={snapshot.graph}
    {selectedNode}
    searchQuery={snapshot.filters.searchQuery}
    {statusFilter}
    scopeFilter={snapshot.filters.scopeFilter}
    colorNetworks={snapshot.colorNetworks}
    anomalyIds={new Set(snapshot.anomalyEntityIds)}
    onNodeClick={(node) => api.graph!.selectNode(node.id)}
    onHelpClick={() => api.graph!.requestShortcut('?')}
  />
{/if}

<style>
  :global(html),
  :global(body),
  :global(#plugin-root) {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
</style>
