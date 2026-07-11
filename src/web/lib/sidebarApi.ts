import type {
  ContainerInspect,
  ContainerStats,
  CrashDiagnostic,
  MetricPoint,
  ServiceNode,
} from '../../types';
import type { EntityAction, EntityActionResult } from '../../core/entity-actions';
import type { EntityOperationDescriptor, EntityOperationId } from '../../core/operations';
import type { PluginConfig } from '../../core/plugin-config';
import { getJson, isAbortError, postJson } from './api';

export interface SidebarNodeData {
  stats: ContainerStats | null;
  inspect: ContainerInspect | null;
  history: MetricPoint[];
  diagnostic: CrashDiagnostic | null;
}

interface SidebarNodeDataOptions {
  loadDiagnostic: boolean;
  signal?: AbortSignal;
}

export type EntityTarget = Pick<ServiceNode, 'id' | 'containerId' | 'host'> | string;

export function entityApiUrl(
  target: EntityTarget,
  suffix = '',
  params: Record<string, string | boolean | number | undefined> = {},
): string {
  const containerId = typeof target === 'string' ? target : target.containerId;
  const search = new URLSearchParams();

  if (typeof target !== 'string') {
    search.set('sourceId', target.host || 'local');
    search.set('nodeId', target.id);
  }

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }

  const qs = search.toString();
  return `/api/entities/${encodeURIComponent(containerId)}${suffix}${qs ? `?${qs}` : ''}`;
}

/** @deprecated Use entityApiUrl. */
export const containerApiUrl = entityApiUrl;

async function fallbackUnlessAborted<T>(request: Promise<T>, fallback: T): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return fallback;
  }
}

export interface EntityCapabilities {
  operations: EntityOperationDescriptor[];
  actions: EntityAction[];
}

export function hasEntityOperation(
  operations: readonly EntityOperationDescriptor[],
  id: EntityOperationId,
): boolean {
  return operations.some((operation) => operation.id === id);
}

export async function loadEntityCapabilities(
  node: ServiceNode,
  init: RequestInit = {},
): Promise<EntityCapabilities> {
  const [operations, actions] = await Promise.all([
    getJson<EntityOperationDescriptor[]>(entityApiUrl(node, '/operations'), init),
    getJson<EntityAction[]>(entityApiUrl(node, '/actions'), init),
  ]);
  return { operations, actions };
}

export function runEntityAction(
  node: ServiceNode,
  action: EntityAction,
  input?: PluginConfig,
  init: RequestInit = {},
): Promise<EntityActionResult> {
  return postJson<EntityActionResult>(
    entityApiUrl(
      node,
      `/actions/${encodeURIComponent(action.pluginId)}/${encodeURIComponent(action.id)}`,
    ),
    input === undefined ? undefined : { input },
    init,
  );
}

export function getEntityLogs(
  node: ServiceNode,
  tail = 300,
  init: RequestInit = {},
): Promise<string> {
  return getJson<{ logs?: string }>(entityApiUrl(node, '/logs', { tail }), init).then(
    (data) => data.logs || '',
  );
}

export function loadEntitySidebarData(
  node: ServiceNode,
  operations: readonly EntityOperationDescriptor[],
  { loadDiagnostic, signal }: SidebarNodeDataOptions,
): Promise<SidebarNodeData> {
  const init = signal ? { signal } : {};
  const inspect = hasEntityOperation(operations, 'inspect')
    ? fallbackUnlessAborted(getJson<ContainerInspect>(entityApiUrl(node, '/inspect'), init), null)
    : Promise.resolve(null);

  if (node.status === 'running' && hasEntityOperation(operations, 'stats')) {
    return Promise.all([
      fallbackUnlessAborted(getJson<ContainerStats>(entityApiUrl(node, '/stats'), init), null),
      inspect,
      fallbackUnlessAborted(getJson<MetricPoint[]>(entityApiUrl(node, '/history'), init), []),
    ]).then(([stats, inspect, history]) => ({
      stats,
      inspect,
      history,
      diagnostic: null,
    }));
  }

  const diagnostic =
    loadDiagnostic && hasEntityOperation(operations, 'diagnostic')
      ? fallbackUnlessAborted(
          getJson<CrashDiagnostic | null>(entityApiUrl(node, '/diagnostic'), init),
          null,
        )
      : Promise.resolve(null);

  return Promise.all([inspect, diagnostic]).then(([inspect, diagnostic]) => ({
    stats: null,
    inspect,
    history: [],
    diagnostic,
  }));
}
