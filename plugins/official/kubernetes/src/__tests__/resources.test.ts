import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KubeClient } from '../client';
import listResources from '../resources';
import { buildGraph } from '../graph';

/**
 * A cluster can legitimately refuse any of these calls: a read-only
 * ServiceAccount often has no access to `apps/v1`, and `autoscaling/v2` does
 * not exist before Kubernetes 1.23.
 */

function pods(...names: string[]) {
  return {
    items: names.map((name) => ({
      metadata: { namespace: 'default', name },
      spec: { containers: [{ image: 'nginx' }] },
      status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
    })),
  };
}

function client(overrides: Record<string, () => Promise<unknown>> = {}) {
  const ok = (value: unknown) => vi.fn(async () => value);
  const base: Record<string, () => Promise<unknown>> = {
    listPodForAllNamespaces: ok(pods('web-1')),
    listServiceForAllNamespaces: ok({ items: [] }),
    listHorizontalPodAutoscalerForAllNamespaces: ok({ items: [] }),
    listIngressForAllNamespaces: ok({ items: [] }),
    listDeploymentForAllNamespaces: ok({ items: [] }),
    listStatefulSetForAllNamespaces: ok({ items: [] }),
    listDaemonSetForAllNamespaces: ok({ items: [] }),
    listReplicaSetForAllNamespaces: ok({ items: [] }),
    ...overrides,
  };

  return {
    coreApi: {
      listPodForAllNamespaces: base.listPodForAllNamespaces,
      listServiceForAllNamespaces: base.listServiceForAllNamespaces,
    },
    appsApi: {
      listDeploymentForAllNamespaces: base.listDeploymentForAllNamespaces,
      listStatefulSetForAllNamespaces: base.listStatefulSetForAllNamespaces,
      listDaemonSetForAllNamespaces: base.listDaemonSetForAllNamespaces,
      listReplicaSetForAllNamespaces: base.listReplicaSetForAllNamespaces,
    },
    autoScalingApi: {
      listHorizontalPodAutoscalerForAllNamespaces: base.listHorizontalPodAutoscalerForAllNamespaces,
    },
    networkingApi: { listIngressForAllNamespaces: base.listIngressForAllNamespaces },
  } as unknown as KubeClient;
}

const forbidden = () => async () => {
  throw new Error('HTTP-Code: 403 forbidden');
};

describe('listResources', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns every list when the cluster answers', async () => {
    const resources = await listResources(client());
    expect(resources.pods.items).toHaveLength(1);
    expect(resources.deployments.items).toEqual([]);
  });

  // The common restricted-RBAC shape: pods readable, apps/v1 refused.
  it('still returns the pods when apps/v1 is forbidden', async () => {
    const resources = await listResources(
      client({
        listDeploymentForAllNamespaces: forbidden(),
        listStatefulSetForAllNamespaces: forbidden(),
        listDaemonSetForAllNamespaces: forbidden(),
        listReplicaSetForAllNamespaces: forbidden(),
      }),
    );

    expect(resources.pods.items).toHaveLength(1);
    expect(resources.deployments.items).toEqual([]);
    expect(resources.replicaSets.items).toEqual([]);
  });

  // autoscaling/v2 does not exist before Kubernetes 1.23.
  it('survives an API group the cluster does not have', async () => {
    const resources = await listResources(
      client({ listHorizontalPodAutoscalerForAllNamespaces: forbidden() }),
    );
    expect(resources.pods.items).toHaveLength(1);
    expect(resources.hpa.items).toEqual([]);
  });

  it('names the resource it could not list', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await listResources(client({ listDeploymentForAllNamespaces: forbidden() }));
    expect(warn.mock.calls.flat().join(' ')).toContain('deployments');
  });

  // A cluster that answers nothing at all is unreachable, not restrictive. The
  // host turns the throw into a source-level error the dashboard can display.
  it('throws when not a single resource kind could be listed', async () => {
    const everythingFails = Object.fromEntries(
      [
        'listPodForAllNamespaces',
        'listServiceForAllNamespaces',
        'listHorizontalPodAutoscalerForAllNamespaces',
        'listIngressForAllNamespaces',
        'listDeploymentForAllNamespaces',
        'listStatefulSetForAllNamespaces',
        'listDaemonSetForAllNamespaces',
        'listReplicaSetForAllNamespaces',
      ].map((name) => [name, forbidden()]),
    );

    await expect(listResources(client(everythingFails))).rejects.toThrow(/unreachable/i);
  });

  // One kind answering is enough to prove the cluster is there.
  it('does not throw while anything at all is readable', async () => {
    const resources = await listResources(
      client({
        listServiceForAllNamespaces: forbidden(),
        listHorizontalPodAutoscalerForAllNamespaces: forbidden(),
        listIngressForAllNamespaces: forbidden(),
        listDeploymentForAllNamespaces: forbidden(),
        listStatefulSetForAllNamespaces: forbidden(),
        listDaemonSetForAllNamespaces: forbidden(),
        listReplicaSetForAllNamespaces: forbidden(),
      }),
    );

    expect(resources.pods.items).toHaveLength(1);
    expect(buildGraph(resources).nodes.map((node) => node.id)).toContain('k8s:pod:default:web-1');
  });

  // A partial cluster still draws the part it can see.
  it('builds a usable graph from a partial cluster', async () => {
    const resources = await listResources(
      client({
        listDeploymentForAllNamespaces: forbidden(),
        listReplicaSetForAllNamespaces: forbidden(),
      }),
    );

    const graph = buildGraph(resources);
    expect(graph.nodes.map((node) => node.id)).toContain('k8s:pod:default:web-1');
  });
});
