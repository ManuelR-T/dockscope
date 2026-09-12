import type { V1Pod } from '@kubernetes/client-node';
import type { ServiceNode } from 'dockscope';
import { Node, type Health, type Status } from './node';

type PodStatus = { status: Status; health: Health };

const PHASE_STATUS = new Map<string, (ready: string | undefined) => PodStatus>([
  [
    'running',
    (ready) => ({ status: 'running', health: ready === 'True' ? 'healthy' : 'starting' }),
  ],
  ['pending', () => ({ status: 'pending', health: 'starting' })],
  ['succeeded', () => ({ status: 'exited', health: 'none' })],
  ['failed', () => ({ status: 'dead', health: 'unhealthy' })],
]);

function podStatus(pod: V1Pod): PodStatus {
  const phase = (pod.status?.phase || 'Unknown').toLowerCase();
  const ready = pod.status?.conditions?.find((condition) => condition.type === 'Ready')?.status;
  return PHASE_STATUS.get(phase)?.(ready) ?? { status: 'unknown', health: 'none' };
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
