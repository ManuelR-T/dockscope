import { GraphData } from 'dockscope';
import { Resources } from '../resources';
import podNode from './pod';
import { serviceLink, serviceNode } from './service';
import { getPodsForService } from '../resources/services';
import { ingressLink, ingressNode } from './ingress';
import { hpaLink, hpaNode } from './hpa';
import { getPodsForHpa } from '../resources/hpa';

export function buildGraph(resources: Resources): GraphData {
  const graph: GraphData = {
    nodes: [],
    links: [],
  };

  for (const pod of resources.pods.items) {
    graph.nodes.push(podNode(pod));
  }

  for (const svc of resources.services.items) {
    graph.nodes.push(serviceNode(svc));

    for (const pod of getPodsForService(svc, resources.pods)) {
      graph.links.push(serviceLink(svc, pod));
    }
  }

  for (const ingress of resources.ingresses.items) {
    graph.nodes.push(ingressNode(ingress));

    for (const rule of ingress.spec?.rules || []) {
      for (const path of rule.http?.paths || []) {
        const serviceName = path.backend?.service?.name;
        if (serviceName) {
          graph.links.push(ingressLink(ingress, serviceName, rule));
        }
      }
    }
  }

  for (const hpa of resources.hpa.items) {
    graph.nodes.push(hpaNode(hpa));

    for (const pod of getPodsForHpa(hpa, resources.pods)) {
      graph.links.push(hpaLink(hpa, pod));
    }
  }

  return graph;
}
