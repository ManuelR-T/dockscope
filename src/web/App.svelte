<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { initDocker, getDockerState, setHandshakeRefusedHandler } from './stores/docker.svelte';
  import { setUnauthorizedHandler } from './lib/api';
  import GraphView from './components/GraphView.svelte';
  import PluginGraphView from './components/PluginGraphView.svelte';
  import { graphViewKey } from './lib/pluginGraphView';
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
  import TokenGate from './components/TokenGate.svelte';
  import SecurityPanel from './components/SecurityPanel.svelte';
  import WebhookPanel from './components/WebhookPanel.svelte';
  import Tooltip from './components/Tooltip.svelte';
  import {
    checkAuth,
    closeSecurityPanel,
    gateMode,
    getAuthState,
    openSecurityPanel,
  } from './stores/auth.svelte';
  import { Button, IconButton, Select } from './components/ui';
  import { getRecorderState, togglePlay } from './stores/recorder.svelte';
  import { addToast } from './stores/toast.svelte';
  import { UI } from './lib/constants';
  import { buildScopeOptions, type StatusFilter } from './lib/graphFilters';
  import { resolveSelectedNode } from './lib/graphSelection';
  import type { ServiceNode } from '../types';
  import {
    pluginUiContextMatches,
    pluginUiContextFromNode,
    type PluginUiExtension,
  } from '../core/plugin-contract/ui';
  import { clearPluginFrontendCache, invokePluginUiAction } from './lib/pluginUi';
  import { pluginUiExtensionAllowed, type AccessRole } from '../core/access';

  const DEFAULT_COLOR_NETWORKS = true;
  const docker = getDockerState();
  const recorder = getRecorderState();
  const auth = getAuthState();
  let selectedNode = $state<ServiceNode | null>(null);
  let searchQuery = $state('');
  let statusFilter = $state<Set<StatusFilter>>(new Set());
  let scopeFilter = $state('');
  let showHelp = $state(false);
  let showProjects = $state(false);
  let showHosts = $state(false);
  let showWebhook = $state(false);
  let showPlugins = $state(false);
  let colorNetworks = $state(DEFAULT_COLOR_NETWORKS);
  let pluginUiExtensions = $state<PluginUiExtension[]>([]);
  let showSearch = $state(false);
  let showTools = $state(false);
  let searchButton = $state<HTMLButtonElement | null>(null);
  let toolsButton = $state<HTMLButtonElement | null>(null);
  const activeFilterCount = $derived(
    Number(Boolean(searchQuery)) +
      Number(Boolean(scopeFilter)) +
      statusFilter.size +
      Number(colorNetworks !== DEFAULT_COLOR_NETWORKS),
  );
  let searchInput = $state<HTMLInputElement | null>(null);
  let viewMode = $state('3d');
  let graphView = $state<GraphView | PluginGraphView>();

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
        extension.slot === 'toolbar' &&
        pluginUiContextMatches(extension, pluginUiContext) &&
        pluginUiExtensionAllowed(auth.role, extension.action),
    ),
  );
  let navigationExtensions = $derived(
    pluginUiExtensions.filter(
      (extension) =>
        extension.slot === 'navigation' &&
        pluginUiContextMatches(extension, pluginUiContext) &&
        pluginUiExtensionAllowed(auth.role, extension.action),
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

  let cleanupDocker: (() => void) | undefined;

  const graphViews = $derived(
    pluginUiExtensions.filter(
      (extension) =>
        extension.slot === 'graphView' &&
        extension.frontendView &&
        pluginUiExtensionAllowed(auth.role, extension.action),
    ),
  );
  const activeGraphView = $derived(
    graphViews.find((extension) => graphViewKey(extension) === viewMode),
  );
  $effect(() => {
    if (viewMode !== '3d' && !activeGraphView) {
      viewMode = '3d';
    }
  });

  const securedInstance = $derived(auth.required || auth.viaProxy);

  /**
   * Nothing is fetched or connected until the token check answers: starting the
   * WebSocket first would just produce a stream of rejected handshakes behind
   * the prompt.
   */
  function startSession() {
    if (cleanupDocker) {
      return;
    }
    fetch('/api/version')
      .then((r) => r.json())
      .then((d) => {
        if (d.latest && d.latest !== d.current) {
          latestVersion = d.latest;
        }
      })
      .catch(() => {});
    loadPluginUiExtensions();
    const stopDocker = initDocker();
    const refreshViews = window.setInterval(loadPluginUiExtensions, 5000);
    cleanupDocker = () => {
      stopDocker();
      window.clearInterval(refreshViews);
    };
  }

  /**
   * Credentials stopped working: re-check, and if we really are locked out,
   * stop the live session so it is not reconnecting behind the prompt.
   *
   * Guarded on `authenticated` so a server that is merely down does not mean a
   * status request on every reconnect attempt.
   */
  function recheckAuth() {
    if (!auth.authenticated) {
      return;
    }
    checkAuth().then((status) => {
      if (status.required && !status.authenticated) {
        cleanupDocker?.();
        cleanupDocker = undefined;
      }
    });
  }

  onMount(() => {
    setUnauthorizedHandler(recheckAuth);
    setHandshakeRefusedHandler(recheckAuth);

    // The first-run setup screen appears over a working dashboard: no token is
    // configured yet, so there is nothing to be shut out of. Only the login
    // gate holds the session back.
    checkAuth().then(() => {
      if (gateMode() !== 'login') {
        startSession();
      }
    });
    return () => {
      setUnauthorizedHandler(null);
      setHandshakeRefusedHandler(null);
      cleanupDocker?.();
      cleanupDocker = undefined;
    };
  });

  function loadPluginUiExtensions() {
    fetch('/api/plugins/ui')
      .then((r) => r.json())
      .then((data) => {
        pluginUiExtensions = Array.isArray(data) ? data : [];
      })
      .catch(() => {
        // Preserve available views during a temporary transport failure.
      });
  }

  async function handlePluginAction(extension: PluginUiExtension, input?: unknown) {
    if (!pluginUiExtensionAllowed(auth.role, extension.action)) {
      addToast('Operator access required', 'error');
      return;
    }
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
    if (showWebhook) {
      return;
    }
    const isInput = (e.target as Element)?.closest?.(
      'input, textarea, select, [contenteditable="true"]',
    );

    if (e.key === 'Escape') {
      if (showSearch || showTools) {
        e.preventDefault();
        const button = showSearch ? searchButton : toolsButton;
        showSearch = false;
        showTools = false;
        button?.focus();
        return;
      }
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
      void openSearch();
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

  async function openSearch() {
    showTools = false;
    showSearch = true;
    await tick();
    searchInput?.focus();
  }

  function closeToolbar() {
    const button = showSearch ? searchButton : toolsButton;
    showSearch = false;
    showTools = false;
    button?.focus();
  }

  function openTool(action: () => void) {
    showTools = false;
    action();
  }

  function resetFilters() {
    searchQuery = '';
    scopeFilter = '';
    statusFilter = new Set();
    colorNetworks = DEFAULT_COLOR_NETWORKS;
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

{#if gateMode() === 'setup'}
  <TokenGate mode="setup" onDone={() => {}} />
{:else if gateMode() === 'login'}
  <TokenGate mode="login" onDone={startSession} />
{/if}

<div
  class="app"
  class:is-dragging={dragging !== null}
  style="--sidebar-w: {sidebarWidth}px; --statusbar-h: {statusbarHeight}px;"
>
  <!-- Both renderers share the live/replayed graph, filters and selection. -->
  <div class="graph-layer">
    {#if viewMode === '3d'}
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
    {:else if activeGraphView}
      {#key graphViewKey(activeGraphView)}
        <PluginGraphView
          bind:this={graphView}
          extension={activeGraphView}
          data={docker.graph}
          onNodeClick={(node) => (selectedNode = node)}
          selectedNode={activeSelectedNode}
          {searchQuery}
          {statusFilter}
          {scopeFilter}
          {colorNetworks}
          onShortcut={(key) => handleKeydown(new KeyboardEvent('keydown', { key }))}
          onError={(message) => {
            addToast(`Graph view unavailable: ${message}`, 'error');
            viewMode = '3d';
          }}
        />
      {/key}
    {/if}
  </div>

  <!-- HUD header overlay -->
  <div class="hud-bar">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scroll region is focusable for keyboard scrolling.) -->
    <div class="hud-scroll" role="region" aria-label="Main navigation" tabindex="0">
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

      <div class="view-switch" role="group" aria-label="Graph view">
        <button
          class:active={viewMode === '3d'}
          aria-pressed={viewMode === '3d'}
          onclick={() => (viewMode = '3d')}>3D</button
        >
        {#each graphViews as extension (graphViewKey(extension))}
          <button
            class:active={viewMode === graphViewKey(extension)}
            aria-pressed={viewMode === graphViewKey(extension)}
            title={extension.description ?? extension.title}
            onclick={() => (viewMode = graphViewKey(extension))}>{extension.title}</button
          >
        {/each}
      </div>

      <div class="hud-group actions-group">
        {#if auth.role === 'reader'}
          <span class="read-only-badge">Read-only</span>
        {/if}
        <button
          bind:this={searchButton}
          class="hud-tool-button"
          class:active={showSearch || activeFilterCount > 0}
          aria-label="Search and filters"
          aria-expanded={showSearch}
          aria-controls="graph-search-panel"
          title={activeFilterCount
            ? `Search and filters · ${activeFilterCount} active`
            : 'Search and filters /'}
          onclick={() => (showSearch ? closeToolbar() : openSearch())}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
          >
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          {#if activeFilterCount > 0}<span class="filter-count">{activeFilterCount}</span>{/if}
        </button>
        <button
          bind:this={toolsButton}
          class="hud-tool-button"
          class:active={showTools}
          aria-label="More tools"
          aria-expanded={showTools}
          aria-controls="graph-tools-panel"
          title="More tools"
          onclick={() => {
            showSearch = false;
            showTools = !showTools;
          }}><Icon name="dots" size={16} /></button
        >
      </div>
    </div>

    {#if showSearch}
      <section
        class="hud-popover search-panel"
        id="graph-search-panel"
        aria-label="Search and filters"
      >
        <div class="search-panel-header">
          <span class="filter-heading">Search and filters</span>
          <IconButton title="Close search and filters" size={22} onclick={closeToolbar}
            >&times;</IconButton
          >
        </div>
        <div class="search-container">
          <input
            bind:this={searchInput}
            type="search"
            class="search-input"
            placeholder="Service, image, namespace…"
            aria-label="Search services"
            bind:value={searchQuery}
          />
        </div>
        {#if scopeOptions.length > 1}
          <div class="filter-section">
            <span class="filter-heading">Scope</span>
            <Select
              variant="hud"
              bind:value={scopeFilter}
              ariaLabel="Graph scope"
              options={[{ value: '', label: 'All scopes' }, ...scopeOptions]}
            />
          </div>
        {/if}
        <div class="filter-section">
          <span class="filter-heading">Status</span>
          <div class="filter-row">
            <Button
              variant="ghost"
              size="sm"
              active={statusFilter.has('running')}
              onclick={() => toggleStatusFilter('running')}
              ><span class="dot green"></span> Running</Button
            >
            <Button
              variant="ghost"
              size="sm"
              active={statusFilter.has('stopped')}
              onclick={() => toggleStatusFilter('stopped')}
              ><span class="dot gray"></span> Stopped</Button
            >
            <Button
              variant="ghost"
              size="sm"
              active={statusFilter.has('unhealthy')}
              onclick={() => toggleStatusFilter('unhealthy')}
              ><span class="dot red"></span> Unhealthy</Button
            >
          </div>
        </div>
        <div class="filter-row">
          <Button
            variant="ghost"
            size="sm"
            active={colorNetworks}
            onclick={() => (colorNetworks = !colorNetworks)}>Color networks</Button
          >
          {#if activeFilterCount > 0}<Button variant="ghost" size="sm" onclick={resetFilters}
              >Reset filters</Button
            >{/if}
        </div>
      </section>
    {/if}

    {#if showTools}
      <section class="hud-popover tools-panel" id="graph-tools-panel" aria-label="More tools">
        <button class="hud-menu-item" onclick={() => openTool(openSecurityPanel)}>
          <span>Security</span><span class="tool-note" class:unsecured={!securedInstance}
            >{securedInstance ? 'Secured' : 'No token'}</span
          >
        </button>
        {#if auth.role === 'operator'}
          <button class="hud-menu-item" onclick={() => openTool(() => (showWebhook = true))}
            >Webhook alerts</button
          >
        {/if}
        <button class="hud-menu-item" onclick={() => openTool(() => (showPlugins = true))}
          >Plugins</button
        >
        <button class="hud-menu-item" onclick={() => openTool(() => (showHosts = true))}
          >Connections</button
        >
        {#if docker.composeEnabled}
          <button class="hud-menu-item" onclick={() => openTool(() => (showProjects = true))}
            >Compose projects</button
          >
        {/if}
        <button class="hud-menu-item" onclick={() => openTool(() => (showHelp = true))}
          >Keyboard shortcuts <span class="tool-note">?</span></button
        >
        {#each toolbarExtensions as extension}
          <button
            class="hud-menu-item"
            title={extension.description}
            onclick={() =>
              openTool(() => {
                void handlePluginAction(extension);
              })}
          >
            <Icon name="plug" size={12} />
            {extension.title}
          </button>
        {/each}
      </section>
    {/if}
  </div>

  {#if showSearch || showTools}
    <button class="hud-backdrop" aria-label="Close toolbar popup" onclick={closeToolbar}></button>
  {/if}

  {#if navigationExtensions.length > 0}
    <nav class="plugin-nav-rail" aria-label="Plugin navigation">
      {#each navigationExtensions as extension (extension.pluginId + extension.id)}
        <Button
          variant="surface"
          size="sm"
          title={extension.description ?? extension.title}
          onclick={() => handlePluginAction(extension)}
        >
          <Icon name="plug" size={11} />
          <span class="nav-rail-label">{extension.title}</span>
        </Button>
      {/each}
    </nav>
  {/if}

  {#if graphOverlayExtensions.length > 0}
    <div class="plugin-overlay-stack">
      {#each graphOverlayExtensions as extension (extension.pluginId + extension.id)}
        <PluginExtension
          {extension}
          context={pluginUiContext}
          role={auth.role as AccessRole | null}
          onAction={handlePluginAction}
        />
      {/each}
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
      role={auth.role as AccessRole | null}
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
    <ProjectManager role={auth.role as AccessRole | null} onClose={() => (showProjects = false)} />
  {/if}
  {#if showHosts}
    <HostManager role={auth.role as AccessRole | null} onClose={() => (showHosts = false)} />
  {/if}
  {#if showPlugins}
    <PluginManager role={auth.role as AccessRole | null} onClose={closePluginManager} />
  {/if}
  {#if showWebhook && auth.role === 'operator'}
    <WebhookPanel onClose={() => (showWebhook = false)} />
  {/if}
  {#if auth.panelOpen}
    <SecurityPanel onClose={closeSecurityPanel} />
  {/if}
</div>

<!-- One shared bubble for every `use:tooltip` in the app, at the document root
     so no clipping or containing-block ancestor can trap it. -->
<Tooltip />
