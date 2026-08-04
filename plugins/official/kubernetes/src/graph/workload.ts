import { ServiceLink, ServiceNode } from 'dockscope';
import { k8sId, Node } from './node';
import { Workload, WorkloadRef } from '../resources/workloads';

export function workloadNode(workload: Workload): ServiceNode {
  const { kind, namespace, name, desired, ready, apiKind } = workload;

  // A workload with zero desired replicas is scaled down on purpose, which is
  // a resting state rather than a failure; anything short of desired is still
  // converging.
  const health = desired === 0 ? 'none' : ready >= desired ? 'healthy' : 'starting';

  return {
    ...Node(kind, namespace, name),
    image: workload.images.join(', ') || apiKind,
    status: desired === 0 ? 'exited' : 'running',
    health,
    ports: [],
    networks: [namespace],
    volumeCount: 0,
    metadata: {
      kind: apiKind,
      replicas: `${ready}/${desired} ready`,
      readyReplicas: ready,
      desiredReplicas: desired,
    },
  };
}

export function workloadPodLink(owner: WorkloadRef, podName: string): ServiceLink {
  return {
    source: k8sId(owner.kind, owner.namespace, owner.name),
    target: k8sId('pod', owner.namespace, podName),
    type: 'kubernetes',
    label: 'manages',
  };
}
