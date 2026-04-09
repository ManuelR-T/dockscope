import Dockerode from 'dockerode';

function rejectAfter<T>(ms: number): Promise<T> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}
import { createDockerClient, buildGraph } from './client.js';
import type { GraphData, ServiceNode, ServiceLink } from '../types.js';

export interface DockerHost {
  name: string;
  url: string; // 'local' for default socket, or tcp://..., ssh://..., etc.
  client: Dockerode;
  connected: boolean;
  containers: number;
  version: string;
}

const hosts = new Map<string, DockerHost>();

/** Initialize with the default local host */
export function initHosts(defaultHost?: string): void {
  if (hosts.size === 0) {
    const url = defaultHost || 'local';
    hosts.set('local', {
      name: 'local',
      url,
      client: defaultHost ? createDockerClient(defaultHost) : createDockerClient(),
      connected: true,
      containers: 0,
      version: '',
    });
  }
}

/** Add a remote Docker host */
export async function addHost(name: string, url: string): Promise<{ ok: boolean; error?: string }> {
  if (hosts.has(name)) return { ok: false, error: `Host "${name}" already exists` };
  const client = createDockerClient(url);
  try {
    await Promise.race([
      client.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out')), 5000)),
    ]);
    hosts.set(name, { name, url, client, connected: true, containers: 0, version: '' });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `Cannot connect to ${url}: ${err.message}` };
  }
}

/** Get a host by name */
export function getHost(name: string): DockerHost | undefined {
  return hosts.get(name);
}

/** Remove a Docker host */
export function removeHost(name: string): boolean {
  if (name === 'local') return false; // Can't remove default
  return hosts.delete(name);
}

/** Return cached host status instantly (no blocking) */
export function listHosts(): {
  name: string;
  url: string;
  connected: boolean;
  containers: number;
  version: string;
}[] {
  return [...hosts.values()].map((h) => ({
    name: h.name,
    url: h.url,
    connected: h.connected,
    containers: h.containers,
    version: h.version,
  }));
}

/** Refresh host status in the background (called periodically by the server) */
export async function refreshHostStatus(): Promise<void> {
  await Promise.all(
    [...hosts.values()].map(async (h) => {
      try {
        const info = await Promise.race([
          h.client.info(),
          rejectAfter<{ ServerVersion?: string }>(3000),
        ]);
        const list = await Promise.race([
          h.client.listContainers({ all: true }),
          rejectAfter<Dockerode.ContainerInfo[]>(3000),
        ]);
        h.containers = list.length;
        h.version = info.ServerVersion || '';
        h.connected = true;
      } catch {
        h.connected = false;
        h.containers = 0;
      }
    }),
  );
}

/** Build a merged graph from all connected hosts */
export async function buildMultiHostGraph(): Promise<GraphData> {
  const allNodes: ServiceNode[] = [];
  const allLinks: ServiceLink[] = [];

  const results = await Promise.allSettled(
    [...hosts.values()].map(async (h) => {
      try {
        const graph = await Promise.race([
          buildGraph(undefined, h.name, h.client),
          rejectAfter<GraphData>(5000),
        ]);
        h.connected = true;
        return graph;
      } catch {
        h.connected = false;
        return null;
      }
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      // Prefix node IDs with host name to avoid collisions when the same
      // daemon is reachable via multiple URLs (prevents superposed nodes)
      const hostName = result.value.nodes[0]?.host || 'local';
      if (hosts.size > 1) {
        for (const node of result.value.nodes) {
          node.id = `${hostName}:${node.id}`;
        }
        for (const link of result.value.links) {
          if (typeof link.source === 'string') link.source = `${hostName}:${link.source}`;
          if (typeof link.target === 'string') link.target = `${hostName}:${link.target}`;
        }
      }
      allNodes.push(...result.value.nodes);
      allLinks.push(...result.value.links);
    }
  }

  return { nodes: allNodes, links: allLinks };
}
