<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
  import * as THREE from 'three';
  import type { GraphData, ServiceNode } from '../../types';
  import { GRAPH } from '../lib/constants';
  import { computeImportance } from '../lib/importance';
  import { buildNodeObject, highlightNode, getMeta, getNodeColor } from '../lib/nodeRenderer';
  import { createClusteringForce, updateClusters, cleanupAllClusters } from '../lib/clustering';
  import {
    addDeployAnimation,
    addStatusFlash,
    resetDeployIndex,
    tickAnimations,
    tickFlashAnimations,
    pulseWarningRings,
    orbitVolumeMoons,
    updateAnomalyIndicators,
    updateBillboardPositions,
  } from '../lib/animations';
  import { buildNetworkColorMap } from '../lib/networkColors';
  import { getDockerState } from '../stores/docker.svelte';

  interface Props {
    data: GraphData;
    onNodeClick: (node: ServiceNode) => void;
    selectedNode: ServiceNode | null;
    searchQuery: string;
    statusFilter: Set<string>;
    colorNetworks: boolean;
    onHelpClick: () => void;
  }

  let {
    data,
    onNodeClick,
    selectedNode,
    searchQuery,
    statusFilter,
    colorNetworks,
    onHelpClick,
  }: Props = $props();

  const docker = getDockerState();

  // --- Derived importance ---
  let importanceMap = $derived(computeImportance(data.nodes, data.links));

  // Cache anomaly IDs for animation loop (avoid reactive reads in rAF)
  let anomalyIds = new Set<string>();
  $effect(() => {
    const ids = new Set<string>();
    for (const key of docker.anomalies.keys()) {
      ids.add(key.split(':')[0]);
    }
    anomalyIds = ids;
  });

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
      if (
        !node.name?.toLowerCase().includes(q) &&
        !node.fullName?.toLowerCase().includes(q) &&
        !node.image?.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  }

  // --- Selection / hover state (plain vars to avoid reactive tracking in callbacks) ---
  let activeNodeId: string | null = null;
  let prevSelectedId: string | null = null;
  let selectedId: string | null = null;

  // --- Impact view mode ---
  let impactMode = $state(false);
  let impactedIds = $state<Set<string>>(new Set());

  /** Traverse depends_on links upstream: find all nodes that would break if `nodeId` goes down */
  function computeImpact(nodeId: string): Set<string> {
    const impacted = new Set<string>([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const link of data.links) {
        if (link.type !== 'depends_on') continue;
        const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;
        // src depends_on tgt — if tgt is impacted, src is too
        if (impacted.has(tgtId) && !impacted.has(srcId)) {
          impacted.add(srcId);
          changed = true;
        }
      }
    }
    return impacted;
  }

  function applyImpactDimming(nodes: any[], affected: Set<string>) {
    for (const node of nodes) {
      const obj = node.__threeObj;
      if (!obj) continue;
      const meta = getMeta(obj);
      if (!meta) continue;
      const dim = affected.size > 0 && !affected.has(node.id);

      // Core sphere
      if ((meta.coreMat as any).__origOpacity === undefined)
        (meta.coreMat as any).__origOpacity = meta.coreMat.opacity;
      meta.coreMat.opacity = dim ? 0.08 : (meta.coreMat as any).__origOpacity;

      // All children (rings, labels, moons)
      for (const child of obj.children) {
        const m = (child as any).material;
        if (!m) continue;
        if (m.__origOpacity === undefined) m.__origOpacity = m.opacity;
        m.opacity = dim ? 0.03 : m.__origOpacity;
      }
    }
  }

  let networkColorMap = $derived(buildNetworkColorMap(data.links));

  function getLinkColor(link: any): string {
    const s = typeof link.source === 'object' ? link.source : null;
    const t = typeof link.target === 'object' ? link.target : null;
    const hl = activeNodeId && (s?.id === activeNodeId || t?.id === activeNodeId);

    // Impact mode: only show depends_on links in the impact chain
    if (impactedIds.size > 0) {
      const inImpact =
        link.type === 'depends_on' && s && t && impactedIds.has(s.id) && impactedIds.has(t.id);
      if (inImpact) return '#ff8a2b';
      return 'rgba(255,255,255,0.02)';
    }

    if (link.type === 'depends_on') return hl ? 'rgba(255,138,43,0.5)' : 'rgba(255,138,43,0.08)';
    if (colorNetworks) {
      const rgb = networkColorMap.get(link.label) || '0,228,255';
      return hl ? `rgba(${rgb},0.6)` : `rgba(${rgb},0.18)`;
    }
    return hl ? 'rgba(0,228,255,0.6)' : 'rgba(0,228,255,0.15)';
  }

  function getLinkWidth(link: any): number {
    const s = typeof link.source === 'object' ? link.source : null;
    const t = typeof link.target === 'object' ? link.target : null;
    const hl = activeNodeId && (s?.id === activeNodeId || t?.id === activeNodeId);

    // Impact mode: only depends_on in the chain are visible
    if (impactedIds.size > 0) {
      const inImpact =
        link.type === 'depends_on' && s && t && impactedIds.has(s.id) && impactedIds.has(t.id);
      return inImpact ? 1 : 0.05;
    }

    const base = link.type === 'depends_on' ? 0.3 : 0.5;
    return hl ? base + 1 : base;
  }

  // --- Graph instance ---
  let container: HTMLDivElement;
  let graph: ForceGraph3DInstance | null = null;
  let clusterFrameId: number | null = null;

  onMount(() => {
    const FC = GRAPH.force;
    const CC = GRAPH.controls;

    const g = ForceGraph3D()(container)
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
      .linkDirectionalArrowLength((link: any) => (link.type === 'depends_on' ? 4 : 0))
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalArrowColor((link: any) => getLinkColor(link))
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
    graph = g;

    // Forces
    g.d3Force('charge')?.strength(FC.charge.strength).distanceMax(FC.charge.distanceMax);
    g.d3Force('link')?.distance(FC.link.distance);
    g.d3Force('center')?.strength(FC.center.strength);
    g.d3Force('x')?.strength(FC.position.strength);
    g.d3Force('y')?.strength(FC.position.strength);
    g.d3Force('z')?.strength(FC.position.strength);
    g.d3Force('cluster', createClusteringForce(FC.cluster.strength));

    // Controls
    const controls = g.controls?.();
    if (controls) {
      controls.zoomSpeed = CC.zoomSpeed;
      controls.rotateSpeed = CC.rotateSpeed;
      controls.panSpeed = CC.panSpeed;
    }

    const renderer = g.renderer?.();
    if (renderer) renderer.setClearColor(0x04040e, 1);

    // Resize
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      g.width(width).height(height);
    });
    observer.observe(container);

    // Animation loop (clusters + deploy anims + warning pulse)
    function loop() {
      updateClusters(g.scene(), g.graphData().nodes, isNodeVisible);
      tickAnimations();
      tickFlashAnimations();
      pulseWarningRings(warningRings);
      const nodes = g.graphData().nodes;
      const cam = g.camera();
      orbitVolumeMoons(nodes, cam);
      updateBillboardPositions(nodes, cam);
      updateAnomalyIndicators(nodes, anomalyIds);
      clusterFrameId = requestAnimationFrame(loop);
    }
    clusterFrameId = requestAnimationFrame(loop);

    return () => {
      if (clusterFrameId !== null) cancelAnimationFrame(clusterFrameId);
      cleanupAllClusters(g.scene());
      observer.disconnect();
      g._destructor?.();
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

  // --- Graph data update ---
  let prevGraphKey = '';
  let prevStatusMap = new Map<string, string>();
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

    const curStatusMap = new Map(data.nodes.map((n) => [n.id, `${n.status}:${n.health}`]));
    const graphKey = data.nodes
      .map((n) => `${n.id}:${n.status}:${n.health}`)
      .sort()
      .join(',');
    if (graphKey === prevGraphKey) return;

    // Detect which nodes changed status (for flash animation)
    const changedIds = new Set<string>();
    for (const [id, key] of curStatusMap) {
      const prev = prevStatusMap.get(id);
      if (prev && prev !== key) changedIds.add(id);
    }
    const oldStatusMap = prevStatusMap;
    prevStatusMap = curStatusMap;

    const prevIds = prevGraphKey
      ? new Set(prevGraphKey.split(',').map((k) => k.split(':')[0]))
      : new Set<string>();
    const curIds = new Set(data.nodes.map((n) => n.id));
    const isStructural = prevIds.size !== curIds.size || [...curIds].some((id) => !prevIds.has(id));
    prevGraphKey = graphKey;

    if (isStructural) {
      assignProjectPositions(data.nodes);
      resetDeployIndex();
    }

    warningRings.length = 0;
    graph.nodeThreeObject((node: any) => {
      const imp = importanceMap.get(node.id) || 0;
      const group = buildNodeObject(node, imp, hasBrokenDependency(node.id), warningRings);
      if (isStructural) addDeployAnimation(node.id, group);
      else if (changedIds.has(node.id)) {
        const prevKey = oldStatusMap.get(node.id) || 'exited:none';
        const [prevSt, prevHp] = prevKey.split(':');
        const prevColor = getNodeColor({ status: prevSt, health: prevHp });
        addStatusFlash(group, prevSt, node.status, prevColor);
      }
      return group;
    });
    graph.graphData(data);
  });

  // --- Selection effect ---
  $effect(() => {
    const sel = selectedNode;
    const impact = impactMode;
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

      // Impact view dimming
      if (impact && sel) {
        impactedIds = computeImpact(sel.id);
      } else {
        impactedIds = new Set();
      }
      applyImpactDimming(nodes, impactedIds);

      graph.linkColor(getLinkColor).linkWidth(getLinkWidth);
    });
  });

  // --- Re-apply link colors when colorNetworks toggles ---
  $effect(() => {
    if (!graph) return;
    void colorNetworks;
    graph.linkColor((link: any) => getLinkColor(link));
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
          (n) =>
            n.name.toLowerCase().includes(q) ||
            n.fullName?.toLowerCase().includes(q) ||
            n.image.toLowerCase().includes(q),
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
  export function toggleImpactMode() {
    impactMode = !impactMode;
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
        title="Focus selected (C)"
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
      <button
        class="graph-ctrl-btn"
        class:active={impactMode}
        title="Impact view (I)"
        onclick={toggleImpactMode}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
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
  .graph-ctrl-btn.active {
    color: #ff8a2b;
    border-color: rgba(255, 138, 43, 0.4);
    background: rgba(255, 138, 43, 0.12);
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
