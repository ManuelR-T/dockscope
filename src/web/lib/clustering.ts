import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import { PROJECT_PALETTE } from './constants';

interface ClusterVisual {
  mesh: THREE.Mesh;
  label: SpriteText;
}

const sharedGeo = new THREE.SphereGeometry(1, 20, 14);
const clusterMap = new Map<string, ClusterVisual>();

export function createClusteringForce(strength: number) {
  let nodes: any[] = [];
  function force(alpha: number) {
    const centroids = new Map<string, { x: number; y: number; z: number; count: number }>();
    for (const node of nodes) {
      const p = node.project || '';
      if (!p) continue;
      let c = centroids.get(p);
      if (!c) {
        c = { x: 0, y: 0, z: 0, count: 0 };
        centroids.set(p, c);
      }
      c.x += node.x;
      c.y += node.y;
      c.z += node.z;
      c.count++;
    }
    for (const c of centroids.values()) {
      c.x /= c.count;
      c.y /= c.count;
      c.z /= c.count;
    }
    for (const node of nodes) {
      const c = centroids.get(node.project || '');
      if (!c || c.count < 2) continue;
      node.vx += (c.x - node.x) * strength * alpha;
      node.vy += (c.y - node.y) * strength * alpha;
      node.vz += (c.z - node.z) * strength * alpha;
    }
  }
  force.initialize = (n: any[]) => {
    nodes = n;
  };
  return force;
}

function createClusterMesh(color: string): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.035,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(sharedGeo, mat);
  mesh.renderOrder = -1;
  return mesh;
}

function createClusterLabel(name: string, color: string): SpriteText {
  const label = new SpriteText(name);
  label.color = color;
  label.textHeight = 3;
  label.fontFace = "'Fira Code', monospace";
  label.fontWeight = '600';
  label.backgroundColor = false as any;
  label.padding = 0;
  (label.material as THREE.SpriteMaterial).depthWrite = false;
  (label.material as THREE.SpriteMaterial).opacity = 0.5;
  return label;
}

function removeCluster(scene: THREE.Scene, name: string): void {
  const cluster = clusterMap.get(name);
  if (!cluster) return;
  scene.remove(cluster.mesh);
  scene.remove(cluster.label);
  (cluster.mesh.material as THREE.Material).dispose();
  clusterMap.delete(name);
}

export function updateClusters(
  scene: THREE.Scene,
  nodes: any[],
  isVisible: (node: any) => boolean,
): void {
  // Group visible nodes by project
  const projectNodes = new Map<string, any[]>();
  for (const node of nodes) {
    if (node.x === undefined) continue;
    const p = node.project || '';
    if (!p) continue;
    if (!isVisible(node)) continue;
    if (!projectNodes.has(p)) projectNodes.set(p, []);
    projectNodes.get(p)!.push(node);
  }

  const sortedNames = [...projectNodes.keys()].sort();
  const colorIndex = new Map(sortedNames.map((n, i) => [n, i]));

  for (const [projectName, pNodes] of projectNodes) {
    if (pNodes.length < 2) {
      removeCluster(scene, projectName);
      continue;
    }

    let cx = 0,
      cy = 0,
      cz = 0;
    for (const n of pNodes) {
      cx += n.x;
      cy += n.y;
      cz += n.z;
    }
    cx /= pNodes.length;
    cy /= pNodes.length;
    cz /= pNodes.length;

    let maxR = 0;
    for (const n of pNodes) {
      const r = Math.sqrt((n.x - cx) ** 2 + (n.y - cy) ** 2 + (n.z - cz) ** 2);
      if (r > maxR) maxR = r;
    }
    const radius = maxR + 15;
    const color = PROJECT_PALETTE[colorIndex.get(projectName)! % PROJECT_PALETTE.length];

    let cluster = clusterMap.get(projectName);
    if (!cluster) {
      const mesh = createClusterMesh(color);
      const label = createClusterLabel(projectName, color);
      scene.add(mesh);
      scene.add(label);
      cluster = { mesh, label };
      clusterMap.set(projectName, cluster);
    }

    cluster.mesh.position.set(cx, cy, cz);
    cluster.mesh.scale.setScalar(radius);
    cluster.label.position.set(cx, cy + radius + 5, cz);
  }

  // Remove stale clusters
  for (const [name] of clusterMap) {
    if (!projectNodes.has(name) || projectNodes.get(name)!.length < 2) {
      removeCluster(scene, name);
    }
  }
}

export function cleanupAllClusters(scene: THREE.Scene): void {
  for (const [name] of clusterMap) {
    removeCluster(scene, name);
  }
  sharedGeo.dispose();
}
