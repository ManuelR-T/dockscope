import { describe, expect, it } from 'vitest';
import type {
  V2HorizontalPodAutoscalerList,
  V1DaemonSetList,
  V1DeploymentList,
  V1IngressList,
  V1PodList,
  V1ReplicaSetList,
  V1ServiceList,
  V1StatefulSetList,
} from '@kubernetes/client-node';
import { buildGraph } from '../graph';
import type { Resources } from '../resources';
import { parseResourceId } from '../utils';

/**
 * buildGraph is a pure function over the API list objects, so the graph shape
 * can be asserted without a cluster or an HTTP mock.
 */

function pod(namespace: string, name: string, labels: Record<string, string>, phase = 'Running') {
  return {
    metadata: { namespace, name, labels },
    spec: { containers: [{ image: 'nginx:1.27', ports: [{ containerPort: 80 }] }] },
    status: { phase, conditions: [{ type: 'Ready', status: 'True' }] },
  };
}

/** A pod owned by `ownerKind`/`ownerName`, the way a controller creates it. */
function ownedPod(
  namespace: string,
  name: string,
  ownerKind: string,
  ownerName: string,
  labels: Record<string, string> = {},
) {
  const base = pod(namespace, name, labels);
  return {
    ...base,
    metadata: {
      ...base.metadata,
      ownerReferences: [{ kind: ownerKind, name: ownerName, controller: true }],
    },
  };
}

function replicaSet(namespace: string, name: string, deployment?: string) {
  return {
    metadata: {
      namespace,
      name,
      ...(deployment
        ? { ownerReferences: [{ kind: 'Deployment', name: deployment, controller: true }] }
        : {}),
    },
  };
}

function resources(overrides: Partial<Resources> = {}): Resources {
  const base = {
    pods: { items: [] } as unknown as V1PodList,
    services: { items: [] } as unknown as V1ServiceList,
    ingresses: { items: [] } as unknown as V1IngressList,
    hpa: { items: [] } as unknown as V2HorizontalPodAutoscalerList,
    deployments: { items: [] } as unknown as V1DeploymentList,
    statefulSets: { items: [] } as unknown as V1StatefulSetList,
    daemonSets: { items: [] } as unknown as V1DaemonSetList,
    replicaSets: { items: [] } as unknown as V1ReplicaSetList,
  };
  return { ...base, ...overrides } as Resources;
}

function deployments(...items: unknown[]) {
  return { items } as unknown as V1DeploymentList;
}

