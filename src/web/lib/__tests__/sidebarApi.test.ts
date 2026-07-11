import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityAction } from '../../../core/entity-actions';
import type { EntityOperationDescriptor, EntityOperationId } from '../../../core/operations';
import type { ServiceNode } from '../../../types';
import {
  entityApiUrl,
  getEntityLogs,
  hasEntityOperation,
  loadEntityCapabilities,
  loadEntitySidebarData,
  runEntityAction,
} from '../sidebarApi';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function makeNode(overrides: Partial<ServiceNode> & { id: string }): ServiceNode {
  return {
    name: overrides.id,
    fullName: overrides.id,
    project: '',
    host: 'local',
    containerId: overrides.id,
    image: 'test:latest',
    status: 'running',
    health: 'none',
    ports: [],
    networks: [],
    volumeCount: 0,
    cpu: 0,
    memory: 0,
    memoryLimit: 0,
    networkRx: 0,
    networkTx: 0,
    networkRxRate: 0,
    networkTxRate: 0,
    ...overrides,
  };
}

function operation(id: EntityOperationId): EntityOperationDescriptor {
  return { id, pluginId: 'core.docker', capability: 'source.graph' };
}

function action(): EntityAction {
  return {
    pluginId: 'official.kubernetes',
    id: 'set_hpa_constraints',
    title: 'Set replica bounds',
    capability: 'action.scale',
    placement: 'menu',
    tone: 'neutral',
    effect: 'refresh',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sidebar entity API helpers', () => {
  it('builds source-scoped generic entity URLs', () => {
    const node = makeNode({
      id: 'remote-a:abcdef123456',
      host: 'remote-a',
      containerId: 'abcdef1234567890',
    });

    expect(entityApiUrl(node, '/stats')).toBe(
      '/api/entities/abcdef1234567890/stats?sourceId=remote-a&nodeId=remote-a%3Aabcdef123456',
    );
  });

  it('loads provider-owned operations and actions', async () => {
    const node = makeNode({ id: 'k8s:hpa:prod:api', runtime: 'kubernetes', kind: 'hpa' });
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/operations')) {
        return jsonResponse([operation('actions')]);
      }
      if (url.includes('/actions')) {
        return jsonResponse([action()]);
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    await expect(loadEntityCapabilities(node)).resolves.toEqual({
      operations: [operation('actions')],
      actions: [action()],
    });
    expect(hasEntityOperation([operation('logs')], 'logs')).toBe(true);
    expect(hasEntityOperation([operation('logs')], 'exec')).toBe(false);
  });

  it('runs an action through its owning plugin and entity', async () => {
    const node = makeNode({ id: 'k8s:hpa:prod:api', runtime: 'kubernetes', kind: 'hpa' });
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: true })) as typeof fetch;

    await runEntityAction(node, action(), { minReplicas: 2, maxReplicas: 4 });

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe(
      '/api/entities/k8s%3Ahpa%3Aprod%3Aapi/actions/official.kubernetes/set_hpa_constraints?sourceId=local&nodeId=k8s%3Ahpa%3Aprod%3Aapi',
    );
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ input: { minReplicas: 2, maxReplicas: 4 } }));
  });

  it('loads logs through the generic entity endpoint', async () => {
    const node = makeNode({ id: 'k8s:pod:prod:api', runtime: 'kubernetes', kind: 'pod' });
    globalThis.fetch = vi.fn(async () => jsonResponse({ logs: 'pod log\n' })) as typeof fetch;

    await expect(getEntityLogs(node, 50)).resolves.toBe('pod log\n');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/entities/k8s%3Apod%3Aprod%3Aapi/logs?sourceId=local&nodeId=k8s%3Apod%3Aprod%3Aapi&tail=50',
      { method: 'GET' },
    );
  });

  it('loads running entity data only for advertised operations', async () => {
    const node = makeNode({ id: 'abcdef123456' });
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/stats?')) {
        return jsonResponse({ id: node.id, cpu: 12 });
      }
      if (url.includes('/history?')) {
        return jsonResponse([{ cpu: 12, memory: 20, time: 100 }]);
      }
      if (url.includes('/inspect?')) {
        return jsonResponse({ id: node.id, env: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const data = await loadEntitySidebarData(node, [operation('stats'), operation('inspect')], {
      loadDiagnostic: true,
    });

    expect(data.stats?.cpu).toBe(12);
    expect(data.history).toHaveLength(1);
    expect(data.inspect?.id).toBe(node.id);
    expect(data.diagnostic).toBeNull();
  });

  it('loads stopped entity diagnostics only when advertised', async () => {
    const node = makeNode({ id: 'abcdef123456', status: 'exited' });
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/inspect?')) {
        return jsonResponse({ id: node.id, env: [] });
      }
      if (url.includes('/diagnostic?')) {
        return jsonResponse({ containerId: node.id, cause: 'Exited' });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const data = await loadEntitySidebarData(
      node,
      [operation('inspect'), operation('diagnostic')],
      { loadDiagnostic: true },
    );

    expect(data.stats).toBeNull();
    expect(data.history).toEqual([]);
    expect(data.diagnostic?.containerId).toBe(node.id);
  });

  it('propagates aborts so callers can ignore stale loads', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    globalThis.fetch = vi.fn(async () => {
      throw abort;
    }) as typeof fetch;

    await expect(
      loadEntitySidebarData(makeNode({ id: 'abcdef123456' }), [operation('inspect')], {
        loadDiagnostic: true,
      }),
    ).rejects.toBe(abort);
  });
});
