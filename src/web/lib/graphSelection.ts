import type { ServiceNode } from '../../types';

export function nodeSelectionKey(node: ServiceNode): string {
  if (node.entityId) {
    return ['entity', node.sourceId ?? node.host, node.entityId].join(':');
  }
  if (node.runtime === 'kubernetes') {
    return ['kubernetes', node.kind || '', node.namespace || '', node.name].join(':');
  }
  return ['docker', node.host || 'local', node.project || '', node.fullName || node.name].join(':');
}

export function resolveSelectedNode(
  nodes: readonly ServiceNode[],
  selectedNode: ServiceNode | null,
): ServiceNode | null {
  if (!selectedNode) {
    return null;
  }

  const exact = nodes.find((node) => node.id === selectedNode.id);
  if (exact) {
    return exact;
  }

  const selectedKey = nodeSelectionKey(selectedNode);
  return nodes.find((node) => nodeSelectionKey(node) === selectedKey) || selectedNode;
}
