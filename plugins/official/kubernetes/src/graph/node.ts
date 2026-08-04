import { ServiceNode } from 'dockscope/plugin-sdk/v1';

/**
 * The workload kinds are widened locally: `ServiceNode['kind']` in the
 * published SDK this plugin compiles against does not list them yet (they
 * arrive in the next dockscope release). Nothing validates the field at
 * runtime, so the graph renders correctly today; the cast in `Node` is the one
 * place that bridges the gap and can be dropped once the devDependency is
 * bumped.
 */
export type Kind = NonNullable<ServiceNode['kind']> | 'deployment' | 'statefulset' | 'daemonset';
export type Status = ServiceNode['status'];
export type Health = ServiceNode['health'];

export function k8sId(kind: Kind, namespace: string, name: string) {
  return `k8s:${kind}:${namespace}:${name}`;
}

export function Node(kind: Kind, namespace: string, name: string): ServiceNode {
  return {
    id: k8sId(kind, namespace, name),
    kind: kind as ServiceNode['kind'],
    name,
    fullName: `${namespace}/${name}`,
    project: namespace,
    host: 'kubernetes',
    runtime: 'kubernetes',
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
    health: 'none',
    ports: [],
    networks: [],
    volumeCount: 0,
  };
}
