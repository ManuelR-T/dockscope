import type { GraphData, ServiceLink, ServiceNode } from '../../types';
import { endpointId, type LinkEndpoint } from './graphLinks';

export type StatusFilter = 'running' | 'stopped' | 'unhealthy';

export interface ScopeOption {
  value: string;
  label: string;
}

export interface GraphFilters {
  searchQuery: string;
  statusFilter: ReadonlySet<StatusFilter>;
  scopeFilter: string;
}

type LinkLike = Omit<ServiceLink, 'source' | 'target'> & {
  source: LinkEndpoint;
  target: LinkEndpoint;
};

function isDockerNode(node: ServiceNode): boolean {
  return !node.entityId && (node.runtime === undefined || node.runtime === 'docker');
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function normalizeSearchQuery(searchQuery: string): string {
  return searchQuery.trim().toLowerCase();
}

function searchableNodeValues(node: ServiceNode): string[] {
  return [node.name, node.fullName, node.image, node.namespace, node.kind].filter(
    (value): value is string => Boolean(value),
  );
}

function endpointNode(endpoint: LinkEndpoint): ServiceNode | null {
  if (typeof endpoint !== 'object' || endpoint === null) {
    return null;
  }
  if (!('status' in endpoint) || !('health' in endpoint)) {
    return null;
  }
  return endpoint as ServiceNode;
}

export function buildScopeOptions(nodes: readonly ServiceNode[]): ScopeOption[] {
  const options: ScopeOption[] = [];

  for (const project of uniqueSorted(
    nodes.filter((node) => isDockerNode(node) && Boolean(node.project)).map((node) => node.project),
  )) {
    options.push({ value: `docker-project:${project}`, label: `Docker / ${project}` });
  }

  for (const host of uniqueSorted(
    nodes.filter((node) => isDockerNode(node) && !node.project).map((node) => node.host || 'local'),
  )) {
    options.push({ value: `docker-host:${host}`, label: `Docker / ${host}` });
  }

  for (const namespace of uniqueSorted(
    nodes
      .filter((node) => node.runtime === 'kubernetes' && Boolean(node.namespace))
      .map((node) => node.namespace!),
  )) {
    options.push({ value: `kubernetes:${namespace}`, label: `Kubernetes / ${namespace}` });
  }

  for (const sourceId of uniqueSorted(
    nodes.filter((node) => node.entityId).map((node) => node.sourceId ?? node.host),
  )) {
    const node = nodes.find((node) => node.entityId && (node.sourceId ?? node.host) === sourceId)!;
    options.push({ value: `source:${sourceId}`, label: node.project || sourceId });
  }
  return options;
}

export function isNodeInScope(node: ServiceNode, scopeFilter: string): boolean {
  if (!scopeFilter) {
    return true;
  }

  const [type, ...rest] = scopeFilter.split(':');
  const value = rest.join(':');
  if (type === 'source') {
    return Boolean(node.entityId) && (node.sourceId ?? node.host) === value;
  }
  if (type === 'kubernetes') {
    return node.runtime === 'kubernetes' && node.namespace === value;
  }
  if (type === 'docker-project') {
    return isDockerNode(node) && node.project === value;
  }
  if (type === 'docker-host') {
    return isDockerNode(node) && !node.project && (node.host || 'local') === value;
  }
  return true;
}

export function nodeMatchesStatusFilter(
  node: ServiceNode,
  statusFilter: ReadonlySet<StatusFilter>,
): boolean {
  if (statusFilter.size === 0) {
    return true;
  }

  return (
    (statusFilter.has('running') && node.status === 'running') ||
    (statusFilter.has('stopped') && node.status !== 'running') ||
    (statusFilter.has('unhealthy') && node.health === 'unhealthy')
  );
}

export function nodeMatchesSearch(node: ServiceNode, searchQuery: string): boolean {
  const query = normalizeSearchQuery(searchQuery);
  if (!query) {
    return true;
  }

  return searchableNodeValues(node).some((value) => value.toLowerCase().includes(query));
}

export function isNodeVisible(node: ServiceNode, filters: GraphFilters): boolean {
  return (
    isNodeInScope(node, filters.scopeFilter) &&
    nodeMatchesStatusFilter(node, filters.statusFilter) &&
    nodeMatchesSearch(node, filters.searchQuery)
  );
}

export function isLinkVisible(link: LinkLike, filters: GraphFilters): boolean {
  const source = endpointNode(link.source);
  const target = endpointNode(link.target);
  return (
    (source ? isNodeVisible(source, filters) : true) &&
    (target ? isNodeVisible(target, filters) : true)
  );
}

export function findSearchMatches(
  nodes: readonly ServiceNode[],
  searchQuery: string,
): ServiceNode[] {
  if (!normalizeSearchQuery(searchQuery)) {
    return [];
  }
  return nodes.filter((node) => nodeMatchesSearch(node, searchQuery));
}

export function computeImpactNodeIds(nodeId: string, links: readonly LinkLike[]): Set<string> {
  const impacted = new Set<string>([nodeId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const link of links) {
      if (link.type !== 'depends_on') {
        continue;
      }

      const sourceId = endpointId(link.source);
      const targetId = endpointId(link.target);
      if (impacted.has(targetId) && !impacted.has(sourceId)) {
        impacted.add(sourceId);
        changed = true;
      }
    }
  }

  return impacted;
}

export function hasBrokenDependency(nodeId: string, graph: GraphData): boolean {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const link of graph.links) {
    if (link.type !== 'depends_on' || endpointId(link.source) !== nodeId) {
      continue;
    }

    const target = nodeById.get(endpointId(link.target));
    if (target && (target.status !== 'running' || target.health === 'unhealthy')) {
      return true;
    }
  }

  return false;
}
