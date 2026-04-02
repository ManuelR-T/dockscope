import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import { GRAPH } from './constants';

const NC = GRAPH.node;

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

export function createRingSprite(
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
  const emissive = isRunning ? 0.25 + importance * 0.3 : 0.1;
  const mat = new THREE.MeshPhongMaterial({
    color,
    emissive: color,
    emissiveIntensity: emissive,
    transparent: true,
    opacity: isRunning ? 0.88 : 0.4,
  });
  const sphere = new THREE.Mesh(geo, mat);
  group.add(sphere);
  (group as any).__coreMat = mat;
  (group as any).__baseEmissive = emissive;

  // Glow ring sprite
  let ringOuterEdge = radius;
  if (isRunning) {
    const ringInner = radius + NC.ringGap;
    const ringThickness = NC.ringThicknessBase + importance * NC.ringThicknessScale;
    const ringOpacity = 0.06 + importance * 0.14;
    ringOuterEdge = ringInner + ringThickness;
    group.add(createRingSprite(color, ringInner, ringOuterEdge, ringOpacity));
  }

  // Warning ring sprite (broken dependency)
  if (isRunning && hasBrokenDep) {
    const warnSprite = createRingSprite('#ff8a2b', radius + 3.5, radius + 5.5, 0.25);
    ringOuterEdge = Math.max(ringOuterEdge, radius + 5.5);
    group.add(warnSprite);
    warningRings.push(warnSprite);
  }

  // Volume moons (small spheres that will orbit the node)
  const volCount = node.volumeCount || 0;
  if (volCount > 0) {
    const moons: THREE.Mesh[] = [];
    const moonCount = Math.min(volCount, 5); // cap at 5 moons
    const orbitRadius = radius + 4;
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
    (group as any).__moons = moons;
    (group as any).__orbitRadius = orbitRadius;
    (group as any).__moonCount = moonCount;
    (group as any).__orbitPhase = Math.random() * Math.PI * 2;
  }

  // Anomaly indicator (hidden by default, toggled from GraphView)
  if (isRunning) {
    const anomalySprite = new SpriteText('!');
    anomalySprite.color = '#ffcc00';
    anomalySprite.textHeight = 3.5;
    anomalySprite.fontFace = "'Fira Code', monospace";
    anomalySprite.fontWeight = '700';
    anomalySprite.backgroundColor = 'rgba(255, 204, 0, 0.15)' as any;
    anomalySprite.padding = 1.5;
    anomalySprite.borderRadius = 2;
    anomalySprite.position.set(radius + 3, radius + 3, 0);
    (anomalySprite.material as THREE.SpriteMaterial).depthWrite = false;
    anomalySprite.visible = false;
    group.add(anomalySprite);
    (group as any).__anomalySprite = anomalySprite;
  }

  // Name label
  const label = new SpriteText(node.name);
  label.color = '#c8cede';
  label.textHeight = NC.labelHeight;
  label.fontFace = "'Fira Code', monospace";
  label.fontWeight = '400';
  label.backgroundColor = 'rgba(4, 4, 14, 0.65)' as any;
  label.padding = 1;
  label.borderRadius = 1.5;
  const labelDist = ringOuterEdge + NC.labelOffset;
  label.position.set(0, labelDist, 0);
  (label.material as THREE.SpriteMaterial).depthWrite = false;
  group.add(label);

  // Store refs for camera-relative positioning
  (group as any).__label = label;
  (group as any).__labelOffset = labelDist;
  (group as any).__radius = radius;

  return group;
}

/** Update an existing node's visual appearance without rebuilding the Three.js group */
export function updateNodeAppearance(node: any): void {
  const obj = node.__threeObj;
  if (!obj) return;
  const mat = (obj as any).__coreMat as THREE.MeshPhongMaterial | undefined;
  if (!mat) return;

  const color = getNodeColor(node);
  const isRunning = node.status === 'running';
  const opacity = isRunning ? 0.88 : 0.4;
  const emissive = isRunning ? (obj as any).__baseEmissive ?? 0.35 : 0.1;

  mat.color.set(color);
  mat.emissive.set(color);
  mat.emissiveIntensity = emissive;
  mat.opacity = opacity;
  mat.needsUpdate = true;

  // Toggle anomaly sprite visibility based on running state
  const anomaly = (obj as any).__anomalySprite as THREE.Sprite | undefined;
  if (anomaly && !isRunning) anomaly.visible = false;
}

export function highlightNode(node: any, active: boolean): void {
  if (!node?.__threeObj) return;
  const mat = (node.__threeObj as any).__coreMat;
  const baseEmissive = (node.__threeObj as any).__baseEmissive ?? 0.35;
  if (active) {
    node.__threeObj.scale.setScalar(1.25);
    if (mat) mat.emissiveIntensity = 0.9;
  } else {
    node.__threeObj.scale.setScalar(1);
    if (mat) mat.emissiveIntensity = baseEmissive;
  }
}
