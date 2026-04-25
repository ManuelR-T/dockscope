import { existsSync } from 'fs';
import type { ServiceNode, ServiceLink } from '../types.js';
import { shortId } from '../utils.js';
import { parseComposeFile } from './compose.js';

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

/** Extract depends_on links from container labels (runtime) */
export function extractDependsOnFromLabels(
  containers: any[],
  nodes: ServiceNode[],
  containerProject: Map<string, string>,
): { links: ServiceLink[]; seen: Set<string> } {
  const links: ServiceLink[] = [];
  const seen = new Set<string>();

  for (const container of containers) {
    const depsLabel = container.Labels['com.docker.compose.depends_on'];
    if (!depsLabel) {
      continue;
    }
    const project = container.Labels['com.docker.compose.project'] || '';
    const sourceId = shortId(container.Id);
    const sourceNode = nodes.find((n) => n.id === sourceId);
    if (!sourceNode) {
      continue;
    }

    for (const entry of depsLabel.split(',')) {
      const depName = entry.split(':')[0]?.trim();
      if (!depName) {
        continue;
      }
      const targetNode = nodes.find((n) => {
        const tp = containerProject.get(n.id) || '';
        return (
          tp === project &&
          (n.name === depName ||
            n.name === `${project}/${depName}` ||
            n.name.endsWith(`/${depName}`))
        );
      });
      if (targetNode) {
        const key = `${sourceNode.id}->${targetNode.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          links.push({ source: sourceNode.id, target: targetNode.id, type: 'depends_on' });
        }
      }
    }
  }
  return { links, seen };
}

/** Extract depends_on links from compose file */
export async function extractDependsOnFromFile(
  composeFile: string | undefined,
  nodes: ServiceNode[],
  containerProject: Map<string, string>,
  seen: Set<string>,
): Promise<ServiceLink[]> {
  const links: ServiceLink[] = [];
  const filesToTry = composeFile ? [composeFile] : COMPOSE_FILES;

  for (const file of filesToTry) {
    if (!existsSync(file)) {
      continue;
    }
    try {
      const compose = await parseComposeFile(file);
      for (const service of compose.services) {
        const node = nodes.find(
          (n) => n.name === service.name || n.name.endsWith(`/${service.name}`),
        );
        if (!node) {
          continue;
        }
        const nodeProject = containerProject.get(node.id) || '';
        for (const dep of service.dependsOn) {
          const target = nodes.find((n) => {
            const tp = containerProject.get(n.id) || '';
            return (
              tp === nodeProject &&
              (n.name === dep || n.name === `${nodeProject}/${dep}` || n.name.endsWith(`/${dep}`))
            );
          });
          if (target) {
            const key = `${node.id}->${target.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              links.push({ source: node.id, target: target.id, type: 'depends_on' });
            }
          }
        }
      }
      break;
    } catch {
      continue;
    }
  }
  return links;
}

/** Extract network-based links (containers sharing non-default networks) */
export function extractNetworkLinks(networkMap: Map<string, string[]>): ServiceLink[] {
  const links: ServiceLink[] = [];
  const defaultNetworks = new Set(['bridge', 'host', 'none']);
  const seen = new Set<string>();

  for (const [network, containerIds] of networkMap) {
    if (defaultNetworks.has(network)) {
      continue;
    }
    for (let i = 0; i < containerIds.length; i++) {
      for (let j = i + 1; j < containerIds.length; j++) {
        const key = `${containerIds[i]}<>${containerIds[j]}:${network}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        links.push({
          source: containerIds[i],
          target: containerIds[j],
          type: 'network',
          label: network,
        });
      }
    }
  }
  return links;
}
