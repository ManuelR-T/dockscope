export function parseResourceId(id: string) {
  const [prefix, kind, namespace, ...nameParts] = id.split(':');
  const name = nameParts.join(':');
  if (
    prefix !== 'k8s' ||
    !['pod', 'service', 'ingress', 'hpa'].includes(kind) ||
    !namespace ||
    !name
  ) {
    throw new Error('Invalid Kubernetes resource ID');
  }
  return { kind, namespace, name };
}

