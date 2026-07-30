<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
  import { Vector3 } from 'three';
  import type { Sprite } from 'three';
  import type { GraphData, ServiceNode } from '../../types';
  import { GRAPH } from '../lib/constants';
  import { computeImportance } from '../lib/importance';
  import {
    buildNodeObject,
    highlightNode,
    getMeta,
    getNodeColor,
    refreshNodeObject,
  } from '../lib/nodeRenderer';
  import { createClusteringForce, updateClusters, cleanupAllClusters } from '../lib/clustering';
  import {
    addDeployAnimation,
    addRolloutExitAnimation,
    addStatusFlash,
    resetDeployIndex,
    tickAnimations,
    tickRolloutAnimations,
    tickFlashAnimations,
    pulseWarningRings,
    orbitVolumeMoons,
    updateAnomalyIndicators,
    updateBillboardPositions,
  } from '../lib/animations';
  import { buildNetworkColorMap } from '../lib/networkColors';
  import { endpointId } from '../lib/graphLinks';
  import {
    captureGraphSnapshot,
    diffGraphSnapshot,
    type GraphSnapshot,
  } from '../lib/graphReconcile';
  import {
    computeImpactNodeIds,
    findSearchMatches,
    hasBrokenDependency,
    isLinkVisible,
    isNodeVisible,
    type GraphFilters,
    type StatusFilter,
  } from '../lib/graphFilters';
  import { addToast, getDockerState } from '../stores/docker.svelte';
  import {
    buildGraphSVG,
    captureCanvasPNG,
    snapshotFilename,
    type ProjectedLink,
    type ProjectedNode,
  } from '../lib/snapshot';
  import { downloadBlob, downloadText } from '../lib/download';
  import Icon from './Icon.svelte';
  import { IconButton } from './ui';
  import type { PositionedSimNode, SimLink, SimNode } from '../lib/simTypes';

  /** Material that stashes its pre-dim opacity for impact-mode restore */
  type DimMaterial = { opacity: number; __origOpacity?: number };

  interface Props {
    data: GraphData;
    onNodeClick: (node: ServiceNode) => void;
    selectedNode: ServiceNode | null;
    searchQuery: string;
    statusFilter: Set<StatusFilter>;
    scopeFilter: string;
    colorNetworks: boolean;
    onHelpClick: () => void;
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
  }: Props = $props();

  const docker = getDockerState();

  // --- Derived importance ---
  let importanceMap = $derived(computeImportance(data.nodes, data.links));

  let graphFilters = $derived<GraphFilters>({ searchQuery, statusFilter, scopeFilter });

  // Cache anomaly IDs for animation loop (avoid reactive reads in rAF)
  let anomalyIds = new Set<string>();
  $effect(() => {
    const ids = new Set<string>();
    for (const key of docker.anomalies.keys()) {
      ids.add(key.split(':')[0]);
    }
    anomalyIds = ids;
  });

  // --- Warning rings (shared with animation system) ---
  const warningRings: Sprite[] = [];

  function syncWarningRingsFromGraph() {
    if (!graph) {
      return;
    }
    warningRings.length = 0;
    for (const node of graph.graphData().nodes as SimNode[]) {
      const meta = node.__threeObj ? getMeta(node.__threeObj) : null;
      if (meta?.warningRing) {
        warningRings.push(meta.warningRing);
      }
    }
  }

  function isGraphNodeVisible(node: ServiceNode): boolean {
    return isNodeVisible(node, graphFilters);
  }

  // --- Selection / hover state (plain vars to avoid reactive tracking in callbacks) ---
  let activeNodeId: string | null = null;
  let prevSelectedId: string | null = null;
  let selectedId: string | null = null;

  // --- Impact view mode ---
  let impactMode = $state(false);
  let impactedIds = $state<Set<string>>(new Set());

  function dimMaterial(mat: DimMaterial, dim: boolean, dimmedOpacity: number) {
    if (mat.__origOpacity === undefined) {
      mat.__origOpacity = mat.opacity;
    }
    mat.opacity = dim ? dimmedOpacity : mat.__origOpacity;
  }

  function applyImpactDimming(nodes: SimNode[], affected: Set<string>) {
    for (const node of nodes) {
      const obj = node.__threeObj;
      if (!obj) {
        continue;
      }
      const meta = getMeta(obj);
      if (!meta) {
        continue;
      }
      const dim = affected.size > 0 && !affected.has(node.id);

      // Core sphere
      dimMaterial(meta.coreMat as DimMaterial, dim, 0.08);

      // All children (rings, labels, moons)
      for (const child of obj.children) {
        const m = (child as { material?: DimMaterial }).material;
        if (m) {
          dimMaterial(m, dim, 0.03);
        }
      }
    }
  }

  function reapplySelectionAndImpact() {
    if (!graph) {
      return;
    }
    const nodes = graph.graphData().nodes as SimNode[];
    if (selectedId) {
      const selected = nodes.find((node) => node.id === selectedId);
      highlightNode(selected, true);
    }
    applyImpactDimming(nodes, impactedIds);
  }

  let networkColorMap = $derived(buildNetworkColorMap(data.links));

  function networkRgb(label: string | undefined): string {
    return (label && networkColorMap.get(label)) || '0,228,255';
  }

  function getLinkColor(link: SimLink): string {
    const sourceId = endpointId(link.source);
    const targetId = endpointId(link.target);
    const hl = activeNodeId && (sourceId === activeNodeId || targetId === activeNodeId);

    // Impact mode: only show depends_on links in the impact chain
    if (impactedIds.size > 0) {
      const inImpact =
        link.type === 'depends_on' && impactedIds.has(sourceId) && impactedIds.has(targetId);
      if (inImpact) {
        return '#ff8a2b';
      }
      return 'rgba(255,255,255,0.02)';
    }

    if (link.type === 'depends_on') {
      return hl ? 'rgba(255,138,43,0.5)' : 'rgba(255,138,43,0.08)';
    }
    if (link.type === 'kubernetes') {
      return hl ? 'rgba(168,85,247,0.55)' : 'rgba(168,85,247,0.16)';
    }
    if (colorNetworks) {
      const rgb = networkRgb(link.label);
      return hl ? `rgba(${rgb},0.6)` : `rgba(${rgb},0.18)`;
    }
    return hl ? 'rgba(0,228,255,0.6)' : 'rgba(0,228,255,0.15)';
  }

  function getLinkWidth(link: SimLink): number {
    const sourceId = endpointId(link.source);
    const targetId = endpointId(link.target);
    const hl = activeNodeId && (sourceId === activeNodeId || targetId === activeNodeId);

    // Impact mode: only depends_on in the chain are visible
    if (impactedIds.size > 0) {
      const inImpact =
        link.type === 'depends_on' && impactedIds.has(sourceId) && impactedIds.has(targetId);
      return inImpact ? 1 : 0.05;
    }

    const base = link.type === 'depends_on' ? 0.3 : link.type === 'kubernetes' ? 0.4 : 0.5;
    return hl ? base + 1 : base;
  }

  // --- Graph instance ---
  let container: HTMLDivElement;
  let graph: ForceGraph3DInstance | null = null;
  let clusterFrameId: number | null = null;

  onMount(() => {
    const FC = GRAPH.force;
    const CC = GRAPH.controls;

    // preserveDrawingBuffer keeps the frame readable for PNG snapshot export
    const g = ForceGraph3D({ rendererConfig: { preserveDrawingBuffer: true } })(container)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeId('id')
      .nodeThreeObject((node: SimNode) => {
        const imp = importanceMap.get(node.id) || 0;
        const group = buildNodeObject(node, imp, hasBrokenDependency(node.id, data), warningRings);
        if (node.rolloutPhase === 'terminating') {
          addRolloutExitAnimation(group);
        } else {
          addDeployAnimation(node.id, group);
        }
        return group;
      })
      .nodeThreeObjectExtend(false)
      .linkColor(getLinkColor)
      .linkWidth(getLinkWidth)
      .linkDirectionalArrowLength((link: SimLink) => (link.type === 'depends_on' ? 4 : 0))
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalArrowColor((link: SimLink) => getLinkColor(link))
      .linkOpacity(0.7)
      .linkLabel((link: SimLink) =>
        link.type === 'depends_on' ? 'depends_on' : link.label || link.type || '',
      )
      .cooldownTicks(100)
      .d3AlphaDecay(0.08)
      .d3VelocityDecay(0.6)
      .warmupTicks(80)
      .onNodeClick((node: SimNode) => onNodeClick(node))
      .onNodeHover((node: SimNode | null, prevNode: SimNode | null) => {
        container.style.cursor = node ? 'pointer' : 'default';
        if (prevNode && prevNode.id !== selectedId) {
          highlightNode(prevNode, false);
        }
        if (node) {
          highlightNode(node, true);
        }
      })
      .graphData(data);
    graph = g;
    currentSnapshot = captureGraphSnapshot(data);
    syncWarningRingsFromGraph();

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
    if (renderer) {
      renderer.setClearColor(0x04040e, 1);
    }

    // Resize
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      g.width(width).height(height);
    });
    observer.observe(container);

    // Animation loop (clusters + deploy anims + warning pulse)
    function loop() {
      updateClusters(g.scene(), g.graphData().nodes, isGraphNodeVisible);
      tickAnimations();
      tickRolloutAnimations();
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
      if (clusterFrameId !== null) {
        cancelAnimationFrame(clusterFrameId);
      }
      cleanupAllClusters(g.scene());
      observer.disconnect();
      g._destructor?.();
    };
  });

  // --- Initial host + project positioning ---
  function assignProjectPositions(nodes: SimNode[]) {
    // Group by host first
    const hosts = new Map<string, SimNode[]>();
    for (const node of nodes) {
      const h = node.host || 'local';
      if (!hosts.has(h)) {
        hosts.set(h, []);
      }
      hosts.get(h)!.push(node);
    }

    const multiHost = hosts.size > 1;
    const hostList = [...hosts.entries()];
    const hostRadius = multiHost ? 40 * Math.sqrt(nodes.length) : 0;
    const hostAngleStep = (2 * Math.PI) / hostList.length;

    hostList.forEach(([_, hostNodes], hi) => {
      const hostAngle = hostAngleStep * hi;
      const hx = multiHost ? Math.cos(hostAngle) * hostRadius : 0;
      const hz = multiHost ? Math.sin(hostAngle) * hostRadius : 0;

      // Group this host's nodes by project
      const projects = new Map<string, SimNode[]>();
      for (const node of hostNodes) {
        const p = node.project || '';
        if (!projects.has(p)) {
          projects.set(p, []);
        }
        projects.get(p)!.push(node);
      }

      if (projects.size <= 1 && !multiHost) {
        return;
      }

      const projectList = [...projects.entries()];
      const baseRadius = 20 * Math.sqrt(hostNodes.length);
      const angleStep = (2 * Math.PI) / projectList.length;

      projectList.forEach(([_, pNodes], i) => {
        const angle = angleStep * i;
        const cx = hx + Math.cos(angle) * baseRadius;
        const cz = hz + Math.sin(angle) * baseRadius;
        const cr = 8 * Math.sqrt(pNodes.length);
        pNodes.forEach((node, j) => {
          if (node.x !== undefined) {
            return;
          }
          const a = (2 * Math.PI * j) / pNodes.length;
          node.x = cx + Math.cos(a) * cr;
          node.y = (Math.random() - 0.5) * cr * 0.5;
          node.z = cz + Math.sin(a) * cr;
        });
      });
    });
  }

  // --- Graph data update ---
  let currentSnapshot: GraphSnapshot | null = null;
  $effect(() => {
    if (!graph) {
      return;
    }

    const diff = diffGraphSnapshot(currentSnapshot, data);
    if (!diff.needsGraphDataUpdate && diff.visualChangedNodeIds.size === 0) {
      currentSnapshot = captureGraphSnapshot(data);
      return;
    }

    if (diff.addedNodeIds.size > 0) {
      assignProjectPositions(data.nodes);
      resetDeployIndex();
    }

    const nodesToRefresh = new Set(diff.visualChangedNodeIds);
    if (diff.linksChanged) {
      for (const node of data.nodes) {
        nodesToRefresh.add(node.id);
      }
    } else if (diff.statusChangedNodeIds.size > 0) {
      for (const link of data.links) {
        if (link.type !== 'depends_on') {
          continue;
        }
        const sourceId = endpointId(link.source);
        const targetId = endpointId(link.target);
        if (targetId && diff.statusChangedNodeIds.has(targetId)) {
          nodesToRefresh.add(sourceId);
        }
      }
    }

    for (const node of data.nodes) {
      if (diff.addedNodeIds.has(node.id) || !nodesToRefresh.has(node.id)) {
        continue;
      }
      const group = (node as SimNode).__threeObj;
      if (!group) {
        continue;
      }
      const imp = importanceMap.get(node.id) || 0;
      refreshNodeObject(group, node, imp, hasBrokenDependency(node.id, data), warningRings);
      if (node.rolloutPhase === 'terminating') {
        addRolloutExitAnimation(group);
      } else if (diff.statusChangedNodeIds.has(node.id)) {
        const prevKey = currentSnapshot?.statusById.get(node.id) || 'exited:none';
        const [prevSt, prevHp] = prevKey.split(':');
        const prevColor = getNodeColor({ status: prevSt, health: prevHp });
        addStatusFlash(group, prevSt, node.status, prevColor);
      }
    }

    if (diff.needsGraphDataUpdate) {
      graph.graphData(data);
    }
    currentSnapshot = captureGraphSnapshot(data);
    syncWarningRingsFromGraph();
    reapplySelectionAndImpact();
  });

  // --- Selection effect ---
  $effect(() => {
    const sel = selectedNode;
    const impact = impactMode;
    untrack(() => {
      if (!graph) {
        return;
      }
      const nodes = graph.graphData().nodes as SimNode[];
      if (prevSelectedId) {
        const prev = nodes.find((n) => n.id === prevSelectedId);
        if (prev) {
          highlightNode(prev, false);
        }
      }
      if (sel) {
        const node = nodes.find((n) => n.id === sel.id);
        highlightNode(node, true);
      }
      prevSelectedId = sel?.id || null;
      activeNodeId = sel?.id || null;
      selectedId = sel?.id || null;

      // Impact view dimming
      if (impact && sel) {
        impactedIds = computeImpactNodeIds(sel.id, data.links);
      } else {
        impactedIds = new Set();
      }
      applyImpactDimming(nodes, impactedIds);

      graph.linkColor(getLinkColor).linkWidth(getLinkWidth);
    });
  });

  // --- Re-apply link colors when colorNetworks toggles ---
  $effect(() => {
    if (!graph) {
      return;
    }
    void colorNetworks;
    graph.linkColor((link: SimLink) => getLinkColor(link));
  });

  // --- Search + status filtering ---
  $effect(() => {
    if (!graph) {
      return;
    }
    const hasFilter = searchQuery || statusFilter.size > 0 || scopeFilter;
    if (!hasFilter) {
      graph.nodeVisibility(() => true);
      graph.linkVisibility(() => true);
    } else {
      graph.nodeVisibility((node: SimNode) => isNodeVisible(node, graphFilters));
      graph.linkVisibility((link: SimLink) => isLinkVisible(link, graphFilters));
      if (searchQuery) {
        const matches = findSearchMatches(data.nodes, searchQuery);
        if (matches.length === 1) {
          flyToNode(matches[0]);
        }
      }
    }
  });

  /** Fly the camera to frame a node, keeping it between camera and origin */
  function flyToNode(target: SimNode) {
    if (target.x === undefined || !graph) {
      return;
    }
    const n = target as PositionedSimNode;
    const dist = 120;
    const ratio = 1 + dist / Math.hypot(n.x || 1, n.y || 1, n.z || 1);
    graph.cameraPosition({ x: n.x * ratio, y: n.y * ratio, z: n.z * ratio }, n, 800);
  }

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
    const n = data.nodes.find((nd) => nd.id === node.id);
    if (n) {
      flyToNode(n);
    }
  }

  // --- Snapshot export ---

  export async function exportPNG() {
    const canvas: HTMLCanvasElement | undefined = graph?.renderer?.()?.domElement;
    if (!canvas) {
      return;
    }
    const blob = await captureCanvasPNG(canvas, `DockScope — ${new Date().toLocaleString()}`);
    if (blob) {
      downloadBlob(blob, snapshotFilename('png'));
      addToast('PNG snapshot exported', 'success');
    } else {
      addToast('PNG export failed', 'error');
    }
  }

  function svgLinkColor(link: SimLink): string {
    if (link.type === 'depends_on') {
      return 'rgba(255,138,43,0.5)';
    }
    if (link.type === 'kubernetes') {
      return 'rgba(168,85,247,0.5)';
    }
    if (colorNetworks) {
      return `rgba(${networkRgb(link.label)},0.4)`;
    }
    return 'rgba(0,228,255,0.35)';
  }

  function nodeLegendLabel(node: ServiceNode): string {
    if (node.status === 'running') {
      if (node.health === 'healthy') {
        return 'Running (healthy)';
      }
      if (node.health === 'unhealthy') {
        return 'Unhealthy';
      }
      if (node.health === 'starting') {
        return 'Starting';
      }
      return 'Running';
    }
    return node.status.charAt(0).toUpperCase() + node.status.slice(1);
  }

  export function exportSVG() {
    if (!graph) {
      return;
    }
    const cam = graph.camera();
    cam.updateMatrixWorld?.();
    const width = container.clientWidth;
    const height = container.clientHeight;
    const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);

    const nodesById = new Map<string, ProjectedNode>();
    const legendByLabel = new Map<string, string>();
    for (const node of data.nodes as SimNode[]) {
      if (node.x === undefined || !isNodeVisible(node, graphFilters)) {
        continue;
      }
      const pos = new Vector3(node.x, node.y || 0, node.z || 0);
      const p = pos.clone().project(cam);
      if (p.z > 1 || p.z < -1) {
        continue; // behind the camera or beyond the far plane
      }
      const imp = importanceMap.get(node.id) || 0;
      const baseRadius =
        node.status === 'running' ? GRAPH.node.baseRadius.running : GRAPH.node.baseRadius.stopped;
      const worldR = baseRadius * (1 + imp * GRAPH.node.importanceScale);
      const edge = pos.clone().addScaledVector(right, worldR).project(cam);
      const r = Math.max(
        2,
        Math.hypot(((edge.x - p.x) / 2) * width, ((edge.y - p.y) / 2) * height),
      );
      const projected: ProjectedNode = {
        x: ((p.x + 1) / 2) * width,
        y: ((1 - p.y) / 2) * height,
        r,
        color: getNodeColor(node),
        label: node.name,
        depth: p.z,
      };
      nodesById.set(node.id, projected);
      legendByLabel.set(nodeLegendLabel(node), getNodeColor(node));
    }

    const links: ProjectedLink[] = [];
    for (const link of data.links) {
      if (!isLinkVisible(link, graphFilters)) {
        continue;
      }
      const s = nodesById.get(endpointId(link.source));
      const t = nodesById.get(endpointId(link.target));
      if (!s || !t) {
        continue;
      }
      links.push({
        x1: s.x,
        y1: s.y,
        x2: t.x,
        y2: t.y,
        color: svgLinkColor(link),
        width: link.type === 'depends_on' ? 1.2 : 1,
        arrow: link.type === 'depends_on',
      });
    }

    const svg = buildGraphSVG({
      width,
      height,
      nodes: [...nodesById.values()],
      links,
      subtitle: `${nodesById.size} containers — ${new Date().toLocaleString()}`,
      legend: [...legendByLabel.entries()].map(([label, color]) => ({ label, color })),
    });
    downloadText(svg, 'image/svg+xml', snapshotFilename('svg'));
    addToast('SVG snapshot exported', 'success');
  }
