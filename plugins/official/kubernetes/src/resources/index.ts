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
  // ReplicaSets are fetched but never drawn: they are only the hop between a
  // pod and its Deployment. Rendering them would add a node per rollout
  // revision for no insight, so resolvePodOwner walks through them instead.
  replicaSets: V1ReplicaSetList;
}

export default async function listResources({
  coreApi,
  appsApi,
  autoScalingApi,
  networkingApi,
}: KubeClient): Promise<Resources> {
  const [pods, services, hpa, ingresses, deployments, statefulSets, daemonSets, replicaSets] =
    await Promise.all([
      coreApi.listPodForAllNamespaces(),
      coreApi.listServiceForAllNamespaces(),
      autoScalingApi.listHorizontalPodAutoscalerForAllNamespaces(),
      networkingApi.listIngressForAllNamespaces(),
      appsApi.listDeploymentForAllNamespaces(),
      appsApi.listStatefulSetForAllNamespaces(),
      appsApi.listDaemonSetForAllNamespaces(),
      appsApi.listReplicaSetForAllNamespaces(),
    ]);

  return { pods, services, hpa, ingresses, deployments, statefulSets, daemonSets, replicaSets };
}
