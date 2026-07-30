import {
  V1HorizontalPodAutoscalerList,
  V1IngressList,
  V1ObjectMeta,
  V1PodList,
  V1ServiceList,
} from '@kubernetes/client-node';
import { KubeClient } from '../client';

export interface Resources {
  pods: V1PodList;
  services: V1ServiceList;
  hpa: V1HorizontalPodAutoscalerList;
  ingresses: V1IngressList;
}

export default async function listResources({
  coreApi,
  autoScalingApi,
  networkingApi,
}: KubeClient): Promise<Resources> {
  const pods = coreApi.listPodForAllNamespaces();
  const services = coreApi.listServiceForAllNamespaces();
  const hpa = autoScalingApi.listHorizontalPodAutoscalerForAllNamespaces();
  const ingresses = networkingApi.listIngressForAllNamespaces();

  return Promise.all([pods, services, hpa, ingresses]).then(([pods, services, hpa, ingresses]) => {
    return {
      pods,
      services,
      hpa,
      ingresses,
    };
  });
}
