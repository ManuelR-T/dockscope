import { ServiceLink, ServiceNode } from 'dockscope';
import { k8sId, Node } from './node';
import { V1HorizontalPodAutoscaler, V1Pod } from '@kubernetes/client-node';

export function hpaNode(hpa: V1HorizontalPodAutoscaler): ServiceNode {
  const namespace = hpa.metadata?.namespace || 'default';
  const name = hpa.metadata?.name || 'unknown';

  const current = hpa.status?.currentReplicas ?? 0;
  const desired = hpa.status?.desiredReplicas ?? 0;

  return {
    ...Node('hpa', namespace, name),
    image: `HPA ${current}/${desired} replicas`,
    status: 'running',
    health: desired > current ? 'starting' : 'healthy',
    ports: [
      `${current}/${desired} replicas`,
      `${hpa.spec?.minReplicas ?? 1}-${hpa.spec?.maxReplicas ?? '?'} range`,
    ],
    networks: [namespace],
    volumeCount: 0,
    metadata: {
      currentReplicas: current,
      desiredReplicas: desired,
      minReplicas: hpa.spec?.minReplicas ?? 1,
      maxReplicas: hpa.spec?.maxReplicas ?? 1,
    },
  };
}

export function hpaLink(hpa: V1HorizontalPodAutoscaler, pod: V1Pod): ServiceLink {
  const namespace = hpa.metadata?.namespace || 'default';
  const name = hpa.metadata?.name || 'unknown';
  const targetKind = hpa.spec?.scaleTargetRef?.kind || 'target';

  const ingressId = k8sId('hpa', namespace, name);

  return {
    source: ingressId,
    target: k8sId('pod', namespace, pod.metadata?.name || 'unknown'),
    type: 'depends_on',
    label: `scales ${targetKind}`,
  };
}
