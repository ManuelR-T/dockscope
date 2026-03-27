<script lang="ts">
  import { onMount } from 'svelte';
  import { formatTime, formatGB } from '../lib/formatting';
  import type { DockerEvent, GraphData, SystemInfo } from '../../types';

  import type { ServiceNode } from '../../types';

  interface Props {
    events: DockerEvent[];
    graph: GraphData;
    onSelectContainer?: (node: ServiceNode) => void;
  }

  let { events, graph, onSelectContainer }: Props = $props();

  let sysInfo = $state<SystemInfo | null>(null);

  let hideHealthChecks = $state(true);

  let running = $derived(graph.nodes.filter((n) => n.status === 'running').length);
  let stopped = $derived(graph.nodes.filter((n) => n.status !== 'running').length);
  let unhealthy = $derived(graph.nodes.filter((n) => n.health === 'unhealthy').length);

  const HEALTHCHECK_PREFIXES = ['exec_create', 'exec_start', 'exec_die', 'health_status'];

  function isHealthCheckEvent(action: string): boolean {
    return HEALTHCHECK_PREFIXES.some((p) => action.startsWith(p));
  }

  let filteredEvents = $derived(
    hideHealthChecks ? events.filter((e) => !isHealthCheckEvent(e.action)) : events,
  );

  function selectByActor(actor: string) {
    if (!onSelectContainer) return;
    // Docker container names are like "project-service-1"
    // Node names are "service" or "project/service"
    const node = graph.nodes.find((n) => {
      if (n.name === actor || n.id === actor) return true;
      // Extract service name: "project-service-1" → check if node name matches "service"
      const parts = actor.split('-');
      if (parts.length >= 2) {
        // Try removing last part (instance number) and first part (project)
        const withoutInstance = parts.slice(0, -1).join('-');
        const serviceOnly = parts.slice(1, -1).join('-');
        if (n.name === serviceOnly || n.name === withoutInstance || actor.includes(n.name)) return true;
      }
      return false;
    });
    if (node) onSelectContainer(node);
  }

  onMount(() => {
    fetch('/api/system')
      .then((r) => r.json())
      .then((data) => (sysInfo = data))
      .catch(() => {});
  });
</script>

<div class="status-bar">
  <div class="status-bar-header">
    <div class="status-summary">
      {#if graph.nodes.length > 0}
        <span class="status-chip">
          <span class="dot green"></span>
          {running} running
        </span>
        {#if stopped > 0}
          <span class="status-chip">
            <span class="dot gray"></span>
            {stopped} stopped
          </span>
        {/if}
        {#if unhealthy > 0}
          <span class="status-chip">
            <span class="dot red"></span>
            {unhealthy} unhealthy
          </span>
        {/if}
      {/if}
      {#if sysInfo}
        <span class="sys-info-divider"></span>
        <span class="sys-info">Docker {sysInfo.dockerVersion}</span>
        <span class="sys-info">{sysInfo.cpus} CPUs</span>
        <span class="sys-info">{formatGB(sysInfo.totalMemory)} GB</span>
      {/if}
    </div>
    <div class="event-header-right">
      <button
        class="healthcheck-toggle"
        class:active={hideHealthChecks}
        onclick={() => (hideHealthChecks = !hideHealthChecks)}
        title="Toggle health check events"
      >
        HC
      </button>
      <span class="event-label">Event Stream</span>
    </div>
  </div>
  <div class="event-list">
    {#if filteredEvents.length === 0}
      <div class="event-empty">Listening for Docker events...</div>
    {/if}
    {#each filteredEvents.slice(0, 50) as event, i (event.time + '-' + i)}
      <div class="event-row">
        <span class="event-time">{formatTime(event.time)}</span>
        <span class="event-action {event.action}">{event.action}</span>
        <button class="event-actor-btn" onclick={() => selectByActor(event.actor)}>{event.actor}</button>
        <span class="event-type">{event.type}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .status-bar {
    width: 100%;
    height: 100%;
    background: var(--bg-surface);
    backdrop-filter: blur(24px) saturate(1.2);
    border-top: 1px solid var(--border-glow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .status-bar::before {
    content: '';
    position: absolute;
    top: -1px;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, var(--accent-cyan-dim), transparent 40%);
    z-index: 1;
  }
  .status-bar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .status-summary {
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .status-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    letter-spacing: 0.3px;
  }
  .sys-info-divider {
    width: 1px;
    height: 12px;
    background: var(--border-glow);
  }
  .sys-info {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.3px;
  }
  .event-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--text-dim);
  }
  .event-list {
    flex: 1;
    overflow-y: auto;
    padding: 2px 0;
  }
  .event-empty {
    padding: 12px 16px;
    font-size: 11px;
    color: var(--text-dim);
    font-style: italic;
  }
  .event-row {
    display: flex;
    gap: 12px;
    padding: 4px 16px;
    font-size: 11px;
    align-items: center;
    transition: background 0.15s;
  }
  .event-row:hover {
    background: rgba(0, 228, 255, 0.03);
  }
  .event-time {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-dim);
    min-width: 68px;
  }
  .event-action {
    min-width: 65px;
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .event-action.start {
    color: var(--accent-green);
  }
  .event-action.stop {
    color: var(--accent-amber);
  }
  .event-action.die,
  .event-action.destroy,
  .event-action.kill {
    color: var(--accent-red);
  }
  .event-action.create {
    color: var(--accent-cyan);
  }
  .event-action.pause {
    color: var(--accent-purple);
  }
  .event-action.unpause {
    color: var(--accent-green);
  }
  .event-actor-btn {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--text-secondary);
    cursor: pointer;
    transition: color 0.15s;
  }
  .event-actor-btn:hover {
    color: var(--accent-cyan);
    text-decoration: underline;
  }
  .event-type {
    color: var(--text-dim);
    margin-left: auto;
    font-size: 10px;
  }
  .event-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .healthcheck-toggle {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: 0.5px;
    text-decoration: line-through;
    opacity: 0.5;
  }
  .healthcheck-toggle.active {
    text-decoration: line-through;
    opacity: 0.5;
  }
  .healthcheck-toggle:not(.active) {
    text-decoration: none;
    opacity: 1;
    color: var(--accent-cyan);
    border-color: var(--border-glow);
  }
  .healthcheck-toggle:hover {
    border-color: var(--border-glow);
    opacity: 0.8;
  }
</style>
