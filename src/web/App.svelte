<script lang="ts">
  import { onMount } from 'svelte';
  import { initDocker, getDockerState } from './stores/docker.svelte';
  import GraphView from './components/GraphView.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import KeyboardHelp from './components/KeyboardHelp.svelte';
  import ProjectManager from './components/ProjectManager.svelte';
  import HostManager from './components/HostManager.svelte';
  import PluginManager from './components/PluginManager.svelte';
  import PluginExtension from './components/PluginExtension.svelte';
  import Icon from './components/Icon.svelte';
  import ReplayBar from './components/ReplayBar.svelte';
  import Toast from './components/Toast.svelte';
  import { getRecorderState, togglePlay } from './stores/recorder.svelte';
  import { addToast } from './stores/toast.svelte';
  import { UI } from './lib/constants';
  import { buildScopeOptions, type StatusFilter } from './lib/graphFilters';
  import { resolveSelectedNode } from './lib/graphSelection';
  import type { ServiceNode } from '../types';
  import { pluginUiContextMatches, type PluginUiExtension } from '../core/plugin-ui';
  import {
    clearPluginFrontendCache,
    invokePluginUiAction,
    pluginUiContextFromNode,
  } from './lib/pluginUi';

  const DEFAULT_COLOR_NETWORKS = true;
  const docker = getDockerState();
  const recorder = getRecorderState();
  let selectedNode = $state<ServiceNode | null>(null);
  let searchQuery = $state('');
  let statusFilter = $state<Set<StatusFilter>>(new Set());
  let scopeFilter = $state('');
  let showHelp = $state(false);
  let showProjects = $state(false);
  let showHosts = $state(false);
  let showPlugins = $state(false);
  let colorNetworks = $state(DEFAULT_COLOR_NETWORKS);
  let pluginUiExtensions = $state<PluginUiExtension[]>([]);
  let showFilters = $state(false);
  let filterBtn = $state<HTMLElement | null>(null);
  let hudBar = $state<HTMLElement | null>(null);
  let searchInput = $state<HTMLInputElement | null>(null);
  let graphView: GraphView;

  // Resizable panel sizes
  let sidebarWidth: number = $state(UI.sidebar.default);
  let statusbarHeight: number = $state(UI.statusbar.default);
  let dragging = $state<'sidebar' | 'statusbar' | null>(null);
  let latestVersion = $state<string | null>(null);
  let scopeOptions = $derived(buildScopeOptions(docker.graph.nodes));
  let activeSelectedNode = $derived(resolveSelectedNode(docker.graph.nodes, selectedNode));
  let pluginUiContext = $derived(pluginUiContextFromNode(activeSelectedNode));
  let toolbarExtensions = $derived(
    pluginUiExtensions.filter(
      (extension) =>
        extension.slot === 'toolbar' && pluginUiContextMatches(extension, pluginUiContext),
    ),
  );
  let navigationExtensions = $derived(
    pluginUiExtensions.filter(
      (extension) =>
        extension.slot === 'navigation' && pluginUiContextMatches(extension, pluginUiContext),
    ),
  );
  let graphOverlayExtensions = $derived(
    pluginUiExtensions.filter(
      (extension) =>
        extension.slot === 'graphOverlay' && pluginUiContextMatches(extension, pluginUiContext),
    ),
  );

  $effect(() => {
    if (scopeFilter && !scopeOptions.some((option) => option.value === scopeFilter)) {
      scopeFilter = '';
    }
  });

  onMount(() => {
    // Check for updates
    fetch('/api/version')
      .then((r) => r.json())
      .then((d) => {
        if (d.latest && d.latest !== d.current) {
          latestVersion = d.latest;
        }
      })
      .catch(() => {});
    loadPluginUiExtensions();
    const cleanup = initDocker();
    return cleanup;
  });

  function loadPluginUiExtensions() {
    fetch('/api/plugins/ui')
      .then((r) => r.json())
      .then((data) => {
        pluginUiExtensions = Array.isArray(data) ? data : [];
      })
      .catch(() => {
        pluginUiExtensions = [];
      });
  }

  async function handlePluginAction(extension: PluginUiExtension, input?: unknown) {
    if (!extension.action) {
      showPlugins = true;
      return;
    }
    try {
      const result = await invokePluginUiAction(extension, pluginUiContext, input);
      if (result.type === 'open_url') {
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } else {
        addToast(result.result.message || extension.title, result.result.ok ? 'success' : 'error');
      }
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Plugin action failed', 'error');
    }
  }

  function closePluginManager() {
    showPlugins = false;
    clearPluginFrontendCache();
    loadPluginUiExtensions();
  }

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
      if (activeSelectedNode) {
        selectedNode = null;
        return;
      }
    }

    if (isInput) {
      return;
    }

    if (e.key === ' ' && recorder.replaying) {
      e.preventDefault();
      togglePlay();
    } else if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      searchInput?.focus();
    } else if (e.key === 'f' || e.key === 'F') {
      graphView?.zoomToFit();
    } else if (e.key === 'r' || e.key === 'R') {
      graphView?.resetCamera();
    } else if ((e.key === 'c' || e.key === 'C') && activeSelectedNode) {
      graphView?.centerOnNode(activeSelectedNode);
    } else if ((e.key === 'i' || e.key === 'I') && activeSelectedNode) {
      graphView?.toggleImpactMode();
    } else if (e.key === '?') {
      showHelp = !showHelp;
    }
  }

  function toggleStatusFilter(status: StatusFilter) {
    const next = new Set(statusFilter);
    next.has(status) ? next.delete(status) : next.add(status);
    statusFilter = next;
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
      selectedNode={activeSelectedNode}
      {searchQuery}
      {statusFilter}
      {scopeFilter}
      {colorNetworks}
      onHelpClick={() => (showHelp = !showHelp)}
    />
    <div class="graph-vignette"></div>
    <div class="graph-scanlines"></div>
  </div>

  <!-- HUD header overlay -->
  <div class="hud-bar" bind:this={hudBar}>
    <!-- Brand + status -->
    <div class="hud-group brand-group">
      <span class="hud-logo">DockScope</span>
      <span class="hud-version">v{__APP_VERSION__}</span>
      {#if latestVersion}
        <a
          class="hud-update"
          href="https://www.npmjs.com/package/dockscope"
          target="_blank"
          title="Update available: v{latestVersion}"
        >
          <span class="update-dot"></span>
        </a>
      {/if}
      <span
        class="hud-connection {docker.connected ? 'active' : 'disconnected'}"
        title={docker.connected
          ? 'DockScope is connected to the live Docker event stream'
          : 'DockScope is disconnected from the live Docker event stream'}
      >
        <span class="pulse-dot"></span>
      </span>
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

    {#if scopeOptions.length > 1}
      <div class="hud-group scope-group">
        <select class="scope-select" bind:value={scopeFilter} title="Graph scope">
          <option value="">All scopes</option>
          {#each scopeOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>
    {/if}

    <!-- Actions: projects + filters (compact) -->
    <div class="hud-group actions-group">
      {#each toolbarExtensions as extension}
        <button
          class="hud-icon-btn"
          onclick={() => handlePluginAction(extension)}
          title={extension.description ?? extension.title}
        >
          <Icon name="plug" size={12} />
        </button>
      {/each}
      <button class="hud-icon-btn" onclick={() => (showPlugins = true)} title="Plugins">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M8 3v4M16 3v4M7 7h10v5a5 5 0 0 1-10 0V7Z" />
          <path d="M12 17v4M8 21h8" />
        </svg>
      </button>
      <button class="hud-icon-btn" onclick={() => (showHosts = true)} title="Connections">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="2" y="2" width="20" height="8" rx="2" /><rect
            x="2"
            y="14"
            width="20"
            height="8"
            rx="2"
          />
          <circle cx="6" cy="6" r="1" fill="currentColor" /><circle
            cx="6"
            cy="18"
            r="1"
            fill="currentColor"
          />
        </svg>
      </button>
      {#if docker.composeEnabled}
        <button class="hud-icon-btn" onclick={() => (showProjects = true)} title="Compose projects">
          <svg
            width="12"
            height="12"
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
      {/if}
      {#if docker.graph.nodes.length > 0}
        <button
          class="hud-icon-btn"
          class:active={statusFilter.size > 0 ||
            Boolean(scopeFilter) ||
            colorNetworks !== DEFAULT_COLOR_NETWORKS}
          title="Filters"
          onclick={(e) => {
            filterBtn = e.currentTarget as HTMLElement;
            showFilters = !showFilters;
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line
              x1="10"
              y1="18"
              x2="14"
              y2="18"
            />
          </svg>
        </button>
      {/if}
    </div>
  </div>

  {#if navigationExtensions.length > 0}
    <nav class="plugin-nav-rail" aria-label="Plugin navigation">
      {#each navigationExtensions as extension (extension.pluginId + extension.id)}
        <button
          title={extension.description ?? extension.title}
          onclick={() => handlePluginAction(extension)}
        >
          <Icon name="plug" size={11} />
          <span>{extension.title}</span>
        </button>
      {/each}
    </nav>
  {/if}

  {#if graphOverlayExtensions.length > 0}
    <div class="plugin-overlay-stack">
      {#each graphOverlayExtensions as extension (extension.pluginId + extension.id)}
        <PluginExtension {extension} context={pluginUiContext} onAction={handlePluginAction} />
      {/each}
    </div>
  {/if}

  <!-- Filter dropdown (anchored to button) -->
  {#if showFilters && filterBtn}
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="filter-backdrop" onclick={() => (showFilters = false)} onkeydown={() => {}}></div>
    <div
      class="filter-dropdown"
      style="top: {(hudBar?.getBoundingClientRect().bottom ?? 0) + 8}px; right: {window.innerWidth -
        (hudBar?.getBoundingClientRect().right ?? 0)}px;"
    >
      <div class="filter-section">
        <span class="filter-heading">Status</span>
        <div class="filter-row">
          <button
            class="filter-pill"
            class:active={statusFilter.has('running')}
            onclick={() => toggleStatusFilter('running')}
          >
            <span class="dot green"></span> Running
          </button>
          <button
            class="filter-pill"
            class:active={statusFilter.has('stopped')}
            onclick={() => toggleStatusFilter('stopped')}
          >
            <span class="dot gray"></span> Stopped
          </button>
          <button
            class="filter-pill"
            class:active={statusFilter.has('unhealthy')}
            onclick={() => toggleStatusFilter('unhealthy')}
          >
            <span class="dot red"></span> Unhealthy
          </button>
        </div>
      </div>
      <div class="filter-section">
        <span class="filter-heading">Display</span>
        <div class="filter-row">
          <button
            class="filter-pill"
            class:active={colorNetworks}
            onclick={() => (colorNetworks = !colorNetworks)}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"><path d="M12 2v20M2 12h20" /></svg
            >
            Color networks
          </button>
        </div>
      </div>
    </div>
  {/if}

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
    <Sidebar
      node={activeSelectedNode}
      onClose={() => (selectedNode = null)}
      {colorNetworks}
      extensions={pluginUiExtensions}
      onPluginAction={handlePluginAction}
    />
  </div>

  <div class="statusbar-wrap" style="height: {statusbarHeight}px; right: {sidebarWidth}px;">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-handle-h" onmousedown={() => startDrag('statusbar')}></div>
    <StatusBar
      events={docker.events}
      graph={docker.graph}
      onSelectContainer={(node) => (selectedNode = node)}
    />
  </div>

  <!-- Replay timeline (visible while replaying a recording) -->
  <ReplayBar />

  <!-- Toast notifications -->
  <Toast />

  <!-- Modals -->
  {#if showHelp}
    <KeyboardHelp onClose={() => (showHelp = false)} />
  {/if}
  {#if showProjects}
    <ProjectManager onClose={() => (showProjects = false)} />
  {/if}
  {#if showHosts}
    <HostManager onClose={() => (showHosts = false)} />
  {/if}
  {#if showPlugins}
    <PluginManager onClose={closePluginManager} />
  {/if}
</div>
