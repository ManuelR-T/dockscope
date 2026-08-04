import { KubeClient, mergePatchOptions } from '../client';

type WorkloadKind = 'deployment' | 'statefulset' | 'daemonset';

interface WorkloadTarget {
  kind: WorkloadKind;
  namespace: string;
  name: string;
}

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

  if (kind === 'deployment') {
    return client.appsApi.patchNamespacedDeployment({ name, namespace, body }, mergePatchOptions);
  }
  if (kind === 'statefulset') {
    return client.appsApi.patchNamespacedStatefulSet({ name, namespace, body }, mergePatchOptions);
  }
  return client.appsApi.patchNamespacedDaemonSet({ name, namespace, body }, mergePatchOptions);
}

export async function deleteWorkload(
  client: KubeClient,
  { kind, namespace, name }: WorkloadTarget,
) {
  if (kind === 'deployment') {
    return client.appsApi.deleteNamespacedDeployment({ name, namespace });
  }
  if (kind === 'statefulset') {
    return client.appsApi.deleteNamespacedStatefulSet({ name, namespace });
  }
  return client.appsApi.deleteNamespacedDaemonSet({ name, namespace });
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
  if (kind === 'deployment') {
    return client.appsApi.patchNamespacedDeployment({ name, namespace, body }, mergePatchOptions);
  }
  return client.appsApi.patchNamespacedStatefulSet({ name, namespace, body }, mergePatchOptions);
}
