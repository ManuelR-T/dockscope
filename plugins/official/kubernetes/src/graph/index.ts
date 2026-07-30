import { GraphData } from 'dockscope';
import { Resources } from '../resources';
import podNode from './pod';

export function buildGraph(resources: Resources): GraphData {
  const graph: GraphData = {
    nodes: [],
    links: [],
  };

  for (const pod of resources.pods.items) {
    graph.nodes.push(podNode(pod));
  }

  return graph;
}
