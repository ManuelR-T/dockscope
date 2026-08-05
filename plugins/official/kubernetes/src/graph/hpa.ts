import { ServiceLink, ServiceNode } from 'dockscope';
import { k8sId, Node } from './node';
import { V2HorizontalPodAutoscaler } from '@kubernetes/client-node';
import { WorkloadRef } from '../resources/workloads';

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
    // minReplicas/maxReplicas must stay numbers under exactly these keys: the
    // "Set replica bounds" form pre-fills from them via ref.context.metadata.
    // While the bounds were only published as a formatted "2-5" range string,
    // the form silently fell back to 1/1, so opening it on a 2-5 autoscaler and
    // accepting the defaults scaled the workload down.
    metadata: {
      replicas: replicaLabel,
      minReplicas: hpa.spec?.minReplicas ?? 1,
      maxReplicas: hpa.spec?.maxReplicas ?? 1,
      currentReplicas: current,
      desiredReplicas: desired,
      scalingActive: !inactive,
      ...(reason ? { scalingActiveReason: reason } : {}),
      ...(scalingActive?.message ? { scalingActiveMessage: scalingActive.message } : {}),
    },
  };
}

/**
 * An HPA scales a controller, not pods, so the edge points at the workload
 * named by `scaleTargetRef` rather than fanning out to matching pods.
 */
export function hpaLink(hpa: V2HorizontalPodAutoscaler, target: WorkloadRef): ServiceLink {
  const namespace = hpa.metadata?.namespace || 'default';
  const name = hpa.metadata?.name || 'unknown';

  return {
    source: k8sId('hpa', namespace, name),
    target: k8sId(target.kind, target.namespace, target.name),
    type: 'depends_on',
    label: `scales ${hpa.spec?.scaleTargetRef?.kind || 'target'}`,
  };
}
