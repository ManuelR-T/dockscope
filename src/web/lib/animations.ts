import * as THREE from 'three';
import { GRAPH } from './constants';

interface PendingAnim {
  obj: THREE.Group;
  start: number;
  dur: number;
}

const pendingAnims: PendingAnim[] = [];
const animatedNodes = new Set<string>();
let deployIndex = 0;

/**
 * Schedule a deploy animation for a new node.
 * Only animates the first time a node ID is seen.
 */
/** Reset deploy stagger counter (call on graph structure change) */
export function resetDeployIndex(): void {
  deployIndex = 0;
}

export function addDeployAnimation(nodeId: string, group: THREE.Group): void {
  if (animatedNodes.has(nodeId)) return;
  animatedNodes.add(nodeId);
  const idx = deployIndex++;
  group.scale.setScalar(0.01);
  setTimeout(() => {
    pendingAnims.push({
      obj: group,
      start: performance.now(),
      dur: GRAPH.node.deployDuration,
    });
  }, idx * GRAPH.node.deployStagger);
}

/**
 * Tick all pending deploy animations (call every frame).
 */
export function tickAnimations(): void {
  const now = performance.now();
  for (let i = pendingAnims.length - 1; i >= 0; i--) {
    const a = pendingAnims[i];
    const t = Math.min((now - a.start) / a.dur, 1);
    a.obj.scale.setScalar(1 - Math.pow(1 - t, 3)); // ease-out cubic
    if (t >= 1) pendingAnims.splice(i, 1);
  }
}

/**
 * Pulse warning ring sprite opacities (call every frame).
 */
export function pulseWarningRings(rings: THREE.Sprite[]): void {
  const pulse = 0.12 + Math.sin(performance.now() * 0.004) * 0.12;
  for (const ring of rings) {
    (ring.material as THREE.SpriteMaterial).opacity = pulse;
  }
}

/**
 * Update anomaly indicator visibility and pulse on graph nodes.
 * anomalyIds: set of container short IDs that currently have anomalies.
 */
export function updateAnomalyIndicators(nodes: any[], anomalyIds: Set<string>): void {
  const pulse = 0.6 + Math.sin(performance.now() * 0.006) * 0.4;
  for (const node of nodes) {
    const obj = node.__threeObj;
    if (!obj?.__anomalySprite) continue;
    const sprite = obj.__anomalySprite as THREE.Sprite;
    const hasAnomaly = anomalyIds.has(node.id);
    sprite.visible = hasAnomaly;
    if (hasAnomaly) {
      (sprite.material as THREE.SpriteMaterial).opacity = pulse;
    }
  }
}

/**
 * Reposition labels and anomaly indicators in the camera's view plane
 * so they stay screen-relative (label above, anomaly top-right).
 */
export function updateBillboardPositions(nodes: any[], camera: THREE.Camera): void {
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  right.setFromMatrixColumn(camera.matrixWorld, 0);
  up.setFromMatrixColumn(camera.matrixWorld, 1);

  for (const node of nodes) {
    const obj = node.__threeObj;
    if (!obj) continue;

    // Label: position "above" the node in screen space
    const label = obj.__label as THREE.Sprite | undefined;
    if (label) {
      const offset = obj.__labelOffset as number;
      label.position.set(up.x * offset, up.y * offset, up.z * offset);
    }

    // Anomaly indicator: position top-right in screen space
    const anomaly = obj.__anomalySprite as THREE.Sprite | undefined;
    if (anomaly && anomaly.visible) {
      const r = (obj.__radius as number) + 3;
      anomaly.position.set(
        right.x * r + up.x * r,
        right.y * r + up.y * r,
        right.z * r + up.z * r,
      );
    }
  }
}

/**
 * Orbit volume moons around their parent nodes in the camera's view plane
 * so they always appear to orbit on the ring (which is a billboard sprite).
 * Reads __moons, __orbitRadius, __moonCount from node.__threeObj.
 */
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export function orbitVolumeMoons(nodes: any[], camera: THREE.Camera): void {
  const t = performance.now() * 0.00005;
  // Get camera's right and up vectors (view plane)
  camera.getWorldDirection(_up);
  _right.crossVectors(_up, camera.up).normalize();
  _up
    .crossVectors(_right, _up.set(0, 0, 0).subVectors(_right, _right))
    .copy(camera.up)
    .normalize();
  // Simpler: extract from camera matrix
  _right.setFromMatrixColumn(camera.matrixWorld, 0);
  _up.setFromMatrixColumn(camera.matrixWorld, 1);

  for (const node of nodes) {
    const obj = node.__threeObj;
    if (!obj?.__moons) continue;
    const moons = obj.__moons as THREE.Mesh[];
    const r = obj.__orbitRadius as number;
    const count = obj.__moonCount as number;
    const phase = (obj.__orbitPhase as number) || 0;
    for (let i = 0; i < count; i++) {
      const angle = t + phase + (2 * Math.PI * i) / count;
      const cos = Math.cos(angle) * r;
      const sin = Math.sin(angle) * r;
      // Position in camera-aligned plane
      moons[i].position.set(
        _right.x * cos + _up.x * sin,
        _right.y * cos + _up.y * sin,
        _right.z * cos + _up.z * sin,
      );
    }
  }
}
