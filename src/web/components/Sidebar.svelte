<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { subscribeLogs, unsubscribeLogs, addToast, addDiagnostic, removeDiagnostic, removeAnomaly, getAnomaliesForContainer } from '../stores/docker.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import SidebarInfo from './sidebar/SidebarInfo.svelte';
  import SidebarEnv from './sidebar/SidebarEnv.svelte';
  import SidebarLogs from './sidebar/SidebarLogs.svelte';
  import SidebarTop from './sidebar/SidebarTop.svelte';
  import SidebarDiff from './sidebar/SidebarDiff.svelte';
  import SidebarExec from './sidebar/SidebarExec.svelte';
  import SidebarDiagnostic from './sidebar/SidebarDiagnostic.svelte';
  import SidebarAnomaly from './sidebar/SidebarAnomaly.svelte';
  import { getDockerState } from '../stores/docker.svelte';
  import type { ServiceNode, ContainerStats, ContainerInspect, MetricPoint } from '../../types';

  const docker = getDockerState();

  interface Props {
    node: ServiceNode | null;
    onClose: () => void;
    colorNetworks?: boolean;
  }

  let { node, onClose, colorNetworks = false }: Props = $props();

  let stats = $state<ContainerStats | null>(null);
  let inspect = $state<ContainerInspect | null>(null);
  let history = $state<MetricPoint[]>([]);
  let activeTab = $state<'info' | 'env' | 'logs' | 'top' | 'diff' | 'exec'>('info');
  let actionPending = $state(false);
  let showMore = $state(false);
  let moreBtn = $state<HTMLElement | null>(null);
  let confirmDialog = $state<{
    title: string;
    message: string;
    confirmLabel: string;
    variant: 'warning' | 'danger';
    typeToConfirm?: string;
    action: () => Promise<void>;
  } | null>(null);

  async function doAction(action: string) {
    if (!node || actionPending) return;
    actionPending = true;
    try {
      const res = await fetch(`/api/containers/${node.containerId}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        addToast(`Failed to ${action}: ${err.error}`, 'error');
      } else {
        addToast(`Container ${action}ed`, 'success');
      }
    } catch {
      addToast(`Failed to ${action}`, 'error');
    } finally {
      actionPending = false;
    }
  }

  async function doRemove(withVolumes: boolean) {
    if (!node || actionPending) return;
    actionPending = true;
    try {
      const res = await fetch(`/api/containers/${node.containerId}?volumes=${withVolumes}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        addToast(`Failed to remove: ${err.error}`, 'error');
      } else {
        addToast(`Container removed${withVolumes ? ' with volumes' : ''}`, 'success');
        onClose();
      }
    } catch {
      addToast('Failed to remove', 'error');
    } finally {
      actionPending = false;
    }
  }

  function confirm(opts: typeof confirmDialog) {
    showMore = false;
    confirmDialog = opts;
  }

  // Fetch stats + inspect + history when node changes
  $effect(() => {
    if (!node) return;
    // Fall back to 'info' only if current tab isn't available for this node
    const runningTabs = ['top', 'exec'];
    if (runningTabs.includes(activeTab) && node.status !== 'running' && node.status !== 'paused') {
      activeTab = 'info';
    }
    inspect = null;
    history = [];
    showMore = false;

    if (node.status === 'running') {
      fetch(`/api/containers/${node.containerId}/stats`)
        .then((r) => r.json())
        .then((d) => (stats = d))
        .catch(() => (stats = null));
      fetch(`/api/containers/${node.containerId}/history`)
        .then((r) => r.json())
        .then((d) => (history = d))
        .catch(() => (history = []));
    } else {
      stats = null;
      // Fetch crash diagnostic for non-running containers
      if (!docker.diagnostics.has(node.id)) {
        fetch(`/api/containers/${node.containerId}/diagnostic`)
          .then((r) => r.json())
          .then((d) => {
            if (d) addDiagnostic(d);
          })
          .catch(() => {});
      }
    }

    fetch(`/api/containers/${node.containerId}/inspect`)
      .then((r) => r.json())
      .then((d) => (inspect = d))
      .catch(() => (inspect = null));
  });

  // Log streaming subscription
  $effect(() => {
    const tab = activeTab;
    const n = node;
    untrack(() => {
      if (tab === 'logs' && n) subscribeLogs(n.containerId);
      else unsubscribeLogs();
    });
  });

  onDestroy(() => unsubscribeLogs());
