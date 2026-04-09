import type { GraphData, ServiceNode } from '../types.js';

export interface ServiceDiff {
  field: string;
  hostA: string;
  hostB: string;
}

export interface MatchedService {
  name: string;
  hostA: ServiceNode;
  hostB: ServiceNode;
  diffs: ServiceDiff[];
}

export interface CompareResult {
  onlyInA: ServiceNode[];
  onlyInB: ServiceNode[];
  matched: MatchedService[];
}

/**
 * Derive a canonical service name used for matching across hosts.
 * Uses compose service name (project/name) when available, otherwise container name.
 */
function canonicalName(node: ServiceNode): string {
  return node.project ? `${node.project}/${node.name}` : node.name;
}

/** Compare image strings, normalizing implicit :latest tags */
function normalizeImage(image: string): string {
  if (!image.includes(':')) return `${image}:latest`;
  return image;
}

/** Compare two sorted string arrays as a comma-separated diff */
function compareArrayField(field: string, a: string[], b: string[]): ServiceDiff | null {
  const sa = [...a].sort().join(', ');
  const sb = [...b].sort().join(', ');
  if (sa !== sb) return { field, hostA: sa || '(none)', hostB: sb || '(none)' };
  return null;
}

/**
 * Compare two GraphData snapshots from different Docker hosts.
 * Matches services by canonical name and reports differences in
 * image version, status, ports, networks, and resource limits.
 */
export function compareEnvironments(a: GraphData, b: GraphData): CompareResult {
  const mapA = new Map<string, ServiceNode>();
  const mapB = new Map<string, ServiceNode>();

  for (const node of a.nodes) mapA.set(canonicalName(node), node);
  for (const node of b.nodes) mapB.set(canonicalName(node), node);

  const onlyInA: ServiceNode[] = [];
  const onlyInB: ServiceNode[] = [];
  const matched: MatchedService[] = [];

  // Find services in A
  for (const [name, nodeA] of mapA) {
    const nodeB = mapB.get(name);
    if (!nodeB) {
      onlyInA.push(nodeA);
      continue;
    }

    const diffs: ServiceDiff[] = [];

    // Image comparison
    const imgA = normalizeImage(nodeA.image);
    const imgB = normalizeImage(nodeB.image);
    if (imgA !== imgB) {
      diffs.push({ field: 'Image', hostA: nodeA.image, hostB: nodeB.image });
    }

    // Status comparison
    if (nodeA.status !== nodeB.status) {
      diffs.push({ field: 'Status', hostA: nodeA.status, hostB: nodeB.status });
    }

    // Health comparison
    if (nodeA.health !== nodeB.health) {
      diffs.push({ field: 'Health', hostA: nodeA.health, hostB: nodeB.health });
    }

    // Port mappings
    const portDiff = compareArrayField('Ports', nodeA.ports, nodeB.ports);
    if (portDiff) diffs.push(portDiff);

    // Networks
    const netDiff = compareArrayField('Networks', nodeA.networks, nodeB.networks);
    if (netDiff) diffs.push(netDiff);

    // Memory limit
    if (nodeA.memoryLimit !== nodeB.memoryLimit) {
      diffs.push({
        field: 'Memory Limit',
        hostA: formatMB(nodeA.memoryLimit),
        hostB: formatMB(nodeB.memoryLimit),
      });
    }

    matched.push({ name, hostA: nodeA, hostB: nodeB, diffs });
  }

  // Services only in B
  for (const [name, nodeB] of mapB) {
    if (!mapA.has(name)) onlyInB.push(nodeB);
  }

  return { onlyInA, onlyInB, matched };
}

function formatMB(bytes: number): string {
  if (bytes === 0) return '0';
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}
