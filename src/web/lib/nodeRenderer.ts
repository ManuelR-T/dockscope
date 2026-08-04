import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  OctahedronGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TetrahedronGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import SpriteText from 'three-spritetext';
import { GRAPH } from './constants';
import type { SimNode } from './simTypes';

const NC = GRAPH.node;

/** Deployments, StatefulSets and DaemonSets share one visual treatment. */
export function isWorkloadKind(kind: string | undefined): boolean {
  return kind === 'deployment' || kind === 'statefulset' || kind === 'daemonset';
}

/** Group carrying our metadata under a private key */
type MetaGroup = Group & { __meta?: NodeMeta };

/** Typed metadata stored on each node's Three.js group */
export interface NodeMeta {
  coreMat: MeshPhongMaterial;
  baseEmissive: number;
  radius: number;
  label: Sprite;
  labelOffset: number;
  anomalySprite: Sprite | null;
  warningRing: Sprite | null;
  moons: Mesh[];
  orbitRadius: number;
  moonCount: number;
  orbitPhase: number;
}

/** Access typed metadata from a node's Three.js group */
export function getMeta(group: Group): NodeMeta | null {
  return (group as MetaGroup).__meta ?? null;
}

export const STATUS_COLORS: Record<string, string> = {
  'running:healthy': '#00ff6a',
  'running:none': '#00e4ff',
  'running:unhealthy': '#ff2b4e',
  'running:starting': '#ff8a2b',
  exited: '#2a3040',
  paused: '#a855f7',
  restarting: '#ff8a2b',
  dead: '#ff2b4e',
  created: '#3e4a5c',
  removing: '#3e4a5c',
};

/** Param is deliberately loose: status flashes pass transient string pairs, not full nodes */
export function getNodeColor(node: {
  status: string;
  health?: string;
  runtime?: string;
  kind?: string;
}): string {
  if (node.runtime === 'kubernetes') {
    if (node.kind === 'service') {
      return '#a855f7';
    }
    if (node.kind === 'ingress') {
      return '#ff8a2b';
    }
    if (node.kind === 'hpa') {
      return node.health === 'starting' ? '#ffcc00' : '#00e4ff';
    }
    if (isWorkloadKind(node.kind)) {
      // A workload mid-rollout is the one state worth spotting from across the
      // graph, so converging keeps the amber the rest of the UI uses.
      return node.health === 'starting' ? '#ffcc00' : '#22d3a6';
    }
  }
  if (node.status === 'running') {
    return STATUS_COLORS[`running:${node.health}`] || STATUS_COLORS['running:none'];
  }
  return STATUS_COLORS[node.status] || '#2a3040';
}

function createRingSprite(
  color: string,
  innerRadius: number,
  outerRadius: number,
  opacity: number,
): Sprite {
  const size = Math.ceil(outerRadius * 2 + 4);
  const canvas = document.createElement('canvas');
  canvas.width = size * 4;
  canvas.height = size * 4;
  const ctx = canvas.getContext('2d')!;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const s = canvas.width / size;

  ctx.beginPath();
  ctx.arc(cx, cy, outerRadius * s, 0, Math.PI * 2);
  ctx.arc(cx, cy, innerRadius * s, 0, Math.PI * 2, true);
  ctx.fillStyle = color;
  ctx.fill();

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  const mat = new SpriteMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const sprite = new Sprite(mat);
  sprite.scale.set(size, size, 1);
  return sprite;
}

