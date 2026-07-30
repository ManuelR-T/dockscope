import { V2HorizontalPodAutoscaler, V1Pod, V1PodList } from '@kubernetes/client-node';

export function getPodsForHpa(hpa: V2HorizontalPodAutoscaler, pods: V1PodList): V1Pod[] {
  const namespace = hpa.metadata?.namespace || 'default';

  const target = hpa.spec?.scaleTargetRef;
  if (!target?.name) {
    return [];
  }

  return pods.items.filter((pod) => {
    if ((pod.metadata?.namespace || 'default') !== namespace) {
      return false;
    }
    const labels = pod.metadata?.labels || {};
    return (
      labels.app === target.name ||
      labels['app.kubernetes.io/name'] === target.name ||
      (pod.metadata?.name || 'unknown').startsWith(`${target.name}-`)
    );
  });
}
