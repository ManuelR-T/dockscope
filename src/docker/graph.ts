import type Dockerode from 'dockerode';
import { shortId } from '../utils.js';
import type { GraphData, ServiceNode } from '../types.js';
import {
  extractDependsOnFromFile,
  extractDependsOnFromLabels,
  extractNetworkLinks,
} from './links.js';
import { getDefaultDockerClient } from './connection.js';

export async function buildGraph(
  composeFile?: string,
  host: string = 'local',
  client?: Dockerode,
): Promise<GraphData> {
  const containers = await (client || getDefaultDockerClient()).listContainers({ all: true });
  const nodes: ServiceNode[] = [];
  const networkMap = new Map<string, string[]>();
  const containerProject = new Map<string, string>();

  for (const container of containers) {
    const composeService = container.Labels['com.docker.compose.service'];
    const project = container.Labels['com.docker.compose.project'] || '';
    const rawName =
      composeService || container.Names[0]?.replace(/^\//, '') || shortId(container.Id);

    const hasDuplicate = containers.some(
      (c) =>
        c.Id !== container.Id &&
        (c.Labels['com.docker.compose.service'] || c.Names[0]?.replace(/^\//, '')) === rawName &&
        (c.Labels['com.docker.compose.project'] || '') !== project,
    );
    const serviceName = hasDuplicate && project ? `${project}/${rawName}` : rawName;
    const sid = shortId(container.Id);
    containerProject.set(sid, project);

    const healthStatus = container.Status?.toLowerCase() || '';
    let health: ServiceNode['health'] = 'none';
    if (healthStatus.includes('healthy') && !healthStatus.includes('unhealthy')) {
      health = 'healthy';
    } else if (healthStatus.includes('unhealthy')) {
      health = 'unhealthy';
    } else if (healthStatus.includes('starting') || healthStatus.includes('health:')) {
      health = 'starting';
    }

    nodes.push({
      id: sid,
      name: serviceName,
      fullName: container.Names[0]?.replace(/^\//, '') || serviceName,
      project,
      host,
      containerId: container.Id,
      image: container.Image,
      status: container.State as ServiceNode['status'],
      health,
      ports: [
        ...new Set(
          container.Ports.map(
            (p) => `${p.PublicPort ? p.PublicPort + ':' : ''}${p.PrivatePort}/${p.Type}`,
          ),
        ),
      ],
      networks: Object.keys(container.NetworkSettings?.Networks || {}),
      volumeCount: (container.Mounts || []).length,
      cpu: 0,
      memory: 0,
      memoryLimit: 0,
      networkRx: 0,
      networkTx: 0,
      networkRxRate: 0,
      networkTxRate: 0,
    });

    for (const net of Object.keys(container.NetworkSettings?.Networks || {})) {
      if (!networkMap.has(net)) {
        networkMap.set(net, []);
      }
      networkMap.get(net)!.push(sid);
    }
  }

  const { links: labelLinks, seen } = extractDependsOnFromLabels(
    containers,
    nodes,
    containerProject,
  );
  const fileLinks = await extractDependsOnFromFile(composeFile, nodes, containerProject, seen);
  const netLinks = extractNetworkLinks(networkMap);

  return { nodes, links: [...labelLinks, ...fileLinks, ...netLinks] };
}
