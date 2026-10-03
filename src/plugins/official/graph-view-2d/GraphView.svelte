<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { GraphData, ServiceNode } from '../../../types';
  import {
    computeImpactNodeIds,
    isNodeVisible,
    type GraphFilters,
    type StatusFilter,
  } from '../../../web/lib/graphFilters';
  import { endpointId, linkKey } from '../../../web/lib/graphLinks';
  import { CARD_HEIGHT, CARD_WIDTH, collectGraph2dNetworks, layoutGraph2d } from './layout';
  import { buildNetworkColorMap } from '../../../web/lib/networkColors';
  import { formatBytes } from '../../../web/lib/formatting';
  import Icon from '../../../web/components/Icon.svelte';
  import { IconButton } from '../../../web/components/ui';

  interface Props {
    data: GraphData;
    onNodeClick: (node: ServiceNode) => void;
    selectedNode: ServiceNode | null;
    searchQuery: string;
    statusFilter: Set<StatusFilter>;
    scopeFilter: string;
    colorNetworks: boolean;
    onHelpClick: () => void;
    anomalyIds?: ReadonlySet<string>;
  }

  let {
    data,
    onNodeClick,
    selectedNode,
    searchQuery,
    statusFilter,
    scopeFilter,
    colorNetworks,
    onHelpClick,
    anomalyIds = new Set<string>(),
  }: Props = $props();
  let container: HTMLDivElement;
  let width = $state(0);
  let height = $state(0);
  let panX = $state(0);
  let panY = $state(0);
  let scale = $state(1);
  let fitted = $state(false);
  let dragging = $state(false);
  let drag: { x: number; y: number; panX: number; panY: number } | null = null;
  let selectedNetwork = $state<string | null>(null);
  let impactMode = $state(false);

  const filters = $derived<GraphFilters>({ searchQuery, statusFilter, scopeFilter });
  const scopedNodes = $derived(data.nodes.filter((node) => isNodeVisible(node, filters)));
  const networks = $derived(collectGraph2dNetworks(scopedNodes));
  const activeNetwork = $derived(networks.find((network) => network.id === selectedNetwork));
  const visibleNodes = $derived(
    activeNetwork
      ? scopedNodes.filter((node) => activeNetwork.members.includes(node.id))
      : scopedNodes,
  );
  const visibleIds = $derived(new Set(visibleNodes.map((node) => node.id)));
  const layout = $derived(layoutGraph2d({ nodes: visibleNodes, links: data.links }));
  const positions = $derived(new Map(layout.nodes.map((node) => [node.id, node])));
  const networkColors = $derived(buildNetworkColorMap(data.links));
  const multipleNetworkSources = $derived(
    new Set(networks.map((network) => network.source)).size > 1,
  );
  const links = $derived(
    data.links.filter(
      (link) =>
        link.type !== 'network' &&
        visibleIds.has(endpointId(link.source)) &&
        visibleIds.has(endpointId(link.target)),
    ),
  );
  const impactIds = $derived(
    impactMode && selectedNode
      ? computeImpactNodeIds(selectedNode.id, data.links)
      : new Set<string>(),
  );
  const relatedIds = $derived.by(() => {
    if (impactIds.size) {
      return impactIds;
    }
    if (activeNetwork) {
      return new Set(activeNetwork.members);
    }
    if (!selectedNode) {
      return new Set<string>();
    }
    const ids = new Set([selectedNode.id]);
    for (const link of data.links) {
      const from = endpointId(link.source);
      const to = endpointId(link.target);
      if (from === selectedNode.id) {
        ids.add(to);
      }
      if (to === selectedNode.id) {
        ids.add(from);
      }
    }
    for (const hub of layout.networks) {
      if (hub.members.includes(selectedNode.id)) {
        hub.members.forEach((id) => ids.add(id));
      }
    }
    return ids;
  });

  $effect(() => {
    if (selectedNetwork && !networks.some((network) => network.id === selectedNetwork)) {
      selectedNetwork = null;
    }
  });
  $effect(() => {
    if (!selectedNode) {
      impactMode = false;
    }
  });
  $effect(() => {
    if (!data.nodes.length) {
      fitted = false;
    } else if (width > 0 && height > 0 && !fitted) {
      untrack(zoomToFit);
      fitted = true;
    }
  });

  // Compact and refit deliberate filter changes, without moving the camera on metric updates.
  $effect(() => {
    void searchQuery;
    void scopeFilter;
    void statusFilter;
    void selectedNetwork;
    untrack(() => {
      if (fitted) {
        zoomToFit();
      }
    });
  });

  function networkColor(name: string): string {
    return colorNetworks ? `rgb(${networkColors.get(name) || '0,228,255'})` : 'var(--accent-cyan)';
  }

  function status(node: ServiceNode): string {
    if (node.status === 'running' && node.health === 'unhealthy') {
      return 'Unhealthy';
    }
    if (node.status === 'running' && node.health === 'starting') {
      return 'Starting';
    }
    return node.status.charAt(0).toUpperCase() + node.status.slice(1);
  }

  function tone(node: ServiceNode): string {
    if (node.health === 'unhealthy' || node.status === 'dead') {
      return 'var(--accent-red)';
    }
    if (node.health === 'starting' || node.status === 'restarting' || node.status === 'paused') {
      return 'var(--accent-amber)';
    }
    return node.status === 'running' ? 'var(--accent-green)' : 'var(--text-secondary)';
  }

  function dimmed(id: string): boolean {
    return relatedIds.size > 0 && !relatedIds.has(id);
  }

  function chooseNode(node: ServiceNode) {
    selectedNetwork = null;
    onNodeClick(node);
  }

  export function zoomToFit() {
    const boxes = layout.nodes
      .filter((node) => visibleIds.has(node.id))
      .map((node) => ({ ...node, width: CARD_WIDTH, height: CARD_HEIGHT }));
    if (!boxes.length || !width || !height) {
      return;
    }
    const left = Math.min(...boxes.map((box) => box.x)) - 30;
    const top = Math.min(...boxes.map((box) => box.y)) - 40;
    const right = Math.max(...boxes.map((box) => box.x + box.width)) + 30;
    const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + 30;
    const availableHeight = height - (networks.length ? 220 : 116);
    scale = Math.max(
      0.04,
      Math.min(1.15, (width - 96) / (right - left), availableHeight / (bottom - top)),
    );
    panX = 64 + (width - 96 - (right - left) * scale) / 2 - left * scale;
    panY = 76 + (availableHeight - (bottom - top) * scale) / 2 - top * scale;
  }

  export function resetCamera() {
    selectedNetwork = null;
    impactMode = false;
    zoomToFit();
  }

  export function centerOnNode(node: ServiceNode) {
    const position = positions.get(node.id);
    if (!position) {
      return;
    }
    scale = 1;
    panX = width / 2 - position.x - CARD_WIDTH / 2;
    panY = (height + 60) / 2 - position.y - CARD_HEIGHT / 2;
  }

  export function toggleImpactMode() {
    if (!selectedNode) {
      return;
    }
    selectedNetwork = null;
    impactMode = !impactMode;
  }

  function zoomAt(factor: number, x = width / 2, y = height / 2) {
    const next = Math.max(0.04, Math.min(2.5, scale * factor));
    panX = x - ((x - panX) * next) / scale;
    panY = y - ((y - panY) * next) / scale;
    scale = next;
  }

  function startPan(event: PointerEvent) {
    if (event.button !== 0 || (event.target as Element).closest('button')) {
      return;
    }
    drag = { x: event.clientX, y: event.clientY, panX, panY };
    dragging = true;
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
  }

  function movePan(event: PointerEvent) {
    if (!drag) {
      return;
    }
    panX = drag.panX + event.clientX - drag.x;
    panY = drag.panY + event.clientY - drag.y;
  }

  function stopPan() {
    drag = null;
    dragging = false;
  }

  function linkPath(fromId: string, toId: string): string {
    const from = positions.get(fromId)!;
    const to = positions.get(toId)!;
    const forward = to.x > from.x;
    const x1 = from.x + (forward ? CARD_WIDTH : CARD_WIDTH / 2);
    const y1 = from.y + (forward ? CARD_HEIGHT / 2 : CARD_HEIGHT);
    const x2 = to.x + (forward ? 0 : CARD_WIDTH / 2);
    const y2 = to.y + (forward ? CARD_HEIGHT / 2 : 0);
    return forward
      ? `M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${x1 + 60} ${y1 + 40}, ${x2 + 60} ${y2 - 40}, ${x2} ${y2}`;
  }

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
    });
    observer.observe(container);
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('.network-strip')) {
        return;
      }
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      zoomAt(
        Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    };
    container.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      container.removeEventListener('wheel', wheel);
    };
  });
