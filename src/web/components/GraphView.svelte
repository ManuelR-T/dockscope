<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import ForceGraph3D from '3d-force-graph';
  import * as THREE from 'three';
  import type { GraphData, ServiceNode } from '../../types';
  import { GRAPH } from '../lib/constants';
  import { computeImportance } from '../lib/importance';
  import { buildNodeObject, highlightNode } from '../lib/nodeRenderer';
  import { createClusteringForce, updateClusters, cleanupAllClusters } from '../lib/clustering';
  import { addDeployAnimation, tickAnimations, pulseWarningRings } from '../lib/animations';

  interface Props {
    data: GraphData;
    onNodeClick: (node: ServiceNode) => void;
    selectedNode: ServiceNode | null;
    searchQuery: string;
    statusFilter: Set<string>;
    onHelpClick: () => void;
  }

  let { data, onNodeClick, selectedNode, searchQuery, statusFilter, onHelpClick }: Props = $props();

  // --- Derived importance ---
  let importanceMap = $derived(computeImportance(data.nodes, data.links));

  // --- Health propagation ---
  function hasBrokenDependency(nodeId: string): boolean {
    for (const link of data.links) {
      if (link.type !== 'depends_on') continue;
      const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;
      if (srcId !== nodeId) continue;
      const target = data.nodes.find((n) => n.id === tgtId);
      if (target && (target.status !== 'running' || target.health === 'unhealthy')) return true;
    }
    return false;
  }

  // --- Warning rings (shared with animation system) ---
  const warningRings: THREE.Sprite[] = [];

  // --- Node visibility ---
  function isNodeVisible(node: any): boolean {
    if (statusFilter.size > 0) {
      const match =
        (statusFilter.has('running') && node.status === 'running') ||
        (statusFilter.has('stopped') && node.status !== 'running') ||
        (statusFilter.has('unhealthy') && node.health === 'unhealthy');
      if (!match) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!node.name?.toLowerCase().includes(q) && !node.image?.toLowerCase().includes(q))
        return false;
    }
    return true;
  }

  // --- Selection / hover state (plain vars to avoid reactive tracking in callbacks) ---
  let activeNodeId: string | null = null;
  let prevSelectedId: string | null = null;
  let selectedId: string | null = null;

  function getLinkColor(link: any): string {
    const s = typeof link.source === 'object' ? link.source : null;
    const t = typeof link.target === 'object' ? link.target : null;
    const hl = activeNodeId && (s?.id === activeNodeId || t?.id === activeNodeId);
    if (link.type === 'depends_on') return hl ? 'rgba(255,138,43,0.5)' : 'rgba(255,138,43,0.1)';
    return hl ? 'rgba(0,228,255,0.6)' : 'rgba(0,228,255,0.15)';
  }

  function getLinkWidth(link: any): number {
    const s = typeof link.source === 'object' ? link.source : null;
    const t = typeof link.target === 'object' ? link.target : null;
    const hl = activeNodeId && (s?.id === activeNodeId || t?.id === activeNodeId);
    const base = link.type === 'depends_on' ? 0.3 : 0.5;
    return hl ? base + 1 : base;
  }

  // --- Graph instance ---
  let container: HTMLDivElement;
  let graph: ReturnType<typeof ForceGraph3D> | null = null;
  let clusterFrameId: number | null = null;

  onMount(() => {
    const FC = GRAPH.force;
    const CC = GRAPH.controls;

    graph = ForceGraph3D()(container)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeId('id')
      .nodeThreeObject((node: any) => {
        const imp = importanceMap.get(node.id) || 0;
        const group = buildNodeObject(node, imp, hasBrokenDependency(node.id), warningRings);
        addDeployAnimation(node.id, group);
        return group;
      })
      .nodeThreeObjectExtend(false)
      .linkColor(getLinkColor)
      .linkWidth(getLinkWidth)
      .linkDirectionalArrowLength((link: any) => (link.type === 'depends_on' ? 3 : 0))
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalArrowColor((link: any) =>
        link.type === 'depends_on' ? 'rgba(255,138,43,0.25)' : undefined,
      )
      .linkOpacity(0.7)
      .linkLabel((link: any) => (link.type === 'depends_on' ? 'depends_on' : link.label || ''))
      .cooldownTicks(100)
      .d3AlphaDecay(0.08)
      .d3VelocityDecay(0.6)
      .warmupTicks(80)
      .onNodeClick((node: any) => onNodeClick(node as ServiceNode))
      .onNodeHover((node: any, prevNode: any) => {
        container.style.cursor = node ? 'pointer' : 'default';
        if (prevNode && prevNode.id !== selectedId) highlightNode(prevNode, false);
        if (node) highlightNode(node, true);
      })
      .graphData(data);

    // Forces
    graph.d3Force('charge')?.strength(FC.charge.strength).distanceMax(FC.charge.distanceMax);
    graph.d3Force('link')?.distance(FC.link.distance);
    graph.d3Force('center')?.strength(FC.center.strength);
    graph.d3Force('x')?.strength(FC.position.strength);
    graph.d3Force('y')?.strength(FC.position.strength);
    graph.d3Force('z')?.strength(FC.position.strength);
    graph.d3Force('cluster', createClusteringForce(FC.cluster.strength));

    // Controls
    const controls = graph.controls?.();
    if (controls) {
      controls.zoomSpeed = CC.zoomSpeed;
      controls.rotateSpeed = CC.rotateSpeed;
      controls.panSpeed = CC.panSpeed;
    }

    const renderer = graph.renderer?.();
    if (renderer) renderer.setClearColor(0x04040e, 1);

    // Resize
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      graph?.width(width).height(height);
    });
    observer.observe(container);

    // Animation loop (clusters + deploy anims + warning pulse)
    function loop() {
      if (graph) {
        updateClusters(
          graph.scene(),
          (graph.graphData() as GraphData).nodes as any[],
          isNodeVisible,
        );
      }
      tickAnimations();
      pulseWarningRings(warningRings);
      clusterFrameId = requestAnimationFrame(loop);
    }
    clusterFrameId = requestAnimationFrame(loop);

    return () => {
      if (clusterFrameId !== null) cancelAnimationFrame(clusterFrameId);
      if (graph) cleanupAllClusters(graph.scene());
      observer.disconnect();
      graph?._destructor?.();
    };
  });

  // --- Initial project positioning ---
  function assignProjectPositions(nodes: any[]) {
    const projects = new Map<string, any[]>();
    for (const node of nodes) {
      const p = node.project || '';
      if (!projects.has(p)) projects.set(p, []);
      projects.get(p)!.push(node);
    }
    if (projects.size <= 1) return;

    const projectList = [...projects.entries()];
    const baseRadius = 20 * Math.sqrt(nodes.length);
    const angleStep = (2 * Math.PI) / projectList.length;

    projectList.forEach(([_, pNodes], i) => {
      const angle = angleStep * i;
      const cx = Math.cos(angle) * baseRadius;
      const cz = Math.sin(angle) * baseRadius;
      const cr = 8 * Math.sqrt(pNodes.length);
      pNodes.forEach((node: any, j: number) => {
        if (node.x !== undefined) return;
        const a = (2 * Math.PI * j) / pNodes.length;
        node.x = cx + Math.cos(a) * cr;
        node.y = (Math.random() - 0.5) * cr * 0.5;
        node.z = cz + Math.sin(a) * cr;
      });
    });
  }

  // --- Graph data update (structure or status change) ---
  let prevGraphKey = '';
  $effect(() => {
    if (!graph) return;
    if (data.nodes.length === 0) {
      if (prevGraphKey !== '') {
        prevGraphKey = '';
        warningRings.length = 0;
        graph.graphData({ nodes: [], links: [] });
      }
      return;
    }
    const graphKey = data.nodes
      .map((n) => `${n.id}:${n.status}:${n.health}`)
      .sort()
      .join(',');
    if (graphKey !== prevGraphKey) {
      const isStructural =
        prevGraphKey === '' ||
        data.nodes
          .map((n) => n.id)
          .sort()
          .join(',') !== prevGraphKey.replace(/:[^,]*/g, '').replace(/:/g, '');
      prevGraphKey = graphKey;
      if (isStructural) assignProjectPositions(data.nodes);
      warningRings.length = 0;
      graph.nodeThreeObject((node: any) => {
        const imp = importanceMap.get(node.id) || 0;
        const group = buildNodeObject(node, imp, hasBrokenDependency(node.id), warningRings);
        addDeployAnimation(node.id, group);
        return group;
      });
      graph.graphData(data);
    }
  });

  // --- Selection effect ---
  $effect(() => {
    const sel = selectedNode;
    untrack(() => {
      if (!graph) return;
      const nodes = (graph.graphData() as any).nodes as any[];
      if (prevSelectedId) {
        const prev = nodes.find((n: any) => n.id === prevSelectedId);
        if (prev) highlightNode(prev, false);
      }
      if (sel) {
        const node = nodes.find((n: any) => n.id === sel.id);
        highlightNode(node, true);
      }
      prevSelectedId = sel?.id || null;
      activeNodeId = sel?.id || null;
      selectedId = sel?.id || null;
      graph.linkColor(getLinkColor).linkWidth(getLinkWidth);
    });
  });

  // --- Search + status filtering ---
  $effect(() => {
    if (!graph) return;
    const hasFilter = searchQuery || statusFilter.size > 0;
    if (!hasFilter) {
      graph.nodeVisibility(() => true);
      graph.linkVisibility(() => true);
    } else {
      graph.nodeVisibility((node: any) => isNodeVisible(node));
      graph.linkVisibility((link: any) => {
        const s = typeof link.source === 'object' ? link.source : null;
        const t = typeof link.target === 'object' ? link.target : null;
        return (s ? isNodeVisible(s) : true) && (t ? isNodeVisible(t) : true);
      });
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matches = data.nodes.filter(
          (n) => n.name.toLowerCase().includes(q) || n.image.toLowerCase().includes(q),
        );
        if (matches.length === 1) {
          const node = matches[0] as any;
          if (node.x !== undefined) {
            const dist = 120;
            const ratio = 1 + dist / Math.hypot(node.x || 1, node.y || 1, node.z || 1);
            graph.cameraPosition(
              { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio },
              node,
              800,
            );
          }
        }
      }
    }
  });

  // --- Exported controls ---
  export function zoomToFit() {
    graph?.zoomToFit(400);
  }
  export function resetCamera() {
    graph?.cameraPosition({ x: 0, y: 0, z: 300 }, { x: 0, y: 0, z: 0 }, 800);
  }
  export function centerOnNode(node: ServiceNode) {
    const n = data.nodes.find((nd: any) => nd.id === node.id) as any;
    if (n?.x !== undefined && graph) {
      const dist = 120;
      const ratio = 1 + dist / Math.hypot(n.x || 1, n.y || 1, n.z || 1);
      graph.cameraPosition({ x: n.x * ratio, y: n.y * ratio, z: n.z * ratio }, n, 800);
    }
  }
