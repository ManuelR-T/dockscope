import { describe, expect, it } from 'vitest';
import type {
  V1DaemonSetList,
  V1DeploymentList,
  V1PodList,
  V1ReplicaSetList,
  V1StatefulSetList,
  V2HorizontalPodAutoscalerList,
} from '@kubernetes/client-node';
import { buildGraph } from '../graph';
import type { Resources } from '../resources';
import { listWorkloads, resolveHpaTarget, resolvePodOwner } from '../resources/workloads';

/**
 * Ownership is the part that decides whether the graph shows a cluster or a
 * field of disconnected dots, and the Deployment -> ReplicaSet -> Pod hop is
 * the piece that is easy to get wrong.
 */

function pod(namespace: string, name: string, owner?: { kind: string; name: string }) {
  return {
    metadata: {
      namespace,
      name,
      ...(owner ? { ownerReferences: [{ ...owner, controller: true }] } : {}),
    },
    spec: { containers: [{ image: 'nginx:1.27' }] },
    status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
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
  return {
    pods: { items: [] },
    services: { items: [] },
    ingresses: { items: [] },
    hpa: { items: [] },
    deployments: { items: [] },
    statefulSets: { items: [] },
    daemonSets: { items: [] },
    replicaSets: { items: [] },
    ...overrides,
  } as Resources;
}

describe('resolvePodOwner', () => {
  it('walks the ReplicaSet hop up to the Deployment', () => {
    const owner = resolvePodOwner(
      pod('default', 'web-abc', { kind: 'ReplicaSet', name: 'web-745' }),
      [replicaSet('default', 'web-745', 'web')],
    );

    expect(owner).toEqual({ kind: 'deployment', namespace: 'default', name: 'web' });
  });

  it('attaches StatefulSet and DaemonSet pods directly', () => {
    expect(
      resolvePodOwner(pod('db', 'pg-0', { kind: 'StatefulSet', name: 'pg' }), []),
    ).toMatchObject({ kind: 'statefulset', name: 'pg' });
    expect(
      resolvePodOwner(
        pod('kube-system', 'kube-proxy-x', { kind: 'DaemonSet', name: 'kube-proxy' }),
        [],
      ),
    ).toMatchObject({ kind: 'daemonset', name: 'kube-proxy' });
  });

  it('leaves a bare pod unowned', () => {
    expect(resolvePodOwner(pod('default', 'solo'), [])).toBeUndefined();
  });

  // The control-plane pods on a kind cluster are static pods owned by the Node,
  // which is not something this plugin draws.
  it('leaves a pod owned by a kind we do not draw unowned', () => {
    expect(
      resolvePodOwner(pod('kube-system', 'etcd-cp', { kind: 'Node', name: 'cp' }), []),
    ).toBeUndefined();
    expect(
      resolvePodOwner(pod('default', 'batch-x', { kind: 'Job', name: 'batch' }), []),
    ).toBeUndefined();
  });

  it('leaves a pod unowned when its ReplicaSet is orphaned or missing', () => {
    expect(
      resolvePodOwner(pod('default', 'web-abc', { kind: 'ReplicaSet', name: 'web-745' }), [
        replicaSet('default', 'web-745'),
      ]),
    ).toBeUndefined();
    expect(
      resolvePodOwner(pod('default', 'web-abc', { kind: 'ReplicaSet', name: 'gone' }), []),
    ).toBeUndefined();
  });

  it('does not match a ReplicaSet of the same name in another namespace', () => {
    const owner = resolvePodOwner(
      pod('default', 'web-abc', { kind: 'ReplicaSet', name: 'web-745' }),
      [replicaSet('staging', 'web-745', 'web')],
    );
    expect(owner).toBeUndefined();
  });
});

describe('resolveHpaTarget', () => {
  it('reads the scale target', () => {
    expect(
      resolveHpaTarget({
        metadata: { namespace: 'shop', name: 'web' },
        spec: { scaleTargetRef: { kind: 'Deployment', name: 'api' }, maxReplicas: 3 },
      }),
    ).toEqual({ kind: 'deployment', namespace: 'shop', name: 'api' });
  });

  it('ignores a target kind that is not a workload', () => {
    expect(
      resolveHpaTarget({
        metadata: { namespace: 'default', name: 'web' },
        spec: { scaleTargetRef: { kind: 'ReplicationController', name: 'rc' }, maxReplicas: 3 },
      }),
    ).toBeUndefined();
  });
});

describe('listWorkloads', () => {
  it('reads replica counts from the field each controller uses', () => {
    const workloads = listWorkloads(
      resources({
        deployments: {
          items: [
            {
              metadata: { namespace: 'default', name: 'web' },
              spec: { replicas: 3, template: { spec: { containers: [{ image: 'nginx' }] } } },
              status: { readyReplicas: 2 },
            },
          ],
        } as unknown as V1DeploymentList,
        daemonSets: {
          items: [
            {
              metadata: { namespace: 'kube-system', name: 'kube-proxy' },
              spec: { template: { spec: { containers: [{ image: 'kube-proxy:v1' }] } } },
              // A DaemonSet has no spec.replicas; it targets nodes.
              status: { desiredNumberScheduled: 4, numberReady: 4 },
            },
          ],
        } as unknown as V1DaemonSetList,
        statefulSets: {
          items: [
            {
              metadata: { namespace: 'db', name: 'pg' },
              spec: { replicas: 2, template: { spec: { containers: [{ image: 'postgres:17' }] } } },
              status: { readyReplicas: 2 },
            },
          ],
        } as unknown as V1StatefulSetList,
      }),
    );

    expect(workloads).toEqual([
      expect.objectContaining({ kind: 'deployment', name: 'web', desired: 3, ready: 2 }),
      expect.objectContaining({ kind: 'statefulset', name: 'pg', desired: 2, ready: 2 }),
      expect.objectContaining({ kind: 'daemonset', name: 'kube-proxy', desired: 4, ready: 4 }),
    ]);
  });
});

describe('buildGraph workload wiring', () => {
  function deployedApp() {
    return resources({
      deployments: {
        items: [
          {
            metadata: { namespace: 'default', name: 'web' },
            spec: { replicas: 2, template: { spec: { containers: [{ image: 'nginx:1.27' }] } } },
            status: { readyReplicas: 2 },
          },
        ],
      } as unknown as V1DeploymentList,
      replicaSets: {
        items: [replicaSet('default', 'web-745', 'web')],
      } as unknown as V1ReplicaSetList,
      pods: {
        items: [
          pod('default', 'web-745-aaa', { kind: 'ReplicaSet', name: 'web-745' }),
          pod('default', 'web-745-bbb', { kind: 'ReplicaSet', name: 'web-745' }),
        ],
      } as unknown as V1PodList,
    });
  }

  it('draws the Deployment and links it to both of its pods', () => {
    const graph = buildGraph(deployedApp());

    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        'k8s:deployment:default:web',
        'k8s:pod:default:web-745-aaa',
        'k8s:pod:default:web-745-bbb',
      ]),
    );
    expect(graph.links).toEqual([
      expect.objectContaining({
        source: 'k8s:deployment:default:web',
        target: 'k8s:pod:default:web-745-aaa',
        label: 'manages',
      }),
      expect.objectContaining({
        source: 'k8s:deployment:default:web',
        target: 'k8s:pod:default:web-745-bbb',
      }),
    ]);
  });

  it('never draws the ReplicaSet itself', () => {
    const ids = buildGraph(deployedApp()).nodes.map((node) => node.id);
    expect(ids.some((id) => id.includes('replicaset') || id.includes('web-745:'))).toBe(false);
  });

  it('reports a converging Deployment as starting and a settled one as healthy', () => {
    const converging = buildGraph(
      resources({
        deployments: {
          items: [
            {
              metadata: { namespace: 'default', name: 'web' },
              spec: { replicas: 3, template: { spec: { containers: [{ image: 'nginx' }] } } },
              status: { readyReplicas: 1 },
            },
          ],
        } as unknown as V1DeploymentList,
      }),
    ).nodes[0];

    expect(converging).toMatchObject({
      kind: 'deployment',
      health: 'starting',
      status: 'running',
      metadata: expect.objectContaining({ replicas: '1/3 ready' }),
    });

    expect(buildGraph(deployedApp()).nodes[0]).toMatchObject({ health: 'healthy' });
  });

  it('treats a deliberately scaled-down Deployment as resting, not broken', () => {
    const node = buildGraph(
      resources({
        deployments: {
          items: [
            {
              metadata: { namespace: 'default', name: 'web' },
              spec: { replicas: 0, template: { spec: { containers: [{ image: 'nginx' }] } } },
              status: {},
            },
          ],
        } as unknown as V1DeploymentList,
      }),
    ).nodes[0];

    expect(node).toMatchObject({ status: 'exited', health: 'none' });
  });

  it('does not link a pod to a controller that was not listed', () => {
    const graph = buildGraph(
      resources({
        replicaSets: {
          items: [replicaSet('default', 'web-745', 'web')],
        } as unknown as V1ReplicaSetList,
        pods: {
          items: [pod('default', 'web-745-aaa', { kind: 'ReplicaSet', name: 'web-745' })],
        } as unknown as V1PodList,
      }),
    );

    expect(graph.links).toEqual([]);
  });
});

describe('hpa retargeting end to end', () => {
  it('points the autoscaler at the Deployment, not its pods', () => {
    const graph = buildGraph(
      resources({
        deployments: {
          items: [
            {
              metadata: { namespace: 'default', name: 'web' },
              spec: { replicas: 2, template: { spec: { containers: [{ image: 'nginx' }] } } },
              status: { readyReplicas: 2 },
            },
          ],
        } as unknown as V1DeploymentList,
        hpa: {
          items: [
            {
              metadata: { namespace: 'default', name: 'web' },
              spec: {
                scaleTargetRef: { kind: 'Deployment', name: 'web' },
                minReplicas: 2,
                maxReplicas: 5,
              },
              status: { currentReplicas: 2, desiredReplicas: 2 },
            },
          ],
        } as unknown as V2HorizontalPodAutoscalerList,
      }),
    );

    const hpaLinks = graph.links.filter((link) => String(link.source).startsWith('k8s:hpa:'));
    expect(hpaLinks).toEqual([
      expect.objectContaining({ target: 'k8s:deployment:default:web', label: 'scales Deployment' }),
    ]);
  });
});
