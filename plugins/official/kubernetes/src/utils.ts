export const RESOURCE_KINDS = [
  'pod',
  'service',
  'ingress',
  'hpa',
  'deployment',
  'statefulset',
  'daemonset',
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** The workload controllers, which are the kinds that can be rolled out. */
export const WORKLOAD_KINDS = ['deployment', 'statefulset', 'daemonset'] as const;

export function isWorkloadKind(kind: string): kind is (typeof WORKLOAD_KINDS)[number] {
  return (WORKLOAD_KINDS as readonly string[]).includes(kind);
}

export function parseResourceId(id: string) {
  const [prefix, kind, namespace, ...nameParts] = id.split(':');
  const name = nameParts.join(':');
  if (
    prefix !== 'k8s' ||
    !(RESOURCE_KINDS as readonly string[]).includes(kind) ||
    !namespace ||
    !name
  ) {
    throw new Error('Invalid Kubernetes resource ID');
  }
  return { kind: kind as ResourceKind, namespace, name };
}