export function buildNodeObject(
  node: SimNode,
  importance: number,
  hasBrokenDep: boolean,
  warningRings: Sprite[],
): Group {
  const group = new Group();
  const color = getNodeColor(node);
  const isRunning = node.status === 'running';
  const isKubernetes = node.runtime === 'kubernetes';

  const scale = 1 + importance * NC.importanceScale;
  const baseRadius = isRunning ? NC.baseRadius.running : NC.baseRadius.stopped;
  const radius = baseRadius * scale;

  // Core primitive
  const geo =
    isKubernetes && node.kind === 'service'
      ? new BoxGeometry(radius * 1.5, radius * 1.5, radius * 1.5)
      : isKubernetes && node.kind === 'hpa'
        ? new TetrahedronGeometry(radius * 1.35, 0)
        : // A workload is the controller above a cluster of pod spheres, so it
          // gets a faceted solid that reads as "these belong to me".
          isKubernetes && isWorkloadKind(node.kind)
          ? new OctahedronGeometry(radius * 1.4, 0)
          : new SphereGeometry(radius, NC.sphereSegments.w, NC.sphereSegments.h);
  const baseEmissive = isRunning ? 0.25 + importance * 0.3 : 0.1;
  const coreMat = new MeshPhongMaterial({
    color,
    emissive: color,
    emissiveIntensity: baseEmissive,
    transparent: true,
    opacity: isRunning ? 0.88 : 0.4,
  });
  group.add(new Mesh(geo, coreMat));

  // Glow ring
  let ringOuterEdge = radius;
  if (isRunning) {
    const ringInner = radius + NC.ringGap;
    const ringThickness = NC.ringThicknessBase + importance * NC.ringThicknessScale;
    ringOuterEdge = ringInner + ringThickness;
    group.add(createRingSprite(color, ringInner, ringOuterEdge, 0.06 + importance * 0.14));
  }

  // Warning ring
  let warningRing: Sprite | null = null;
  if (isRunning && hasBrokenDep) {
    warningRing = createRingSprite('#ff8a2b', radius + 3.5, radius + 5.5, 0.25);
    ringOuterEdge = Math.max(ringOuterEdge, radius + 5.5);
    group.add(warningRing);
    warningRings.push(warningRing);
  }

  // Volume moons
  const moons: Mesh[] = [];
  const volCount = node.volumeCount || 0;
  const moonCount = Math.min(volCount, 5);
  const orbitRadius = radius + 4;
  if (moonCount > 0) {
    const moonGeo = new SphereGeometry(0.5, 8, 6);
    const moonMat = new MeshBasicMaterial({
      color: '#a855f7',
      transparent: true,
      opacity: 0.6,
    });
    for (let i = 0; i < moonCount; i++) {
      const moon = new Mesh(moonGeo, moonMat);
      const angle = (2 * Math.PI * i) / moonCount;
      moon.position.set(Math.cos(angle) * orbitRadius, 0, Math.sin(angle) * orbitRadius);
      group.add(moon);
      moons.push(moon);
    }
  }

  // Anomaly indicator
  let anomalySprite: Sprite | null = null;
  if (isRunning) {
    const sprite = new SpriteText('!');
    sprite.color = '#ffcc00';
    sprite.textHeight = 3.5;
    sprite.fontFace = "'Fira Code', monospace";
    sprite.fontWeight = '700';
    sprite.backgroundColor = 'rgba(255, 204, 0, 0.15)';
    sprite.padding = 1.5;
    sprite.borderRadius = 2;
    sprite.position.set(radius + 3, radius + 3, 0);
    (sprite.material as SpriteMaterial).depthWrite = false;
    sprite.visible = false;
    group.add(sprite);
    anomalySprite = sprite;
  }

  // Label
  const label = new SpriteText(isKubernetes && node.kind ? `${node.kind}:${node.name}` : node.name);
  label.color = '#c8cede';
  label.textHeight = NC.labelHeight;
  label.fontFace = "'Fira Code', monospace";
  label.fontWeight = '400';
  label.backgroundColor = 'rgba(4, 4, 14, 0.65)';
  label.padding = 1;
  label.borderRadius = 1.5;
  const labelOffset = ringOuterEdge + NC.labelOffset;
  label.position.set(0, labelOffset, 0);
  (label.material as SpriteMaterial).depthWrite = false;
  group.add(label);

  // Store typed metadata
  const meta: NodeMeta = {
    coreMat,
    baseEmissive,
    radius,
    label,
    labelOffset,
    anomalySprite,
    warningRing,
    moons,
    orbitRadius,
    moonCount,
    orbitPhase: Math.random() * Math.PI * 2,
  };
  (group as MetaGroup).__meta = meta;

  return group;
}

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      disposeMaterial(item);
    }
    return;
  }
  const map = (material as Material & { map?: Texture }).map;
  map?.dispose();
  material.dispose();
}

function disposeObject(obj: Object3D): void {
  for (const child of [...obj.children]) {
    disposeObject(child);
  }
  const mesh = obj as Object3D & {
    geometry?: BufferGeometry;
    material?: Material | Material[];
  };
  mesh.geometry?.dispose();
  if (mesh.material) {
    disposeMaterial(mesh.material);
  }
}

export function refreshNodeObject(
  group: Group,
  node: SimNode,
  importance: number,
  hasBrokenDep: boolean,
  warningRings: Sprite[],
): void {
  const replacement = buildNodeObject(node, importance, hasBrokenDep, warningRings);
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject(child);
  }
  for (const child of [...replacement.children]) {
    replacement.remove(child);
    group.add(child);
  }
  (group as MetaGroup).__meta = (replacement as MetaGroup).__meta;
}

export function highlightNode(node: SimNode | null | undefined, active: boolean): void {
  if (!node?.__threeObj) {
    return;
  }
  const meta = getMeta(node.__threeObj);
  if (!meta) {
    return;
  }
  if (active) {
    node.__threeObj.scale.setScalar(1.25);
    meta.coreMat.emissiveIntensity = 0.9;
  } else {
    node.__threeObj.scale.setScalar(1);
    meta.coreMat.emissiveIntensity = meta.baseEmissive;
  }
}
