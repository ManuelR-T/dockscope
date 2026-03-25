<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { subscribeLogs, unsubscribeLogs, addToast } from '../stores/docker.svelte';
  import SidebarInfo from './sidebar/SidebarInfo.svelte';
  import SidebarEnv from './sidebar/SidebarEnv.svelte';
  import SidebarLogs from './sidebar/SidebarLogs.svelte';
  import type { ServiceNode, ContainerStats, ContainerInspect, MetricPoint } from '../../types';

  interface Props {
    node: ServiceNode | null;
    onClose: () => void;
  }

  let { node, onClose }: Props = $props();

  let stats = $state<ContainerStats | null>(null);
  let inspect = $state<ContainerInspect | null>(null);
  let history = $state<MetricPoint[]>([]);
  let activeTab = $state<'info' | 'env' | 'logs'>('info');
  let actionPending = $state(false);

  async function doAction(action: 'start' | 'stop' | 'restart') {
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

  // Fetch stats + inspect + history when node changes
  $effect(() => {
    if (!node) return;
    activeTab = 'info';
    inspect = null;
    history = [];

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
            : 'exited'}"
        ></span>
        <h3>{node.name}</h3>
      </div>
      <div class="header-right">
        {#if node.status === 'running'}
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
            onclick={() => doAction('stop')}
            disabled={actionPending}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"
              ><rect x="4" y="4" width="16" height="16" rx="2" /></svg
            >
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
    </div>

    {#if activeTab === 'info'}
      <SidebarInfo {node} {stats} {inspect} {history} />
    {:else if activeTab === 'env'}
      <SidebarEnv {inspect} />
    {:else}
      <SidebarLogs />
    {/if}
  {/if}
</div>
