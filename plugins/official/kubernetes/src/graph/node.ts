import { ServiceNode } from 'dockscope/plugin-sdk/v1';

export type Kind = ServiceNode['kind'];
export type Status = ServiceNode['status'];
export type Health = ServiceNode['health'];

export function k8sId(kind: Kind, namespace: string, name: string) {
  return `k8s:${kind}:${namespace}:${name}`;
}

export function Node(kind: Kind, namespace: string, name: string): ServiceNode {
  return {
    id: k8sId(kind, namespace, name),
    name,
    fullName: `${namespace}/${name}`,
    project: namespace,
    host: 'kubernetes',
    runtime: 'kubernetes',
    kind,
    namespace,
    containerId: k8sId(kind, namespace, name),
    cpu: 0,
    memory: 0,
    memoryLimit: 0,
    networkRx: 0,
    networkTx: 0,
    networkRxRate: 0,
    networkTxRate: 0,
    image: '',
    status: 'unknown',
    health: 'healthy',
    ports: [],
    networks: [],
    volumeCount: 0,
  };
}
