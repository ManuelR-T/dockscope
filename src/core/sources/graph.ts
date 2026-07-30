import type { GraphData, ServiceLink, ServiceNode } from '../../types.js';
import type { DataGraphTables, SourceGraphSnapshot } from './model.js';

function linkEndpointId(endpoint: ServiceLink['source'] | ServiceLink['target']): string {
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
}

function scopedId(sourceId: string, id: string): string {
  return id.startsWith(`${sourceId}:`) ? id : `${sourceId}:${id}`;
}

export function scopeGraphToSource(
  graph: GraphData,
  sourceId: string,
  enabled: boolean,
): GraphData {
  if (!enabled) {
    return graph;
  }

  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      id: scopedId(sourceId, node.id),
    })),
    links: graph.links.map((link) => ({
      ...link,
      source: scopedId(sourceId, linkEndpointId(link.source)),
      target: scopedId(sourceId, linkEndpointId(link.target)),
    })),
  };
}

export function mergeSourceSnapshots(snapshots: SourceGraphSnapshot[]): GraphData {
  return {
    nodes: snapshots.flatMap((snapshot) => snapshot.graph.nodes),
    links: snapshots.flatMap((snapshot) => snapshot.graph.links),
  };
}

function linkKey(link: ServiceLink): string {
  const source = linkEndpointId(link.source);
  const target = linkEndpointId(link.target);
  return `${link.type}:${source}->${target}:${link.label || ''}`;
}

export function graphToTables(graph: GraphData): DataGraphTables {
  const nodesById: Record<string, ServiceNode> = {};
  for (const node of graph.nodes) {
    nodesById[node.id] = node;
  }

  const linksById: DataGraphTables['links']['byId'] = {};
  for (const link of graph.links) {
    const source = linkEndpointId(link.source);
    const target = linkEndpointId(link.target);
    const id = linkKey(link);
    linksById[id] = { id, source, target, type: link.type, label: link.label };
  }

  return {
    nodes: { ids: Object.keys(nodesById), byId: nodesById },
    links: { ids: Object.keys(linksById), byId: linksById },
  };
}
