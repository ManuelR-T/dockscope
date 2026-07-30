<script lang="ts">
  import { formatDate, formatBytes } from '../../lib/formatting';
  import { TextButton } from '../ui';
  import { copyToClipboard } from '../../lib/clipboard';
  import { buildNetworkColorMap } from '../../lib/networkColors';
  import { getDockerState } from '../../stores/docker.svelte';
  import Sparkline from '../Sparkline.svelte';
  import type { ServiceNode, ContainerStats, ContainerInspect, MetricPoint } from '../../../types';

  interface Props {
    node: ServiceNode;
    stats: ContainerStats | null;
    inspect: ContainerInspect | null;
    history: MetricPoint[];
    colorNetworks?: boolean;
  }

  let { node, stats, inspect, history, colorNetworks = false }: Props = $props();

  const docker = getDockerState();
  let netColorMap = $derived(buildNetworkColorMap(docker.graph.links));

  let hasMemoryLimit = $derived(Boolean(stats && stats.memoryLimit > 0));
  let memPercentValue = $derived(
    stats && hasMemoryLimit ? (stats.memory / stats.memoryLimit) * 100 : null,
  );
  let memoryFillWidth = $derived(
    memPercentValue === null ? 0 : Math.min(Math.max(memPercentValue, 0), 100),
  );
  let memPercent = $derived(memPercentValue === null ? 'n/a' : memPercentValue.toFixed(1));
  let memoryUsageLabel = $derived(
    stats
      ? hasMemoryLimit
        ? `${formatBytes(stats.memory)} / ${formatBytes(stats.memoryLimit)}`
        : `${formatBytes(stats.memory)} used`
      : '',
  );
  let cpuHistory = $derived(history.map((p) => p.cpu));
  let memHistory = $derived(
    stats && hasMemoryLimit
      ? history
          .map((p) => (p.memory / stats.memoryLimit) * 100)
          .filter((value) => Number.isFinite(value))
      : [],
  );
</script>

<div class="sidebar-content">
  <div class="info-section">
    <span class="field-label">{node.runtime === 'kubernetes' ? 'Resource' : 'Image'}</span>
    <TextButton mono onclick={() => copyToClipboard(node.image, 'image')}>{node.image}</TextButton>
  </div>

  {#if node.runtime === 'kubernetes'}
    <div class="info-section">
      <span class="field-label">Kind</span>
      <span class="tag">{node.kind}</span>
    </div>
    <div class="info-section">
      <span class="field-label">Namespace</span>
      <span class="tag">{node.namespace}</span>
    </div>
  {/if}

  <div class="info-section">
    <span class="field-label">Status</span>
    <span class="status-text {node.status}">
      {node.status}{node.health !== 'none' ? ` (${node.health})` : ''}
    </span>
  </div>

  <div class="info-section">
    <span class="field-label">{node.runtime === 'kubernetes' ? 'Resource ID' : 'Container ID'}</span
    >
    <TextButton mono onclick={() => copyToClipboard(node.containerId, 'resource ID')}
      >{node.id}</TextButton
    >
  </div>

  {#if inspect?.created}
    <div class="info-section">
      <span class="field-label">Created</span>
      <span class="mono">{formatDate(inspect.created)}</span>
    </div>
  {/if}

  {#if inspect?.restartPolicy && inspect.restartPolicy !== 'no'}
    <div class="info-section">
      <span class="field-label">Restart Policy</span>
      <span class="tag">{inspect.restartPolicy}</span>
    </div>
  {/if}

  {#if node.ports.length > 0}
    <div class="info-section">
      <span class="field-label">Ports</span>
      <div>
        {#each node.ports as port}
          <span class="tag">{port}</span>
        {/each}
      </div>
    </div>
  {/if}

  {#if node.networks.length > 0}
    <div class="info-section">
      <span class="field-label">Networks</span>
      <div>
        {#each node.networks as net}
          {@const rgb = colorNetworks ? netColorMap.get(net) || '0,228,255' : '0,228,255'}
          <span
            class="tag"
            style="border-color: rgba({rgb},0.25); color: rgba({rgb},0.9); box-shadow: 0 0 6px rgba({rgb},0.1);"
            >{net}</span
          >
        {/each}
      </div>
    </div>
  {/if}

  {#if stats && node.status === 'running'}
    <div class="info-section">
      <span class="field-label">CPU</span>
      <div class="gauge">
        <div class="progress-bar">
          <div class="progress-fill cpu" style="width: {Math.min(stats.cpu, 100)}%"></div>
        </div>
        <span class="gauge-value">{stats.cpu.toFixed(1)}%</span>
      </div>
    </div>

    <div class="info-section">
      <span class="field-label">Memory</span>
      <div class="gauge">
        <div class="progress-bar">
          <div class="progress-fill memory" style="width: {memoryFillWidth}%"></div>
        </div>
        <span class="gauge-value">{hasMemoryLimit ? `${memPercent}%` : 'No limit'}</span>
      </div>
      <span
        class="mono"
        style="font-size: var(--text-sm); color: var(--text-dim); margin-top: 4px; display: block;"
      >
        {memoryUsageLabel}
      </span>
    </div>

    <div class="info-section">
      <span class="field-label">Network I/O</span>
      <span class="mono"
        >{formatBytes(stats.networkRx)} rx &middot; {formatBytes(stats.networkTx)} tx</span
      >
    </div>

    {#if cpuHistory.length >= 2}
      <div class="info-section sparkline-row">
        <Sparkline data={cpuHistory} color="#00e4ff" label="CPU History" />
      </div>
    {/if}
    {#if memHistory.length >= 2}
      <div class="info-section sparkline-row">
        <Sparkline data={memHistory} color="#a855f7" label="Memory History" />
      </div>
    {/if}
  {/if}
</div>
