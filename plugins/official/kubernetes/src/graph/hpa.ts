import { ServiceLink, ServiceNode } from 'dockscope';
import { k8sId, Node } from './node';
import { V2HorizontalPodAutoscaler, V1Pod } from '@kubernetes/client-node';

export function hpaNode(hpa: V2HorizontalPodAutoscaler): ServiceNode {
  const namespace = hpa.metadata?.namespace || 'default';
  const name = hpa.metadata?.name || 'unknown';

  const current = hpa.status?.currentReplicas ?? 0;
  const desired = hpa.status?.desiredReplicas ?? 0;

  // Kubernetes reports a failing autoscaler through ScalingActive rather than
  // through the replica counts: when it cannot compute a target (no
  // metrics-server, an unknown metric, missing RBAC) it leaves desiredReplicas
  // at 0 and sets ScalingActive=False. Reading only the counts renders a broken
  // HPA as "healthy" showing a meaningless "2/0 replicas".
  const scalingActive = hpa.status?.conditions?.find(
    (condition) => condition.type === 'ScalingActive',
  );
  const inactive = scalingActive?.status === 'False';
  const reason = scalingActive?.reason;

  const replicaLabel = inactive
    ? `${current} replicas, scaling inactive`
    : `${current}/${desired} replicas`;

  return {
    ...Node('hpa', namespace, name),
    image: `HPA ${replicaLabel}`,
    status: 'running',
    health: inactive ? 'unhealthy' : desired > current ? 'starting' : 'healthy',
    // An HPA exposes no ports. Replica counts and the scaling reason belong in
    // metadata, which the sidebar renders as its own section; putting them here
    // listed "FailedGetResourceMetric" under Network > Ports.
    ports: [],
    networks: [namespace],
    volumeCount: 0,
    metadata: {
      replicas: replicaLabel,
      range: `${hpa.spec?.minReplicas ?? 1}-${hpa.spec?.maxReplicas ?? '?'}`,
      currentReplicas: current,
      desiredReplicas: desired,
      scalingActive: !inactive,
      ...(reason ? { scalingActiveReason: reason } : {}),
      ...(scalingActive?.message ? { scalingActiveMessage: scalingActive.message } : {}),
    },
  };
}

export function hpaLink(hpa: V2HorizontalPodAutoscaler, pod: V1Pod): ServiceLink {
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
