import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import { GRAPH } from './constants';

const NC = GRAPH.node;

/** Typed metadata stored on each node's Three.js group */
export interface NodeMeta {
  coreMat: THREE.MeshPhongMaterial;
  baseEmissive: number;
  radius: number;
  label: THREE.Sprite;
  labelOffset: number;
  anomalySprite: THREE.Sprite | null;
  warningRing: THREE.Sprite | null;
  moons: THREE.Mesh[];
  orbitRadius: number;
  moonCount: number;
  orbitPhase: number;
}

/** Access typed metadata from a node's Three.js group */
export function getMeta(group: THREE.Group): NodeMeta | null {
  return (group as any).__meta ?? null;
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

export function getNodeColor(node: any): string {
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
): THREE.Sprite {
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

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  return sprite;
}

export function buildNodeObject(
  node: any,
  importance: number,
  hasBrokenDep: boolean,
  warningRings: THREE.Sprite[],
): THREE.Group {
  const group = new THREE.Group();
  const color = getNodeColor(node);
  const isRunning = node.status === 'running';

  const scale = 1 + importance * NC.importanceScale;
  const baseRadius = isRunning ? NC.baseRadius.running : NC.baseRadius.stopped;
  const radius = baseRadius * scale;

  // Core sphere
  const geo = new THREE.SphereGeometry(radius, NC.sphereSegments.w, NC.sphereSegments.h);
  const baseEmissive = isRunning ? 0.25 + importance * 0.3 : 0.1;
  const coreMat = new THREE.MeshPhongMaterial({
    color,
    emissive: color,
    emissiveIntensity: baseEmissive,
    transparent: true,
    opacity: isRunning ? 0.88 : 0.4,
  });
  group.add(new THREE.Mesh(geo, coreMat));

  // Glow ring
  let ringOuterEdge = radius;
  if (isRunning) {
    const ringInner = radius + NC.ringGap;
    const ringThickness = NC.ringThicknessBase + importance * NC.ringThicknessScale;
    ringOuterEdge = ringInner + ringThickness;
    group.add(createRingSprite(color, ringInner, ringOuterEdge, 0.06 + importance * 0.14));
  }

  // Warning ring
  let warningRing: THREE.Sprite | null = null;
  if (isRunning && hasBrokenDep) {
    warningRing = createRingSprite('#ff8a2b', radius + 3.5, radius + 5.5, 0.25);
    ringOuterEdge = Math.max(ringOuterEdge, radius + 5.5);
    group.add(warningRing);
    warningRings.push(warningRing);
  }

  // Volume moons
  const moons: THREE.Mesh[] = [];
  const volCount = node.volumeCount || 0;
  const moonCount = Math.min(volCount, 5);
  const orbitRadius = radius + 4;
  if (moonCount > 0) {
    const moonGeo = new THREE.SphereGeometry(0.5, 8, 6);
    const moonMat = new THREE.MeshBasicMaterial({
      color: '#a855f7',
      transparent: true,
      opacity: 0.6,
    });
    for (let i = 0; i < moonCount; i++) {
      const moon = new THREE.Mesh(moonGeo, moonMat);
      const angle = (2 * Math.PI * i) / moonCount;
      moon.position.set(Math.cos(angle) * orbitRadius, 0, Math.sin(angle) * orbitRadius);
      group.add(moon);
      moons.push(moon);
    }
  }

  // Anomaly indicator
  let anomalySprite: THREE.Sprite | null = null;
  if (isRunning) {
    const sprite = new SpriteText('!');
    sprite.color = '#ffcc00';
    sprite.textHeight = 3.5;
    sprite.fontFace = "'Fira Code', monospace";
    sprite.fontWeight = '700';
    sprite.backgroundColor = 'rgba(255, 204, 0, 0.15)' as any;
    sprite.padding = 1.5;
    sprite.borderRadius = 2;
    sprite.position.set(radius + 3, radius + 3, 0);
    (sprite.material as THREE.SpriteMaterial).depthWrite = false;
    sprite.visible = false;
    group.add(sprite);
    anomalySprite = sprite;
  }

  // Label
  const label = new SpriteText(node.name);
  label.color = '#c8cede';
  label.textHeight = NC.labelHeight;
  label.fontFace = "'Fira Code', monospace";
  label.fontWeight = '400';
  label.backgroundColor = 'rgba(4, 4, 14, 0.65)' as any;
  label.padding = 1;
  label.borderRadius = 1.5;
  const labelOffset = ringOuterEdge + NC.labelOffset;
  label.position.set(0, labelOffset, 0);
  (label.material as THREE.SpriteMaterial).depthWrite = false;
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
  (group as any).__meta = meta;

  return group;
}

export function highlightNode(node: any, active: boolean): void {
  if (!node?.__threeObj) return;
  const meta = getMeta(node.__threeObj);
  if (!meta) return;
  if (active) {
    node.__threeObj.scale.setScalar(1.25);
    meta.coreMat.emissiveIntensity = 0.9;
  } else {
    node.__threeObj.scale.setScalar(1);
    meta.coreMat.emissiveIntensity = meta.baseEmissive;
  }
}