</script>

<div class="graph-wrapper">
  <div bind:this={container} style="width: 100%; height: 100%;"></div>

  <div class="graph-controls">
    <IconButton variant="surface" size={32} title="Zoom to fit (F)" onclick={zoomToFit}>
      <Icon name="fit" size={16} />
    </IconButton>
    <IconButton variant="surface" size={32} title="Reset camera (R)" onclick={resetCamera}>
      <Icon name="restart" size={16} strokeWidth={2} />
    </IconButton>
    {#if selectedNode}
      <IconButton
        variant="surface"
        size={32}
        title="Focus selected (C)"
        onclick={() => centerOnNode(selectedNode!)}
      >
        <Icon name="focus" size={16} />
      </IconButton>
      <IconButton
        variant="surface"
        size={32}
        active={impactMode}
        title="Impact view (I)"
        onclick={toggleImpactMode}
      >
        <Icon name="impact" size={16} />
      </IconButton>
    {/if}
    <span class="ctrl-divider"></span>
    <IconButton variant="surface" size={32} title="Export PNG snapshot" onclick={exportPNG}>
      <Icon name="camera" size={15} />
    </IconButton>
    <IconButton variant="surface" size={32} title="Export SVG snapshot" onclick={exportSVG}>
      <span class="export-glyph">SVG</span>
    </IconButton>
    <span class="ctrl-divider"></span>
    <IconButton variant="surface" size={32} title="Keyboard shortcuts (?)" onclick={onHelpClick}>
      <span class="help-glyph">?</span>
    </IconButton>
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
  .ctrl-divider {
    width: 18px;
    height: 1px;
    background: rgba(0, 228, 255, 0.08);
    margin: 4px auto;
    border-radius: 1px;
  }
  .help-glyph {
    font-family: 'Fira Code', monospace;
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: 1;
  }
  .export-glyph {
    font-family: 'Fira Code', monospace;
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: 0.5px;
    line-height: 1;
  }
</style>
