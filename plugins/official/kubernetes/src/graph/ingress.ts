import { ServiceLink, ServiceNode } from 'dockscope';
import { k8sId, Node } from './node';
import { V1Ingress, V1IngressRule } from '@kubernetes/client-node';

export function ingressNode(ingress: V1Ingress): ServiceNode {
  const namespace = ingress.metadata?.namespace || 'default';
  const name = ingress.metadata?.name || 'unknown';

  const ports =
    ingress.spec?.rules?.flatMap((rule) =>
      (rule.http?.paths || []).map((path) => `${rule.host || '*'}${path.path || '/'}`),
    ) || [];

  return {
    ...Node('ingress', namespace, name),
    image: 'Ingress',
    status: 'running',
    ports,
    networks: [namespace],
  };
}

export function ingressLink(ingress: V1Ingress, svc: string, rule: V1IngressRule): ServiceLink {
  const namespace = ingress.metadata?.namespace || 'default';
  const name = ingress.metadata?.name || 'unknown';

  const ingressId = k8sId('ingress', namespace, name);

  return {
    source: ingressId,
    target: k8sId('pod', namespace, svc),
    type: 'depends_on',
    label: rule.host || 'ingress',
  };
}
