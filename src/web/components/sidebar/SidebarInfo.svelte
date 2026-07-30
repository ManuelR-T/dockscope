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

  let metadataEntries = $derived(
    Object.entries(node.metadata ?? {}).filter(
      ([, value]) => value !== '' && value !== null && String(value).length <= 80,
    ),
  );

  function humanizeKey(key: string): string {
    const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
  }

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
  <div class="node-section">
    <div class="node-section-head">{node.runtime === 'kubernetes' ? 'Resource' : 'Identity'}</div>
    <div class="node-section-body">
      <div class="field-row">
        <span class="field-key">Status</span>
        <span class="field-val status-text {node.status}">
          {node.status}{node.health !== 'none' ? ` (${node.health})` : ''}
        </span>
      </div>
      {#if node.runtime === 'kubernetes'}
        <div class="field-row">
          <span class="field-key">Kind</span>
          <span class="field-val"><span class="tag">{node.kind}</span></span>
        </div>
        <div class="field-row">
          <span class="field-key">Namespace</span>
          <span class="field-val"><span class="tag">{node.namespace}</span></span>
        </div>
      {/if}
      <div class="field-row">
        <span class="field-key">{node.runtime === 'kubernetes' ? 'Resource' : 'Image'}</span>
        <span class="field-val">
          <TextButton mono onclick={() => copyToClipboard(node.image, 'image')}
            >{node.image}</TextButton
          >
        </span>
      </div>
      <div class="field-row">
        <span class="field-key">{node.runtime === 'kubernetes' ? 'Resource ID' : 'ID'}</span>
        <span class="field-val">
          <TextButton mono onclick={() => copyToClipboard(node.containerId, 'resource ID')}
            >{node.id}</TextButton
          >
        </span>
      </div>
      {#if inspect?.created}
        <div class="field-row">
          <span class="field-key">Created</span>
          <span class="field-val mono">{formatDate(inspect.created)}</span>
        </div>
      {/if}
      {#if inspect?.restartPolicy && inspect.restartPolicy !== 'no'}
        <div class="field-row">
          <span class="field-key">Restart</span>
          <span class="field-val"><span class="tag">{inspect.restartPolicy}</span></span>
        </div>
      {/if}
    </div>
  </div>

  {#if node.ports.length > 0 || node.networks.length > 0}
    <div class="node-section">
      <div class="node-section-head">Network</div>
      <div class="node-section-body">
        {#if node.ports.length > 0}
          <div class="field-stack">
            <span class="field-key">Ports</span>
            <div class="field-tags">
              {#each node.ports as port}
                <span class="tag">{port}</span>
              {/each}
            </div>
          </div>
        {/if}
        {#if node.networks.length > 0}
          <div class="field-stack">
            <span class="field-key">Networks</span>
            <div class="field-tags">
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
      </div>
    </div>
  {/if}

  {#if metadataEntries.length > 0}
    <div class="node-section">
      <div class="node-section-head">Details</div>
      <div class="node-section-body">
        {#each metadataEntries as [key, value]}
          <div class="field-row">
            <span class="field-key">{humanizeKey(key)}</span>
            <span class="field-val">{value}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if stats && node.status === 'running'}
    <div class="node-section">
      <div class="node-section-head">
        Resources
        <span class="metric-sub"
          >{formatBytes(stats.networkRx)} rx &middot; {formatBytes(stats.networkTx)} tx</span
        >
      </div>
      <div class="node-section-body">
        <div class="metric">
          <div class="metric-head">
            <span class="field-key">CPU</span>
            <span class="metric-val">{stats.cpu.toFixed(1)}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill cpu" style="width: {Math.min(stats.cpu, 100)}%"></div>
          </div>
          {#if cpuHistory.length >= 2}
            <Sparkline data={cpuHistory} color="#00e4ff" fluid />
          {/if}
        </div>

        <div class="metric">
          <div class="metric-head">
            <span class="field-key">Memory</span>
            <span class="metric-val">{hasMemoryLimit ? `${memPercent}%` : 'No limit'}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill memory" style="width: {memoryFillWidth}%"></div>
          </div>
          <div class="metric-sub">{memoryUsageLabel}</div>
          {#if memHistory.length >= 2}
            <Sparkline data={memHistory} color="#a855f7" fluid />
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
