import {
  V2HorizontalPodAutoscalerList,
  V1DaemonSetList,
  V1DeploymentList,
  V1IngressList,
  V1PodList,
  V1ReplicaSetList,
  V1ServiceList,
  V1StatefulSetList,
} from '@kubernetes/client-node';
import { KubeClient } from '../client';

export interface Resources {
  pods: V1PodList;
  services: V1ServiceList;
  hpa: V2HorizontalPodAutoscalerList;
  ingresses: V1IngressList;
  deployments: V1DeploymentList;
  statefulSets: V1StatefulSetList;
  daemonSets: V1DaemonSetList;
  // Fetched but never drawn: ReplicaSets are the hop between a pod and its
  // Deployment, which resolvePodOwner walks through.
  replicaSets: V1ReplicaSetList;
}

const EMPTY = { items: [] };

interface Attempt<T> {
  kind: string;
  value: T;
  error?: unknown;
}

/**
 * Fetch one resource kind, degrading to an empty list when the cluster refuses
 * it.
 *
 * The eight calls span four API groups and any of them can be denied: a
 * read-only ServiceAccount often has no access to `apps/v1`, and
 * `autoscaling/v2` does not exist before Kubernetes 1.23.
 */
async function listOrEmpty<T extends { items: unknown[] }>(
  kind: string,
  fetch: () => Promise<T>,
): Promise<Attempt<T>> {
  try {
    return { kind, value: await fetch() };
  } catch (error) {
    console.warn(
      `[kubernetes] could not list ${kind}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { kind, value: EMPTY as unknown as T, error };
  }
}

export default async function listResources({
  coreApi,
  appsApi,
  autoScalingApi,
  networkingApi,
}: KubeClient): Promise<Resources> {
  const attempts = await Promise.all([
    listOrEmpty('pods', () => coreApi.listPodForAllNamespaces()),
    listOrEmpty('services', () => coreApi.listServiceForAllNamespaces()),
    listOrEmpty('horizontalpodautoscalers', () =>
      autoScalingApi.listHorizontalPodAutoscalerForAllNamespaces(),
    ),
    listOrEmpty('ingresses', () => networkingApi.listIngressForAllNamespaces()),
    listOrEmpty('deployments', () => appsApi.listDeploymentForAllNamespaces()),
    listOrEmpty('statefulsets', () => appsApi.listStatefulSetForAllNamespaces()),
    listOrEmpty('daemonsets', () => appsApi.listDaemonSetForAllNamespaces()),
    listOrEmpty('replicasets', () => appsApi.listReplicaSetForAllNamespaces()),
  ]);

  // Nothing at all came back: the cluster is unreachable rather than
  // restrictive. The host turns this throw into a source-level error.
  if (attempts.every((attempt) => attempt.error !== undefined)) {
    const [first] = attempts;
    throw new Error(
      `Kubernetes API unreachable: ${first?.error instanceof Error ? first.error.message : 'no resource kind could be listed'}`,
      { cause: first?.error },
    );
  }

  const [pods, services, hpa, ingresses, deployments, statefulSets, daemonSets, replicaSets] =
    attempts.map((attempt) => attempt.value);

  return {
    pods,
    services,
    hpa,
    ingresses,
    deployments,
    statefulSets,
    daemonSets,
    replicaSets,
  } as Resources;
}
