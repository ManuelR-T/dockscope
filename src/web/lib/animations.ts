import * as THREE from 'three';
import { GRAPH } from './constants';
import { getMeta } from './nodeRenderer';

interface PendingAnim {
  obj: THREE.Group;
  start: number;
  dur: number;
}

const pendingAnims: PendingAnim[] = [];
const animatedNodes = new Set<string>();
let deployIndex = 0;

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

/** Tick all pending deploy animations (call every frame). */
export function tickAnimations(): void {
  const now = performance.now();
  for (let i = pendingAnims.length - 1; i >= 0; i--) {
    const a = pendingAnims[i];
    const t = Math.min((now - a.start) / a.dur, 1);
    a.obj.scale.setScalar(1 - Math.pow(1 - t, 3));
    if (t >= 1) pendingAnims.splice(i, 1);
  }
}

/** State change flash animation — brief emissive + scale pulse. */
interface FlashAnim {
  group: THREE.Group;
  start: number;
  baseEmissive: number;
}

const flashAnims: FlashAnim[] = [];
const FLASH_DURATION = 600;

export function addStatusFlash(group: THREE.Group): void {
  const meta = getMeta(group);
  if (!meta) return;
  // Kick the flash
  meta.coreMat.emissiveIntensity = 1.0;
  group.scale.setScalar(1.3);
  flashAnims.push({ group, start: performance.now(), baseEmissive: meta.baseEmissive });
}

/** Tick flash animations (call every frame alongside tickAnimations). */
export function tickFlashAnimations(): void {
  const now = performance.now();
  for (let i = flashAnims.length - 1; i >= 0; i--) {
    const f = flashAnims[i];
    const t = Math.min((now - f.start) / FLASH_DURATION, 1);
    const ease = 1 - t * t; // ease-out quadratic (starts fast, slows down)
    const meta = getMeta(f.group);
    if (meta) {
      meta.coreMat.emissiveIntensity = f.baseEmissive + (1.0 - f.baseEmissive) * ease;
    }
    f.group.scale.setScalar(1 + 0.3 * ease);
    if (t >= 1) flashAnims.splice(i, 1);
  }
}

/** Pulse warning ring sprite opacities (call every frame). */
export function pulseWarningRings(rings: THREE.Sprite[]): void {
  const pulse = 0.12 + Math.sin(performance.now() * 0.004) * 0.12;
  for (const ring of rings) {
    (ring.material as THREE.SpriteMaterial).opacity = pulse;
  }
}

/** Update anomaly indicator visibility and pulse on graph nodes. */
export function updateAnomalyIndicators(nodes: any[], anomalyIds: Set<string>): void {
  const pulse = 0.6 + Math.sin(performance.now() * 0.006) * 0.4;
  for (const node of nodes) {
    const meta = node.__threeObj ? getMeta(node.__threeObj) : null;
    if (!meta?.anomalySprite) continue;
    const hasAnomaly = anomalyIds.has(node.id);
    meta.anomalySprite.visible = hasAnomaly;
    if (hasAnomaly) {
      (meta.anomalySprite.material as THREE.SpriteMaterial).opacity = pulse;
    }
  }
}

/** Reposition labels and anomaly indicators in the camera's view plane. */
export function updateBillboardPositions(nodes: any[], camera: THREE.Camera): void {
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  right.setFromMatrixColumn(camera.matrixWorld, 0);
  up.setFromMatrixColumn(camera.matrixWorld, 1);

  for (const node of nodes) {
    const meta = node.__threeObj ? getMeta(node.__threeObj) : null;
    if (!meta) continue;

    // Label: position "above" in screen space
    const d = meta.labelOffset;
    meta.label.position.set(up.x * d, up.y * d, up.z * d);

    // Anomaly: position top-right in screen space
    if (meta.anomalySprite?.visible) {
      const r = meta.radius + 3;
      meta.anomalySprite.position.set(
        right.x * r + up.x * r,
        right.y * r + up.y * r,
        right.z * r + up.z * r,
      );
    }
  }
}

/** Orbit volume moons in the camera's view plane. */
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export function orbitVolumeMoons(nodes: any[], camera: THREE.Camera): void {
  const t = performance.now() * 0.00005;
  _right.setFromMatrixColumn(camera.matrixWorld, 0);
  _up.setFromMatrixColumn(camera.matrixWorld, 1);

  for (const node of nodes) {
    const meta = node.__threeObj ? getMeta(node.__threeObj) : null;
    if (!meta || meta.moonCount === 0) continue;
    for (let i = 0; i < meta.moonCount; i++) {
      const angle = t + meta.orbitPhase + (2 * Math.PI * i) / meta.moonCount;
      const cos = Math.cos(angle) * meta.orbitRadius;
      const sin = Math.sin(angle) * meta.orbitRadius;
      meta.moons[i].position.set(
        _right.x * cos + _up.x * sin,
        _right.y * cos + _up.y * sin,
        _right.z * cos + _up.z * sin,
      );
    }
  }
}
