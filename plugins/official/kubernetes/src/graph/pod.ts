import { V1Pod } from '@kubernetes/client-node';
import { ServiceNode } from 'dockscope';
import { Health, Node, Status } from './node';

function podStatus(pod: V1Pod): { status: Status; health: Health } {
  const phase = (pod.status?.phase || 'Unknown').toLowerCase();
  const ready = pod.status?.conditions?.find((condition) => condition.type === 'Ready')?.status;
  if (phase === 'running') {
    return { status: 'running', health: ready === 'True' ? 'healthy' : 'starting' };
  }
  if (phase === 'pending') {
    return { status: 'pending', health: 'starting' };
  }
  if (phase === 'succeeded') {
    return { status: 'exited', health: 'none' };
  }
  if (phase === 'failed') {
    return { status: 'dead', health: 'unhealthy' };
  }
  return { status: 'unknown', health: 'none' };
}

export default function podNode(pod: V1Pod): ServiceNode {
  const namespace = pod.metadata?.namespace || 'default';
  const name = pod.metadata?.name || '';
  const containers = pod.spec?.containers || [];
  const ports = containers.flatMap((container) =>
    (container.ports || []).map(
      (port) => `${port.containerPort}/${(port.protocol || 'TCP').toLowerCase()}`,
    ),
  );

  return {
    ...Node('pod', namespace, name),
    image:
      pod.spec?.containers
        .map((container) => container.image)
        .filter(Boolean)
        .join(', ') || 'Pod',
    ...podStatus(pod),
    ports,
    networks: [namespace],
    volumeCount: 0,
  };
}
