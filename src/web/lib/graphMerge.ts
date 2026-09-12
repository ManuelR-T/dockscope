import type { GraphData, ServiceLink, ServiceNode } from '../../types';
import { endpointId, linkKey } from './graphLinks';

/** How long a removed Kubernetes pod lingers as a "terminating" ghost node */
export const ROLLOUT_GHOST_TTL = 1600;

export function normalizeLink(link: ServiceLink): ServiceLink {
  return {
    source: endpointId(link.source),
    target: endpointId(link.target),
    type: link.type,
    label: link.label,
  };
}

function isKubernetesPod(node: ServiceNode): boolean {
  return node.runtime === 'kubernetes' && node.kind === 'pod';
}

export function pruneLinksToExistingNodes(
  links: ServiceLink[],
  nodeIds: Set<string>,
): ServiceLink[] {
  return links.filter(
    (link) => nodeIds.has(endpointId(link.source)) && nodeIds.has(endpointId(link.target)),
  );
}

/**
 * Merge an incoming graph broadcast into the current graph.
 *
 * Intentionally mutates matching nodes of `current` in place (Object.assign)
 * and returns those same objects: d3 simulation positions (x, y, z, vx, ...)
 * and Three.js references live on them and must survive the merge.
 *
 * Kubernetes pods that disappear from the incoming graph are kept briefly as
 * "terminating" ghost nodes so the rollout exit animation can play.
 */
export function mergeGraphData(current: GraphData, incoming: GraphData, now: number): GraphData {
  const incomingIds = new Set(incoming.nodes.map((node) => node.id));
  const existingMap = new Map(current.nodes.map((node) => [node.id, node]));
  const previousLinks = current.links.map(normalizeLink);

  const mergedNodes = incoming.nodes.map((newNode) => {
    const existing = existingMap.get(newNode.id);
    if (existing) {
      Object.assign(existing, {
        name: newNode.name,
        fullName: newNode.fullName,
        project: newNode.project,
        host: newNode.host,
        entityId: newNode.entityId,
        sourceId: newNode.sourceId,
        entityStatus: newNode.entityStatus,
        metadata: newNode.metadata,
        metrics: newNode.metrics,
        runtime: newNode.runtime,
        kind: newNode.kind,
        namespace: newNode.namespace,
        containerId: newNode.containerId,
        image: newNode.image,
        status: newNode.status,
        health: newNode.health,
        ports: newNode.ports,
        networks: newNode.networks,
        volumeCount: newNode.volumeCount,
        rolloutPhase: undefined,
        rolloutUntil: undefined,
      });
      return existing;
    }
    return newNode;
  });

  const existingGhosts = current.nodes.filter(
    (node) =>
      node.rolloutPhase === 'terminating' &&
      (node.rolloutUntil || 0) > now &&
      !incomingIds.has(node.id),
  );
  const removedPods = current.nodes
    .filter(
      (node) =>
        isKubernetesPod(node) && node.rolloutPhase !== 'terminating' && !incomingIds.has(node.id),
    )
    .map((node) => ({
      ...node,
      status: 'removing' as const,
      health: 'starting' as const,
      rolloutPhase: 'terminating' as const,
      rolloutUntil: now + ROLLOUT_GHOST_TTL,
    }));

  const ghostNodes = [...existingGhosts, ...removedPods];
  const ghostIds = new Set(ghostNodes.map((node) => node.id));
  const ghostLinks = previousLinks.filter(
    (link) => ghostIds.has(endpointId(link.source)) || ghostIds.has(endpointId(link.target)),
  );

  const linkMap = new Map<string, ServiceLink>();
  for (const link of [...incoming.links.map(normalizeLink), ...ghostLinks]) {
    linkMap.set(linkKey(link), link);
  }

  return { nodes: [...mergedNodes, ...ghostNodes], links: [...linkMap.values()] };
}

/** Earliest future rollout-ghost expiry, or null when no ghost is pending */
export function nextRolloutExpiry(nodes: readonly ServiceNode[], now: number): number | null {
  const nextExpiry = Math.min(
    ...nodes
      .map((node) => node.rolloutUntil)
      .filter((until): until is number => typeof until === 'number' && until > now),
  );
  return Number.isFinite(nextExpiry) ? nextExpiry : null;
}

/** Drop ghost nodes whose rollout TTL has elapsed */
export function pruneExpiredRollouts(nodes: readonly ServiceNode[], cutoff: number): ServiceNode[] {
  return nodes.filter((node) => !node.rolloutUntil || node.rolloutUntil > cutoff);
}