</script>

<div class="graph-wrapper">
  <div bind:this={container} style="width: 100%; height: 100%;"></div>

  <div class="graph-controls">
    <button class="graph-ctrl-btn" title="Zoom to fit (F)" onclick={zoomToFit}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      </svg>
    </button>
    <button class="graph-ctrl-btn" title="Reset camera (R)" onclick={resetCamera}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
    </button>
    {#if selectedNode}
      <button
        class="graph-ctrl-btn"
        title="Center on selected"
        onclick={() => centerOnNode(selectedNode!)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      </button>
    {/if}
    <span class="ctrl-divider"></span>
    <button class="graph-ctrl-btn help-btn" title="Keyboard shortcuts (?)" onclick={onHelpClick}>
      <span class="help-glyph">?</span>
    </button>
  </div>
</div>

<style>
  .graph-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .graph-controls {
    position: absolute;
    left: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 10;
  }
  .graph-ctrl-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(8, 10, 24, 0.7);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(0, 228, 255, 0.1);
    border-radius: 6px;
    color: rgba(122, 133, 153, 0.8);
    cursor: pointer;
    transition: all 0.2s;
  }
  .graph-ctrl-btn:hover {
    color: #00e4ff;
    border-color: rgba(0, 228, 255, 0.25);
    background: rgba(0, 228, 255, 0.08);
  }
  .ctrl-divider {
    width: 18px;
    height: 1px;
    background: rgba(0, 228, 255, 0.08);
    margin: 4px auto;
    border-radius: 1px;
  }
  .help-glyph {
    font-family: 'Fira Code', monospace;
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
  }
</style>
