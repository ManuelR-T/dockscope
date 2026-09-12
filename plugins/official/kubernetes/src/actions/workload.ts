import { KubeClient, mergePatchOptions } from '../client';

type WorkloadKind = 'deployment' | 'statefulset' | 'daemonset';

interface WorkloadTarget {
  kind: WorkloadKind;
  namespace: string;
  name: string;
}

const WORKLOAD_METHODS = {
  deployment: { patch: 'patchNamespacedDeployment', delete: 'deleteNamespacedDeployment' },
  statefulset: { patch: 'patchNamespacedStatefulSet', delete: 'deleteNamespacedStatefulSet' },
  daemonset: { patch: 'patchNamespacedDaemonSet', delete: 'deleteNamespacedDaemonSet' },
} as const satisfies Record<
  WorkloadKind,
  { patch: keyof KubeClient['appsApi']; delete: keyof KubeClient['appsApi'] }
>;

/**
 * Restart a workload the way `kubectl rollout restart` does: stamp the pod
 * template with an annotation. Changing the template makes the controller roll
 * out fresh pods, which is why restarting a Deployment works while deleting a
 * pod only gets it recreated by the same ReplicaSet.
 */
export async function restartWorkload(
  client: KubeClient,
  { kind, namespace, name }: WorkloadTarget,
  now: Date = new Date(),
) {
  const body = {
    spec: {
      template: {
        metadata: {
          annotations: {
            'kubectl.kubernetes.io/restartedAt': now.toISOString(),
          },
        },
      },
    },
  };

  return client.appsApi[WORKLOAD_METHODS[kind].patch]({ name, namespace, body }, mergePatchOptions);
}

export async function deleteWorkload(
  client: KubeClient,
  { kind, namespace, name }: WorkloadTarget,
) {
  return client.appsApi[WORKLOAD_METHODS[kind].delete]({ name, namespace });
}

/**
 * Scale a Deployment or StatefulSet. A DaemonSet has no replica count: it runs
 * one pod per matching node, so scaling it is not a meaningful operation.
 */
export async function scaleWorkload(
  client: KubeClient,
  { kind, namespace, name }: WorkloadTarget,
  replicas: number,
) {
  if (kind === 'daemonset') {
    throw new Error('A DaemonSet runs one pod per node and cannot be scaled');
  }
  const body = { spec: { replicas } };
  return client.appsApi[WORKLOAD_METHODS[kind].patch]({ name, namespace, body }, mergePatchOptions);
}
