import { V1ObjectMeta, V1Pod, V1PodList, V1Service, V1ServiceSpec } from '@kubernetes/client-node';

export function getPodsForService(svc: V1Service, pods: V1PodList): V1Pod[] {
  const namespace = svc.metadata?.namespace || 'default';
  return pods.items.filter(
    (pod) =>
      (pod.metadata?.namespace || 'default') === namespace &&
      matchesSelector(pod.metadata?.labels, svc.spec?.selector),
  );
}

function matchesSelector(labels: V1ObjectMeta['labels'], selector: V1ServiceSpec['selector']) {
  const entries = Object.entries(selector || {});
  return entries.length > 0 && entries.every(([key, value]) => labels?.[key] === value);
}