describe('buildGraph', () => {
  it('turns pods into nodes carrying their namespace, image and ports', () => {
    const graph = buildGraph(
      resources({
        pods: { items: [pod('default', 'web-abc', { app: 'web' })] } as unknown as V1PodList,
      }),
    );

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({
      id: 'k8s:pod:default:web-abc',
      name: 'web-abc',
      fullName: 'default/web-abc',
      namespace: 'default',
      runtime: 'kubernetes',
      kind: 'pod',
      image: 'nginx:1.27',
      status: 'running',
      health: 'healthy',
      ports: ['80/tcp'],
    });
  });

  it.each([
    ['Pending', 'pending', 'starting'],
    ['Succeeded', 'exited', 'none'],
    ['Failed', 'dead', 'unhealthy'],
    ['Weird', 'unknown', 'none'],
  ])('maps pod phase %s to status %s', (phase, status, health) => {
    const graph = buildGraph(
      resources({
        pods: { items: [pod('default', 'p', { app: 'p' }, phase)] } as unknown as V1PodList,
      }),
    );
    expect(graph.nodes[0]).toMatchObject({ status, health });
  });

  it('links a service to the pods its selector matches, and only those', () => {
    const graph = buildGraph(
      resources({
        pods: {
          items: [
            pod('default', 'web-1', { app: 'web' }),
            pod('default', 'other-1', { app: 'other' }),
            // same labels, different namespace: a selector must not cross it
            pod('staging', 'web-1', { app: 'web' }),
          ],
        } as unknown as V1PodList,
        services: {
          items: [
            { metadata: { namespace: 'default', name: 'web' }, spec: { selector: { app: 'web' } } },
          ],
        } as unknown as V1ServiceList,
      }),
    );

    const links = graph.links.filter((link) => String(link.source).startsWith('k8s:service:'));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      source: 'k8s:service:default:web',
      target: 'k8s:pod:default:web-1',
    });
  });

  it('does not link a service whose selector is empty', () => {
    const graph = buildGraph(
      resources({
        pods: { items: [pod('default', 'web-1', { app: 'web' })] } as unknown as V1PodList,
        services: {
          items: [{ metadata: { namespace: 'default', name: 'headless' }, spec: {} }],
        } as unknown as V1ServiceList,
      }),
    );
    expect(graph.links).toHaveLength(0);
  });

  // An HPA scales a controller, not pods: one edge to the target workload,
  // never a fan-out to pods whose names look related.
  it('links an HPA to the workload named by its scale target', () => {
    const graph = buildGraph(
      resources({
        pods: {
          items: [ownedPod('default', 'web-xyz', 'ReplicaSet', 'web-1')],
        } as unknown as V1PodList,
        replicaSets: {
          items: [replicaSet('default', 'web-1', 'web')],
        } as unknown as V1ReplicaSetList,
        deployments: deployments({
          metadata: { namespace: 'default', name: 'web' },
          spec: { replicas: 1, template: { spec: { containers: [{ image: 'nginx' }] } } },
          status: { readyReplicas: 1 },
        }),
        hpa: {
          items: [
            {
              metadata: { namespace: 'default', name: 'web' },
              spec: {
                scaleTargetRef: { kind: 'Deployment', name: 'web' },
                minReplicas: 2,
                maxReplicas: 5,
              },
            },
          ],
        } as unknown as V2HorizontalPodAutoscalerList,
      }),
    );

    expect(graph.nodes.map((node) => node.id)).toContain('k8s:hpa:default:web');
    expect(graph.links).toContainEqual(
      expect.objectContaining({
        source: 'k8s:hpa:default:web',
        target: 'k8s:deployment:default:web',
        label: 'scales Deployment',
      }),
    );
    expect(graph.links).not.toContainEqual(
      expect.objectContaining({ source: 'k8s:hpa:default:web', target: 'k8s:pod:default:web-xyz' }),
    );
  });

  it('drops the HPA edge when its scale target is not in the graph', () => {
    const graph = buildGraph(
      resources({
        hpa: {
          items: [
            {
              metadata: { namespace: 'default', name: 'web' },
              spec: { scaleTargetRef: { kind: 'Deployment', name: 'gone' }, maxReplicas: 5 },
            },
          ],
        } as unknown as V2HorizontalPodAutoscalerList,
      }),
    );

    expect(graph.nodes.map((node) => node.id)).toContain('k8s:hpa:default:web');
    expect(graph.links).toEqual([]);
  });

  function hpa(status: Record<string, unknown>) {
    return resources({
      hpa: {
        items: [
          {
            metadata: { namespace: 'default', name: 'web' },
            spec: {
              scaleTargetRef: { kind: 'Deployment', name: 'web' },
              minReplicas: 2,
              maxReplicas: 5,
            },
            status,
          },
        ],
      } as unknown as V2HorizontalPodAutoscalerList,
    });
  }

  it('reports a scaling HPA as healthy with its replica ratio', () => {
    const node = buildGraph(hpa({ currentReplicas: 2, desiredReplicas: 2 })).nodes[0];
    expect(node).toMatchObject({ health: 'healthy', image: 'HPA 2/2 replicas' });
    // an HPA has no ports; its facts belong in metadata
    expect(node.ports).toEqual([]);
    expect(node.metadata).toMatchObject({ replicas: '2/2 replicas' });
  });

  // Numbers, not just the formatted "2-5" string: the scale form pre-fills
  // from these and would otherwise fall back to 1/1.
  it('publishes the replica bounds as numbers the scale form can pre-fill', () => {
    const node = buildGraph(hpa({ currentReplicas: 2, desiredReplicas: 2 })).nodes[0];
    expect(node.metadata).toMatchObject({ minReplicas: 2, maxReplicas: 5 });
  });

  it('reports an HPA that is still scaling up as starting', () => {
    const node = buildGraph(hpa({ currentReplicas: 2, desiredReplicas: 4 })).nodes[0];
    expect(node).toMatchObject({ health: 'starting', image: 'HPA 2/4 replicas' });
  });

  // An HPA that cannot compute a target leaves desiredReplicas at 0 and sets
  // ScalingActive=False, so the condition decides the health, not the counts.
  it('reports an HPA that cannot scale as unhealthy, with the reason', () => {
    const node = buildGraph(
      hpa({
        currentReplicas: 2,
        desiredReplicas: 0,
        conditions: [
          { type: 'AbleToScale', status: 'True', reason: 'SucceededGetScale' },
          {
            type: 'ScalingActive',
            status: 'False',
            reason: 'FailedGetResourceMetric',
            message: 'unable to get metrics for resource cpu',
          },
        ],
      }),
    ).nodes[0];

    expect(node.health).toBe('unhealthy');
    expect(node.image).toBe('HPA 2 replicas, scaling inactive');
    expect(node.image).not.toContain('2/0');
    expect(node.ports).toEqual([]);
    expect(node.metadata).toMatchObject({
      scalingActive: false,
      desiredReplicas: 0,
      scalingActiveReason: 'FailedGetResourceMetric',
    });
  });

  it('links an ingress to the service it routes to', () => {
    const graph = buildGraph(
      resources({
        services: {
          items: [
            { metadata: { namespace: 'default', name: 'web' }, spec: { selector: { app: 'web' } } },
          ],
        } as unknown as V1ServiceList,
        ingresses: {
          items: [
            {
              metadata: { namespace: 'default', name: 'web' },
              spec: {
                rules: [
                  {
                    host: 'web.local',
                    http: {
                      paths: [{ backend: { service: { name: 'web', port: { number: 80 } } } }],
                    },
                  },
                ],
              },
            },
          ],
        } as unknown as V1IngressList,
      }),
    );

    expect(graph.nodes.map((node) => node.id)).toContain('k8s:ingress:default:web');
    expect(graph.links).toContainEqual(
      expect.objectContaining({
        source: 'k8s:ingress:default:web',
        target: 'k8s:service:default:web',
      }),
    );
  });

  it('returns an empty graph when the cluster has nothing', () => {
    expect(buildGraph(resources())).toEqual({ nodes: [], links: [] });
  });
});

describe('parseResourceId', () => {
  it('reads kind, namespace and name back out', () => {
    expect(parseResourceId('k8s:pod:kube-system:coredns-abc')).toEqual({
      kind: 'pod',
      namespace: 'kube-system',
      name: 'coredns-abc',
    });
  });

  it('keeps colons that belong to the name', () => {
    expect(parseResourceId('k8s:service:default:a:b')).toMatchObject({ name: 'a:b' });
  });

  it.each([
    ['docker:pod:default:web', 'a non-kubernetes prefix'],
    ['k8s:configmap:default:web', 'an unsupported kind'],
    ['k8s:pod:default', 'a missing name'],
    ['', 'an empty id'],
  ])('rejects %s (%s)', (id) => {
    expect(() => parseResourceId(id)).toThrow();
  });

  it.each(['deployment', 'statefulset', 'daemonset'])('accepts the %s kind', (kind) => {
    expect(parseResourceId(`k8s:${kind}:default:web`)).toEqual({
      kind,
      namespace: 'default',
      name: 'web',
    });
  });
});
