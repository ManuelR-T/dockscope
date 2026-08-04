import { GraphData } from 'dockscope';
import { Resources } from '../resources';
import podNode from './pod';
import { serviceLink, serviceNode } from './service';
import { getPodsForService } from '../resources/services';
import { ingressLink, ingressNode } from './ingress';
import { hpaLink, hpaNode } from './hpa';
import { workloadNode, workloadPodLink } from './workload';
import {
  listWorkloads,
  resolveHpaTarget,
  resolvePodOwner,
  workloadKey,
} from '../resources/workloads';

export function buildGraph(resources: Resources): GraphData {
  const graph: GraphData = {
    nodes: [],
    links: [],
  };

  const workloads = listWorkloads(resources);
  // Links are only drawn to workloads that were actually listed, so a pod whose
  // controller sits outside what we fetch does not produce a dangling edge.
  const drawnWorkloads = new Set(workloads.map(workloadKey));

  for (const workload of workloads) {
    graph.nodes.push(workloadNode(workload));
  }

  for (const pod of resources.pods.items) {
    graph.nodes.push(podNode(pod));

    const owner = resolvePodOwner(pod, resources.replicaSets.items);
    if (owner && drawnWorkloads.has(workloadKey(owner))) {
      graph.links.push(workloadPodLink(owner, pod.metadata?.name || 'unknown'));
    }
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

    const target = resolveHpaTarget(hpa);
    if (target && drawnWorkloads.has(workloadKey(target))) {
      graph.links.push(hpaLink(hpa, target));
    }
  }

  return graph;
}