</script>

<div class="sidebar">
  {#if !node}
    <div class="sidebar-empty">
      <div class="brand">DockScope</div>
      <div class="brand-sub">Infrastructure Debugger</div>
      <div class="instruction">
        Select a container node in the graph to inspect its configuration, metrics, and live logs.
      </div>
      <div class="legend">
        <div class="legend-title">Legend</div>
        <div class="legend-item"><span class="status-dot running"></span> Running (healthy)</div>
        <div class="legend-item">
          <span class="status-dot cyan"></span> Running (no healthcheck)
        </div>
        <div class="legend-item"><span class="status-dot other"></span> Other</div>
        <div class="legend-item"><span class="status-dot unhealthy"></span> Unhealthy</div>
        <div class="legend-item"><span class="status-dot exited"></span> Stopped</div>
        <div class="legend-line"><span class="line depends"></span> depends_on</div>
        <div class="legend-line"><span class="line network"></span> shared network</div>
      </div>
    </div>
  {:else}
    <div class="sidebar-header">
      <div class="sidebar-title">
        <span
          class="status-dot {node.status === 'running'
            ? node.health === 'unhealthy'
              ? 'unhealthy'
              : 'running'
            : node.status === 'paused'
              ? 'paused'
              : 'exited'}"
        ></span>
        <h3>{node.name}</h3>
      </div>
      <div class="header-right">
        {#if node.status === 'running'}
          <button
            class="act-icon warning"
            title="Pause"
            onclick={() => doAction('pause')}
            disabled={actionPending}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"
              ><rect x="5" y="4" width="4" height="16" rx="1" /><rect
                x="15"
                y="4"
                width="4"
                height="16"
                rx="1"
              /></svg
            >
          </button>
          <button
            class="act-icon"
            class:spinning={actionPending}
            title="Restart"
            onclick={() => doAction('restart')}
            disabled={actionPending}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
            </svg>
          </button>
          <button
            class="act-icon danger"
            title="Stop"
            onclick={() =>
              confirm({
                title: 'Stop Container',
                message: `Stop ${node.name}? The container will be gracefully terminated.`,
                confirmLabel: 'Stop',
                variant: 'warning',
                action: () => doAction('stop'),
              })}
            disabled={actionPending}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"
              ><rect x="4" y="4" width="16" height="16" rx="2" /></svg
            >
          </button>
        {:else if node.status === 'paused'}
          <button
            class="act-icon success"
            title="Unpause"
            onclick={() => doAction('unpause')}
            disabled={actionPending}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"
              ><polygon points="6,3 20,12 6,21" /></svg
            >
          </button>
          <button
            class="act-icon"
            class:spinning={actionPending}
            title="Restart"
            onclick={() => doAction('restart')}
            disabled={actionPending}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
            </svg>
          </button>
        {:else}
          <button
            class="act-icon success"
            title="Start"
            onclick={() => doAction('start')}
            disabled={actionPending}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"
              ><polygon points="6,3 20,12 6,21" /></svg
            >
          </button>
        {/if}

        <!-- More actions trigger -->
        <button
          class="act-icon"
          title="More actions"
          onclick={(e) => {
            moreBtn = e.currentTarget as HTMLElement;
            showMore = !showMore;
          }}
          disabled={actionPending}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"
            ><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle
              cx="12"
              cy="19"
              r="2"
            /></svg
          >
        </button>

        <span class="header-sep"></span>
        <button class="close-btn" onclick={onClose}>&times;</button>
      </div>
    </div>

    <div class="sidebar-tabs">
      <button
        class="tab {activeTab === 'info' ? 'active' : ''}"
        onclick={() => (activeTab = 'info')}>Info</button
      >
      <button class="tab {activeTab === 'env' ? 'active' : ''}" onclick={() => (activeTab = 'env')}
        >Env</button
      >
      <button
        class="tab {activeTab === 'logs' ? 'active' : ''}"
        onclick={() => (activeTab = 'logs')}>Logs</button
      >
      {#if node.status === 'running' || node.status === 'paused'}
        <button
          class="tab {activeTab === 'top' ? 'active' : ''}"
          onclick={() => (activeTab = 'top')}>Top</button
        >
      {/if}
      <button
        class="tab {activeTab === 'diff' ? 'active' : ''}"
        onclick={() => (activeTab = 'diff')}>Diff</button
      >
      {#if node.status === 'running'}
        <button
          class="tab {activeTab === 'exec' ? 'active' : ''}"
          onclick={() => (activeTab = 'exec')}>Exec</button
        >
      {/if}
    </div>

    {#if docker.diagnostics.has(node.id)}
      <SidebarDiagnostic diagnostic={docker.diagnostics.get(node.id)!} onDismiss={() => removeDiagnostic(node.id)} />
    {/if}

    {#if getAnomaliesForContainer(node.id).length > 0}
      <SidebarAnomaly anomalies={getAnomaliesForContainer(node.id)} onDismiss={removeAnomaly} />
    {/if}

    {#if activeTab === 'info'}
      <SidebarInfo {node} {stats} {inspect} {history} {colorNetworks} />
    {:else if activeTab === 'env'}
      <SidebarEnv {inspect} />
    {:else if activeTab === 'logs'}
      <SidebarLogs />
    {:else if activeTab === 'top'}
      <SidebarTop containerId={node.containerId} />
    {:else if activeTab === 'diff'}
      <SidebarDiff containerId={node.containerId} />
    {:else if activeTab === 'exec'}
      <SidebarExec containerId={node.containerId} />
    {/if}
  {/if}
</div>

{#if showMore && node && moreBtn}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="more-backdrop" onclick={() => (showMore = false)} onkeydown={() => {}}></div>
  <div
    class="more-menu"
    style="top: {moreBtn.getBoundingClientRect().bottom + 4}px; right: {window.innerWidth -
      moreBtn.getBoundingClientRect().right}px;"
  >
    {#if node.status === 'running' || node.status === 'paused'}
      <button
        class="more-item"
        onclick={() => {
          showMore = false;
          confirm({
            title: 'Kill Container',
            message: `Forcefully terminate ${node.name}? This sends SIGKILL — no graceful shutdown.`,
            confirmLabel: 'Kill',
            variant: 'warning',
            action: () => doAction('kill'),
          });
        }}>Kill</button
      >
    {/if}
    <button
      class="more-item danger"
      onclick={() => {
        showMore = false;
        confirm({
          title: 'Remove Container',
          message: `Permanently remove ${node.name}? This deletes the container.`,
          confirmLabel: 'Remove',
          variant: 'danger',
          typeToConfirm: node.name,
          action: () => doRemove(false),
        });
      }}>Remove</button
    >
    <button
      class="more-item danger"
      onclick={() => {
        showMore = false;
        confirm({
          title: 'Remove with Volumes',
          message: `Remove ${node.name} and ALL its volumes? This is irreversible.`,
          confirmLabel: 'Remove + Volumes',
          variant: 'danger',
          typeToConfirm: node.name,
          action: () => doRemove(true),
        });
      }}>Remove + Volumes</button
    >
  </div>
{/if}

{#if confirmDialog}
  <ConfirmDialog
    title={confirmDialog.title}
    message={confirmDialog.message}
    confirmLabel={confirmDialog.confirmLabel}
    variant={confirmDialog.variant}
    typeToConfirm={confirmDialog.typeToConfirm}
    onConfirm={() => {
      confirmDialog?.action();
      confirmDialog = null;
    }}
    onCancel={() => {
      confirmDialog = null;
    }}
  />
{/if}
