import type { Request } from 'express';
import type { EntityRef } from '../../core/entities/operations.js';
import type { GraphData, ServiceNode } from '../../types.js';
import { shortId } from '../../utils.js';

export const VALID_ID = /^[a-f0-9]{12,64}$/i;
export const VALID_NODE_ID = /^([^\s:]+:)?[a-f0-9]{12,64}$/i;
export const VALID_ENTITY_ID = /^[^\s/?#]{1,512}$/;
const COMPOSE_ACTIONS = ['up', 'down', 'destroy', 'stop', 'start', 'restart'] as const;
type ComposeAction = (typeof COMPOSE_ACTIONS)[number];

/** Get container ID param as string */
export function getId(req: Request): string {
  return req.params.id as string;
}

export function getStringQuery(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function getNumberQuery(req: Request, key: string): number | undefined {
  const value = getStringQuery(req, key);
  if (!value) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function entityContext(node: ServiceNode): NonNullable<EntityRef['context']> {
  return {
    nodeId: node.id,
    name: node.name,
    runtime: node.runtime,
    kind: node.kind,
    status: node.status,
    health: node.health,
    metadata: node.metadata ? { ...node.metadata } : undefined,
  };
}

export function getEntityRef(req: Request, entityId = getId(req), graph?: GraphData): EntityRef {
  const sourceId = getStringQuery(req, 'sourceId') ?? getStringQuery(req, 'host');
  const requestedNodeId = getStringQuery(req, 'nodeId');
  const node = graph?.nodes.find(
    (candidate) =>
      candidate.id === requestedNodeId ||
      (candidate.containerId === entityId && (!sourceId || candidate.host === sourceId)),
  );
  return {
    entityId,
    ...(sourceId ? { sourceId } : {}),
    nodeId: node?.id ?? requestedNodeId ?? shortId(entityId),
    ...(node ? { context: entityContext(node) } : {}),
  };
}

export function getMetricNodeId(req: Request): string {
  const nodeId = getStringQuery(req, 'nodeId');
  if (nodeId && VALID_NODE_ID.test(nodeId)) {
    return nodeId;
  }
  return shortId(getId(req));
}

export function isComposeAction(value: string): value is ComposeAction {
  return COMPOSE_ACTIONS.includes(value as ComposeAction);
}
