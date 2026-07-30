<script lang="ts">
  import { onMount } from 'svelte';
  import { formatTime, formatGB } from '../lib/formatting';
  import { formatClock } from '../lib/recording';
  import Icon from './Icon.svelte';
  import { Button, IconButton, TextButton } from './ui';
  import {
    getRecorderState,
    loadRecordingFile,
    startRecording,
    startReplay,
    stopRecording,
  } from '../stores/recorder.svelte';
  import type { DockerEvent, GraphData } from '../../types';
  import type { PluginSystemSnapshot } from '../../core/plugin-system';

  import type { ServiceNode } from '../../types';

  interface Props {
    events: DockerEvent[];
    graph: GraphData;
    onSelectContainer?: (node: ServiceNode) => void;
  }

  let { events, graph, onSelectContainer }: Props = $props();

  const recorder = getRecorderState();

  let sysInfo = $state<PluginSystemSnapshot | null>(null);

  let hideHealthChecks = $state(true);
  let fileInput = $state<HTMLInputElement | null>(null);

  function onRecordingFilePicked(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      loadRecordingFile(file);
    }
    input.value = '';
  }

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

  function selectByEvent(event: DockerEvent) {
    if (!onSelectContainer) {
      return;
    }
    const shortId = event.id.includes(':') ? event.id.split(':').at(-1) : event.id;
    const node = graph.nodes.find(
      (n) =>
        n.id === event.id ||
        n.containerId === event.containerId ||
        (shortId && n.containerId.startsWith(shortId)) ||
        ((!event.host || n.host === event.host) &&
          (n.fullName === event.actor || n.name === event.actor)),
    );
    if (node) {
      onSelectContainer(node);
    }
  }

  onMount(() => {
    fetch('/api/systems')
      .then((r) => r.json())
      .then((data: PluginSystemSnapshot[]) => {
        sysInfo = data.find((system) => system.status === 'connected') ?? data[0] ?? null;
      })
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
        <span class="sys-info">{sysInfo.runtime ?? sysInfo.label} {sysInfo.version ?? ''}</span>
        {#if sysInfo.cpuCount !== undefined}
          <span class="sys-info">{sysInfo.cpuCount} CPUs</span>
        {/if}
        {#if sysInfo.memoryBytes !== undefined}
          <span class="sys-info">{formatGB(sysInfo.memoryBytes)} GB</span>
        {/if}
      {/if}
    </div>
    <div class="event-header-right">
      {#if !recorder.replaying}
        <Button
          variant="ghost"
          size="sm"
          pill
          mono
          tone={recorder.isRecording ? 'danger' : 'accent'}
          active={recorder.isRecording}
          onclick={() => (recorder.isRecording ? stopRecording() : startRecording())}
          title={recorder.isRecording
            ? 'Stop recording and save to file'
            : 'Record session (graph, events, metrics)'}
        >
          <span class="rec-dot" class:recording={recorder.isRecording}></span>
          {#if recorder.isRecording}
            <span class="rec-time">{formatClock(recorder.recElapsed)}</span>
          {:else}
            REC
          {/if}
        </Button>
        {#if recorder.recording && !recorder.isRecording}
          <IconButton
            variant="outline"
            size={20}
            title="Replay last recording"
            onclick={startReplay}
          >
            <Icon name="play" size={10} />
          </IconButton>
        {/if}
        {#if !recorder.isRecording}
          <IconButton
            variant="outline"
            size={20}
            title="Open a recording file for replay"
            onclick={() => fileInput?.click()}
          >
            <Icon name="upload" size={11} />
          </IconButton>
          <input
            bind:this={fileInput}
            type="file"
            accept=".json,application/json"
            onchange={onRecordingFilePicked}
            hidden
          />
        {/if}
        <span class="sys-info-divider"></span>
      {/if}
      <Button
        variant="ghost"
        size="sm"
        pill
        mono
        active={!hideHealthChecks}
        onclick={() => (hideHealthChecks = !hideHealthChecks)}
        title="Toggle health check events"
      >
        <span class="hc-label" class:hidden={hideHealthChecks}>HC</span>
      </Button>
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
        <TextButton onclick={() => selectByEvent(event)}>{event.actor}</TextButton>
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
    font-size: var(--text-base);
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
    font-size: var(--text-sm);
    color: var(--text-dim);
    letter-spacing: 0.3px;
  }
  .event-label {
    font-size: var(--text-xs);
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
    font-size: var(--text-base);
    color: var(--text-dim);
    font-style: italic;
  }
  .event-row {
    display: flex;
    gap: 12px;
    padding: 4px 16px;
    font-size: var(--text-base);
    align-items: center;
    transition: background 0.15s;
  }
  .event-row:hover {
    background: rgba(0, 228, 255, 0.03);
  }
  .event-time {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-dim);
    min-width: 68px;
  }
  .event-action {
    min-width: 65px;
    font-weight: 600;
    font-size: var(--text-sm);
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
  .event-type {
    color: var(--text-dim);
    margin-left: auto;
    font-size: var(--text-sm);
  }
  .event-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  @keyframes rec-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.25;
    }
  }
  .rec-time {
    min-width: 28px;
  }
  .rec-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }

  .rec-dot.recording {
    animation: rec-pulse 1.2s ease-in-out infinite;
  }

  /* Struck through when health-check events are being filtered out. */
  .hc-label.hidden {
    text-decoration: line-through;
    opacity: 0.5;
  }
</style>
