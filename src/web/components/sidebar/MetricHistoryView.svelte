<script lang="ts">
  import { getJson, apiErrorMessage } from '../../lib/api';
  import { entityApiUrl } from '../../lib/sidebarApi';
  import { formatBytes } from '../../lib/formatting';
  import type { MetricPoint, ServiceNode } from '../../../types';
  import MetricHistoryChart from './MetricHistoryChart.svelte';

  let { node }: { node: ServiceNode } = $props();
  let range = $state('5m');
  let points = $state<MetricPoint[]>([]);
  let loading = $state(true);
  let error = $state('');
  let end = $state(Date.now());
  const durations: Record<string, number> = { '5m': 300_000, '1h': 3_600_000, '24h': 86_400_000 };
  let start = $derived(end - durations[range]);
  let gap = $derived(range === '5m' ? 15_000 : 90_000);

  $effect(() => {
    const target = {
      id: node.id,
      containerId: node.containerId,
      entityId: node.entityId,
      host: node.host,
      sourceId: node.sourceId,
    };
    const selected = range;
    const controller = new AbortController();
    let pending = false;
    points = [];
    loading = true;
    error = '';
    async function refresh() {
      if (pending) {
        return;
      }
      pending = true;
      try {
        const result = await getJson<MetricPoint[]>(
          entityApiUrl(target, '/history', { range: selected }),
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          points = result;
          end = Date.now();
          error = '';
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          error = apiErrorMessage(cause) || 'Could not load metric history';
        }
      } finally {
        pending = false;
        if (!controller.signal.aborted) {
          loading = false;
        }
      }
    }
    void refresh();
    const timer = setInterval(refresh, selected === '5m' ? 5000 : 30_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  });
</script>

<div class="node-section">
  <div class="node-section-head history-heading">
    <span>Resource history</span>
    <div class="range-control" role="group" aria-label="Metric history range">
      {#each [{ value: '5m', label: 'Last 5 minutes' }, { value: '1h', label: 'Last hour' }, { value: '24h', label: 'Last 24 hours' }] as option}
        <button
          type="button"
          aria-label={option.label}
          aria-pressed={range === option.value}
          onclick={() => (range = option.value)}>{option.value}</button
        >
      {/each}
    </div>
  </div>
  <div class="node-section-body">
    {#if error}<p role="alert" class="history-error">{error}</p>{/if}
    {#if loading}
      <p class="metric-sub">Loading history…</p>
    {:else if points.length === 0}
      <p class="metric-sub">
        No samples in this range. History is collected while the workload is running.
      </p>
    {:else}
      <MetricHistoryChart
        {points}
        metric="cpu"
        label="CPU"
        color="#00e4ff"
        {start}
        {end}
        {gap}
        format={(value) => `${value.toFixed(1)}%`}
      />
      <MetricHistoryChart
        {points}
        metric="memory"
        label="Memory"
        color="#a855f7"
        {start}
        {end}
        {gap}
        format={formatBytes}
      />
      <div class="history-axis"><span>{range} ago</span><span>Now</span></div>
      <p class="history-note">
        {range === '5m' ? 'Recent samples' : 'Minute averages'} · {points.length} samples<br />Gaps
        indicate missing samples.
      </p>
    {/if}
  </div>
</div>

<style>
  .history-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .range-control {
    display: flex;
    padding: 3px;
    gap: 2px;
    border: 1px solid var(--border-control);
    border-radius: 7px;
    background: var(--bg-inset);
  }
  .range-control button {
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-dim);
    padding: 4px 9px;
    font: inherit;
    font-size: var(--text-xs);
    letter-spacing: 0;
    cursor: pointer;
  }
  .range-control button:hover {
    color: var(--text-primary);
    background: var(--border-control);
  }
  .range-control button[aria-pressed='true'] {
    color: var(--accent-cyan);
    background: rgba(0, 228, 255, 0.12);
  }
  .range-control button:focus-visible {
    outline: 1px solid var(--accent-cyan);
    outline-offset: 2px;
  }
  .history-note {
    margin: 12px 0 0;
    font-size: var(--text-xs);
    color: var(--text-dim);
    line-height: 1.7;
  }

  .history-axis {
    margin: 8px 4px 0;
    display: flex;
    justify-content: space-between;
    color: var(--text-dim);
    font-size: var(--text-xs);
  }
  .history-error {
    color: var(--accent-red);
    font-size: var(--text-sm);
  }
</style>
