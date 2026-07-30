import { ServiceLink, ServiceNode } from 'dockscope';
import { k8sId, Node } from './node';
import { V1Pod, V1Service } from '@kubernetes/client-node';

export function serviceNode(svc: V1Service): ServiceNode {
  const namespace = svc.metadata?.namespace || 'default';
  const name = svc.metadata?.name || 'unknown';

  const ports = (svc.spec?.ports || []).map((port) => {
    const target = port.targetPort ? `:${port.targetPort}` : '';
    return `${port.port}${target}/${(port.protocol || 'TCP').toLowerCase()}`;
  });

  return {
    ...Node('service', namespace, name),
    image: `Service ${svc.spec?.type || 'ClusterIP'}`,
    status: 'running',
    health: 'none',
    ports,
    networks: [namespace],
    volumeCount: 0,
  };
}

export function serviceLink(svc: V1Service, pod: V1Pod): ServiceLink {
  const namespace = svc.metadata?.namespace || 'default';
  const name = svc.metadata?.name || 'unknown';

  const serviceId = k8sId('service', namespace, name);

  return {
    source: serviceId,
    target: k8sId('pod', namespace, pod.metadata?.name || 'unknown'),
    type: 'kubernetes',
    label: 'selects',
  };
}
