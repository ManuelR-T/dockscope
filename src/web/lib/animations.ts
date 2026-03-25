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
