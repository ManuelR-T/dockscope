<script lang="ts">
  import { onMount } from 'svelte';
  import { initDocker, getDockerState } from './stores/docker.svelte';
  import GraphView from './components/GraphView.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import KeyboardHelp from './components/KeyboardHelp.svelte';
  import ProjectManager from './components/ProjectManager.svelte';
  import Toast from './components/Toast.svelte';
  import { UI } from './lib/constants';
  import type { ServiceNode } from '../types';

  const docker = getDockerState();
  let selectedNode = $state<ServiceNode | null>(null);
  let searchQuery = $state('');
  let statusFilter = $state<Set<string>>(new Set());
  let showHelp = $state(false);
  let showProjects = $state(false);
  let colorNetworks = $state(true);
  let searchInput = $state<HTMLInputElement | null>(null);
  let graphView: GraphView;

  // Resizable panel sizes
  let sidebarWidth: number = $state(UI.sidebar.default);
  let statusbarHeight: number = $state(UI.statusbar.default);
  let dragging = $state<'sidebar' | 'statusbar' | null>(null);

  onMount(() => {
    const cleanup = initDocker();
    return cleanup;
  });

  function handleKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA';

    if (e.key === 'Escape') {
      if (showHelp) {
        showHelp = false;
        return;
      }
      if (searchQuery) {
        searchQuery = '';
        searchInput?.blur();
        return;
      }
      if (selectedNode) {
        selectedNode = null;
        return;
      }
    }

    if (isInput) return;

    if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      searchInput?.focus();
    } else if (e.key === 'f' || e.key === 'F') {
      graphView?.zoomToFit();
    } else if (e.key === 'r' || e.key === 'R') {
      graphView?.resetCamera();
    } else if ((e.key === 'c' || e.key === 'C') && selectedNode) {
      graphView?.centerOnNode(selectedNode);
    } else if (e.key === '?') {
      showHelp = !showHelp;
    }
  }

  function startDrag(panel: 'sidebar' | 'statusbar') {
    dragging = panel;

    const onMove = (e: MouseEvent) => {
      if (panel === 'sidebar') {
        const w = window.innerWidth - e.clientX;
        sidebarWidth = Math.max(UI.sidebar.min, Math.min(UI.sidebar.max, w));
      } else {
        const h = window.innerHeight - e.clientY;
        statusbarHeight = Math.max(UI.statusbar.min, Math.min(UI.statusbar.max, h));
      }
    };

    const onUp = () => {
      dragging = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="app"
  class:is-dragging={dragging !== null}
  style="--sidebar-w: {sidebarWidth}px; --statusbar-h: {statusbarHeight}px;"
>
  <!-- Full-screen 3D graph layer -->
  <div class="graph-layer">
    <GraphView
      bind:this={graphView}
      data={docker.graph}
      onNodeClick={(node) => (selectedNode = node)}
      {selectedNode}
      {searchQuery}
      {statusFilter}
      {colorNetworks}
      onHelpClick={() => (showHelp = !showHelp)}
    />
    <div class="graph-vignette"></div>
    <div class="graph-scanlines"></div>
  </div>

  <!-- HUD header overlay -->
  <div class="hud-bar">
    <!-- Brand cluster -->
    <div class="hud-group brand-group">
      <span class="hud-logo">DockScope</span>
      <span class="hud-version">v{__APP_VERSION__}</span>
    </div>

    <!-- Status + actions cluster -->
    <div class="hud-group">
      <span class="hud-connection {docker.connected ? 'active' : 'disconnected'}">
        <span class="pulse-dot"></span>
        {docker.connected ? 'Live' : 'Offline'}
      </span>
      <button class="hud-icon-btn" onclick={() => (showProjects = true)} title="Compose projects">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect
            x="3"
            y="14"
            width="7"
            height="7"
          /><rect x="14" y="14" width="7" height="7" />
        </svg>
      </button>
    </div>

    <!-- Search -->
    <div class="hud-group search-group">
      <div class="search-container">
        <svg
          class="search-icon"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <input
          bind:this={searchInput}
          type="text"
          class="search-input"
          placeholder="Search  /"
          bind:value={searchQuery}
        />
        {#if searchQuery}
          <button
            class="search-clear"
            onclick={() => {
              searchQuery = '';
              searchInput?.blur();
            }}>&times;</button
          >
        {/if}
      </div>
    </div>

    <!-- Filter chips -->
    {#if docker.graph.nodes.length > 0}
      <div class="hud-group filter-group">
        <button
          class="filter-chip"
          class:active={statusFilter.has('running')}
          title="Filter running"
          onclick={() => {
            const s = new Set(statusFilter);
            s.has('running') ? s.delete('running') : s.add('running');
            statusFilter = s;
          }}><span class="dot green"></span></button
        >
        <button
          class="filter-chip"
          class:active={statusFilter.has('stopped')}
          title="Filter stopped"
          onclick={() => {
            const s = new Set(statusFilter);
            s.has('stopped') ? s.delete('stopped') : s.add('stopped');
            statusFilter = s;
          }}><span class="dot gray"></span></button
        >
        <button
          class="filter-chip"
          class:active={statusFilter.has('unhealthy')}
          title="Filter unhealthy"
          onclick={() => {
            const s = new Set(statusFilter);
            s.has('unhealthy') ? s.delete('unhealthy') : s.add('unhealthy');
            statusFilter = s;
          }}><span class="dot red"></span></button
        >
        <button
          class="filter-chip net-toggle"
          class:active={colorNetworks}
          title="Color networks"
          onclick={() => colorNetworks = !colorNetworks}
        ><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 20h16M4 20V4m16 16V4"/></svg></button>
      </div>
    {/if}
  </div>

  <!-- Overlay: empty state -->
  {#if docker.connected && docker.graph.nodes.length === 0}
    <div class="empty-state">
      <h2>No containers detected</h2>
      <p>Launch a Docker stack and watch it materialize.</p>
      <code>docker compose up -d</code>
    </div>
  {/if}

  <!-- Floating panels with resize handles -->
  <div class="sidebar-wrap" style="width: {sidebarWidth}px;">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-handle-v" onmousedown={() => startDrag('sidebar')}></div>
    <Sidebar node={selectedNode} onClose={() => (selectedNode = null)} {colorNetworks} />
  </div>

  <div class="statusbar-wrap" style="height: {statusbarHeight}px; right: {sidebarWidth}px;">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-handle-h" onmousedown={() => startDrag('statusbar')}></div>
    <StatusBar events={docker.events} graph={docker.graph} onSelectContainer={(node) => (selectedNode = node)} />
  </div>

  <!-- Toast notifications -->
  <Toast />

  <!-- Modals -->
  {#if showHelp}
    <KeyboardHelp onClose={() => (showHelp = false)} />
  {/if}
  {#if showProjects}
    <ProjectManager onClose={() => (showProjects = false)} />
  {/if}
</div>