</script>

<div class="flat-graph" bind:this={container}>
  <svg
    class:dragging
    role="group"
    aria-label="2D service topology. Drag the background to pan; scroll to zoom."
    onpointerdown={startPan}
    onpointermove={movePan}
    onpointerup={stopPan}
    onpointercancel={stopPan}
  >
    <defs>
      <marker
        id="flat-dependency-arrow"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent-amber)" /></marker
      >
    </defs>
    <g transform={`translate(${panX},${panY}) scale(${scale})`}>
      {#each layout.groups as group (group.id)}
        {#if layout.nodes.some((node) => visibleIds.has(node.id) && node.y >= group.y && node.y < group.y + group.height)}
          <rect
            class="group-outline"
            x={group.x}
            y={group.y}
            width={group.width}
            height={group.height}
            rx="14"
          />
          <text class="group-label" x={group.x + 36} y={group.y + 32}>{group.label}</text>
        {/if}
      {/each}
      {#each links as link (linkKey(link))}
        {@const from = endpointId(link.source)}{@const to = endpointId(link.target)}
        <path
          class="relationship"
          class:emphasized={selectedNode?.id === from || selectedNode?.id === to}
          class:muted={(impactMode &&
            !(link.type === 'depends_on' && impactIds.has(from) && impactIds.has(to))) ||
            (activeNetwork &&
              !(activeNetwork.members.includes(from) && activeNetwork.members.includes(to)))}
          d={linkPath(from, to)}
          stroke={link.type === 'depends_on' ? 'var(--accent-amber)' : 'var(--accent-purple)'}
          marker-end={link.type === 'depends_on' ? 'url(#flat-dependency-arrow)' : undefined}
          ><title
            >{link.type === 'depends_on'
              ? 'Declared dependency'
              : link.label || 'Kubernetes relationship'}</title
          ></path
        >
      {/each}
      {#each visibleNodes as node (node.id)}
        {@const position = positions.get(node.id)!}
        <foreignObject
          x={position.x}
          y={position.y}
          width={CARD_WIDTH}
          height={CARD_HEIGHT}
          class:dimmed={dimmed(node.id)}
        >
          <button
            class="service-card"
            class:alerted={anomalyIds.has(node.containerId) ||
              anomalyIds.has(node.entityId || node.id)}
            class:selected={selectedNode?.id === node.id}
            class:network-member={activeNetwork?.members.includes(node.id)}
            style:--node-tone={tone(node)}
            aria-label={`Select ${node.name}, ${status(node)}`}
            aria-pressed={selectedNode?.id === node.id}
            title={node.fullName}
            onclick={() => chooseNode(node)}
          >
            <span class="service-name"
              ><span class="status-dot"></span><strong>{node.name}</strong></span
            >
            <span class="service-detail-row">
              <span class="service-status"
                >{status(node)}{node.health === 'healthy' && node.status === 'running'
                  ? ' · healthy'
                  : ''}{anomalyIds.has(node.containerId) || anomalyIds.has(node.entityId || node.id)
                  ? ' · metric alert'
                  : ''}</span
              >
              {#if !activeNetwork && node.networks.length}
                <span class="service-networks">
                  {#each [...new Set(node.networks)].sort() as network (network)}
                    <span
                      class="service-network-light"
                      role="img"
                      aria-label={`Network: ${network}`}
                      title={network}
                      style:--network-tone={networkColor(network)}
                    ></span>
                  {/each}
                </span>
              {/if}
            </span>
            <span class="service-metrics"
              ><span>CPU {node.status === 'running' ? `${node.cpu.toFixed(1)}%` : '—'}</span><span
                >{node.status === 'running' ? formatBytes(node.memory) : '—'}</span
              ></span
            >
          </button>
        </foreignObject>
      {/each}
    </g>
  </svg>
  {#if data.nodes.length && !visibleNodes.length}<div class="no-matches">
      No services match the current filters.
    </div>{/if}
  <div class="legend" aria-label="Graph legend">
    <span><i class="dependency"></i>Declared dependency</span>
    {#if links.some((link) => link.type === 'kubernetes')}
      <span><i class="kubernetes"></i>Kubernetes relationship</span>
    {/if}
  </div>
  {#if networks.length}
    <section class="network-strip" aria-label="Shared networks">
      <div class="network-heading">
        <span>Networks <small>{networks.length}</small></span><span>Click to focus members</span>
      </div>
      <div class="network-list">
        <button
          class="network-reset"
          class:active={!selectedNetwork}
          aria-pressed={!selectedNetwork}
          onclick={() => (selectedNetwork = null)}>All</button
        >
        {#each networks as network (network.id)}
          <button
            class="network-chip"
            class:active={selectedNetwork === network.id}
            style:--network-tone={networkColor(network.name)}
            aria-label={`Highlight network ${network.name} on ${network.source}`}
            aria-pressed={selectedNetwork === network.id}
            onclick={() => {
              impactMode = false;
              selectedNetwork = selectedNetwork === network.id ? null : network.id;
            }}
            title={`${network.source} / ${network.name} — shared membership, not observed traffic`}
          >
            <span class="network-dot"></span><strong>{network.name}</strong>
            <span class="member-count">{network.members.length}</span>
            {#if multipleNetworkSources}<small>{network.source}</small>{/if}
          </button>
        {/each}
      </div>
    </section>
  {/if}
  <div class="graph-controls">
    <IconButton variant="surface" size={32} title="Zoom in" onclick={() => zoomAt(1.2)}
      ><span class="zoom-glyph">+</span></IconButton
    >
    <IconButton variant="surface" size={32} title="Zoom out" onclick={() => zoomAt(1 / 1.2)}
      ><span class="zoom-glyph">−</span></IconButton
    >
    <IconButton variant="surface" size={32} title="Zoom to fit" shortcut="F" onclick={zoomToFit}
      ><Icon name="fit" size={16} /></IconButton
    >
    <IconButton variant="surface" size={32} title="Reset view" shortcut="R" onclick={resetCamera}
      ><Icon name="restart" size={16} /></IconButton
    >
    {#if selectedNode}
      <IconButton
        variant="surface"
        size={32}
        title="Focus selected"
        shortcut="C"
        onclick={() => centerOnNode(selectedNode!)}><Icon name="focus" size={16} /></IconButton
      >
      <IconButton
        variant="surface"
        size={32}
        active={impactMode}
        title="Impact view"
        shortcut="I"
        onclick={toggleImpactMode}><Icon name="impact" size={16} /></IconButton
      >
    {/if}
    <IconButton
      variant="surface"
      size={32}
      title="Keyboard shortcuts"
      shortcut="?"
      onclick={onHelpClick}><span class="zoom-glyph">?</span></IconButton
    >
  </div>
</div>

<style>
  .flat-graph {
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--bg-void);
    background-image: radial-gradient(rgba(0, 228, 255, 0.09) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  svg {
    width: 100%;
    height: 100%;
    display: block;
    cursor: grab;
    touch-action: none;
  }
  svg.dragging {
    cursor: grabbing;
  }
  .group-outline {
    fill: rgba(8, 10, 24, 0.6);
    stroke: rgba(0, 228, 255, 0.12);
  }
  .group-label {
    fill: var(--text-secondary);
    font: 13px var(--font-ui);
    letter-spacing: 1px;
  }
  .relationship {
    fill: none;
    stroke-width: 1.6;
    opacity: 0.45;
  }
  .relationship.emphasized {
    stroke-width: 2;
    opacity: 0.9;
  }
  .relationship.muted {
    opacity: 0.08;
  }
  foreignObject {
    overflow: visible;
    transition: opacity 0.15s;
  }
  foreignObject.dimmed {
    opacity: 0.3;
  }
  .service-card {
    width: 100%;
    height: 100%;
    padding: 12px 14px;
    border: 1px solid rgba(122, 133, 153, 0.3);
    border-radius: 9px;
    background: var(--bg-surface-solid);
    color: var(--text-primary);
    font-family: var(--font-ui);
    text-align: left;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 5px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  }
  .service-card:hover,
  .service-card:focus-visible {
    border-color: var(--accent-cyan);
    background: #0d1b28;
    outline: 2px solid transparent;
  }
  .service-card.alerted {
    border-color: var(--accent-amber);
  }
  .service-card.selected {
    border: 2px solid var(--accent-cyan);
    padding: 11px 13px;
    background: #0b202a;
    box-shadow: 0 0 18px rgba(0, 228, 255, 0.1);
  }
  .service-name {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .service-name strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 16px;
    font-weight: 600;
  }
  .status-dot {
    width: 7px;
    height: 7px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--node-tone);
    box-shadow: 0 0 7px color-mix(in srgb, var(--node-tone) 35%, transparent);
  }
  .service-detail-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .service-networks {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 3px 5px;
    flex-shrink: 0;
    max-width: 72px;
    max-height: 24px;
    overflow-y: auto;
    padding: 2px;
  }
  .service-network-light {
    width: 7px;
    height: 7px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--network-tone);
    box-shadow: 0 0 5px color-mix(in srgb, var(--network-tone) 40%, transparent);
  }
  .service-status {
    color: var(--node-tone);
    font-size: 12px;
  }
  .service-metrics {
    display: flex;
    justify-content: space-between;
    color: var(--text-secondary);
    font: 11px var(--font-mono);
    margin-top: auto;
  }
  .service-card.network-member {
    border-color: var(--accent-cyan);
  }
  .network-strip {
    position: absolute;
    left: 64px;
    right: 16px;
    bottom: 16px;
    max-height: 128px;
    overflow-y: auto;
    padding: 10px 12px;
    border: 1px solid var(--border-glow);
    border-radius: 8px;
    background: var(--bg-surface-solid);
  }
  .network-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    font: 12px var(--font-ui);
    color: var(--text-secondary);
  }
  .network-heading small {
    margin-left: 4px;
    color: var(--accent-cyan);
  }
  .network-heading span:last-child {
    font-size: 11px;
  }
  .network-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .network-chip,
  .network-reset {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 10px;
    min-height: 32px;
    max-width: 100%;
    border: 1px solid var(--border-control);
    border-radius: 5px;
    background: var(--bg-inset);
    color: var(--text-secondary);
    font: 12px var(--font-ui);
    cursor: pointer;
  }
  .network-chip strong {
    font-weight: 500;
    overflow-wrap: anywhere;
    text-align: left;
  }
  .network-chip .network-dot {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--network-tone);
  }
  .network-chip .member-count {
    padding: 1px 5px;
    border-radius: 3px;
    color: var(--text-primary);
    background: var(--surface-chip);
    font: 11px var(--font-mono);
  }
  .network-chip small {
    font-size: 10px;
  }
  .network-chip:hover,
  .network-chip.active,
  .network-chip:focus-visible,
  .network-reset:hover,
  .network-reset.active,
  .network-reset:focus-visible {
    color: var(--text-primary);
    border-color: var(--control-border-strong);
    background: var(--control-bg);
  }
  .network-chip:focus-visible,
  .network-reset:focus-visible {
    outline: 2px solid var(--accent-cyan);
    outline-offset: 2px;
  }
  .legend {
    position: absolute;
    top: 72px;
    right: 16px;
    max-width: calc(100% - 76px);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    padding: 9px 12px;
    border: 1px solid var(--border-glow);
    border-radius: 7px;
    background: var(--bg-surface-solid);
    font-size: 11px;
    color: var(--text-secondary);
    pointer-events: none;
  }
  .legend span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .legend i {
    width: 18px;
    height: 0;
    border-top: 2px solid var(--accent-amber);
  }
  .legend i.kubernetes {
    border-color: var(--accent-purple);
  }
  .graph-controls {
    position: absolute;
    bottom: 16px;
    left: 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .zoom-glyph {
    font-size: 18px;
    line-height: 1;
  }
  .no-matches {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: var(--text-secondary);
    font-size: 14px;
  }
</style>
