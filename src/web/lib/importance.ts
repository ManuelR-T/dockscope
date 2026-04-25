import type { ServiceNode, ServiceLink } from '../../types';
import { GRAPH } from './constants';

const W = GRAPH.importance;

function getLinkId(link: ServiceLink, end: 'source' | 'target'): string {
  const v = link[end];
  return typeof v === 'object' ? (v as any).id : v;
}

export function computeImportance(nodes: ServiceNode[], links: ServiceLink[]): Map<string, number> {
  const scores = new Map<string, number>();
  if (nodes.length === 0) {
    return scores;
  }

  // Build adjacency for depends_on (target → sources that depend on it)
  const dependents = new Map<string, Set<string>>();
  for (const link of links) {
    if (link.type !== 'depends_on') {
      continue;
    }
    const srcId = getLinkId(link, 'source');
    const tgtId = getLinkId(link, 'target');
    if (!dependents.has(tgtId)) {
      dependents.set(tgtId, new Set());
    }
    dependents.get(tgtId)!.add(srcId);
  }

  // Count transitive dependents via BFS
  function countChainDepth(nodeId: string): number {
    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.pop()!;
      const deps = dependents.get(current);
      if (!deps) {
        continue;
      }
      for (const dep of deps) {
        if (!visited.has(dep)) {
          visited.add(dep);
          queue.push(dep);
        }
      }
    }
    return visited.size;
  }

  // Count total links per node (both directions, all types)
  const linkCount = new Map<string, number>();
  for (const link of links) {
    const srcId = getLinkId(link, 'source');
    const tgtId = getLinkId(link, 'target');
    linkCount.set(srcId, (linkCount.get(srcId) || 0) + 1);
    linkCount.set(tgtId, (linkCount.get(tgtId) || 0) + 1);
  }

  // Collect raw metrics
  let maxLinks = 1,
    maxChain = 1,
    maxNetIO = 1,
    maxCpu = 1,
    maxMem = 1,
    maxNets = 1;
  const rawScores: {
    id: string;
    ports: number;
    links: number;
    chain: number;
    netIO: number;
    cpu: number;
    mem: number;
    nets: number;
  }[] = [];

  for (const node of nodes) {
    const hasExposedPorts = node.ports.some((p) => p.includes(':'));
    const lc = linkCount.get(node.id) || 0;
    const chain = countChainDepth(node.id);
    const netIO = (node.networkRxRate || 0) + (node.networkTxRate || 0);
    const cpu = node.cpu || 0;
    const mem = node.memoryLimit > 0 ? (node.memory || 0) / node.memoryLimit : 0;
    const nets = node.networks?.length || 0;
    if (lc > maxLinks) {
      maxLinks = lc;
    }
    if (chain > maxChain) {
      maxChain = chain;
    }
    if (netIO > maxNetIO) {
      maxNetIO = netIO;
    }
    if (cpu > maxCpu) {
      maxCpu = cpu;
    }
    if (mem > maxMem) {
      maxMem = mem;
    }
    if (nets > maxNets) {
      maxNets = nets;
    }
    rawScores.push({
      id: node.id,
      ports: hasExposedPorts ? 1 : 0,
      links: lc,
      chain,
      netIO,
      cpu,
      mem,
      nets,
    });
  }

  // Weighted raw scores
  const raw = rawScores.map((s) => ({
    id: s.id,
    score:
      s.ports * W.ports +
      (s.links / maxLinks) * W.connections +
      (s.chain / maxChain) * W.chainDepth +
      (s.netIO / maxNetIO) * W.networkIO +
      (s.cpu / maxCpu) * W.cpu +
      (s.mem / maxMem) * W.memory +
      (s.nets / maxNets) * W.networks,
  }));

  // Mean-normalize: amplify differences around the average
  const mean = raw.reduce((sum, r) => sum + r.score, 0) / (raw.length || 1);
  const maxDev = Math.max(...raw.map((r) => Math.abs(r.score - mean)), 0.01);
  for (const r of raw) {
    const normalized = 0.5 + ((r.score - mean) / maxDev) * 0.5;
    scores.set(r.id, Math.max(0, Math.min(1, normalized)));
  }

  return scores;
}
