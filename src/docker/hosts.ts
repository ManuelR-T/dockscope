import Dockerode from 'dockerode';
import { collectSourceGraphs } from '../core/sources/collect.js';
import type { DataSourceDescriptor, GraphSourceAdapter } from '../core/sources/model.js';
import { buildGraph, createDockerClient } from './client.js';
import { DOCKER_SOURCE_CAPABILITIES } from './capabilities.js';
import { watchEvents } from './events.js';
import type { GraphData } from '../types.js';
import { errorMessage } from '../utils.js';

function rejectAfter<T>(ms: number): Promise<T> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

export interface DockerHost {
  name: string;
  url: string; // 'local' for default socket, or tcp://..., ssh://..., etc.
  client: Dockerode;
  connected: boolean;
  containers: number;
  version: string;
}

const hosts = new Map<string, DockerHost>();

export function describeDockerHostSource(host: DockerHost): DataSourceDescriptor {
  return {
    id: host.name,
    label: host.name,
    kind: 'docker',
    pluginId: 'core.docker',
    capabilities: DOCKER_SOURCE_CAPABILITIES,
    status: host.connected ? 'connected' : 'disconnected',
    metadata: {
      url: host.url,
      containers: host.containers,
      version: host.version,
    },
  };
}

function createDockerHostGraphAdapter(host: DockerHost): GraphSourceAdapter {
  return {
    describe: () => describeDockerHostSource(host),
    collectGraph: async () => {
      try {
        const graph = await buildGraph(undefined, host.name, host.client);
        host.connected = true;
        return {
          source: describeDockerHostSource(host),
          graph,
          collectedAt: Date.now(),
        };
      } catch (error) {
        host.connected = false;
        throw error;
      }
    },
    startEvents: (callback, onError, onClose) =>
      watchEvents(
        (event) =>
          callback({
            source: describeDockerHostSource(host),
            event,
            receivedAt: Date.now(),
          }),
        (error) => {
          host.connected = false;
          onError?.(error);
        },
        host.client,
        host.name,
        () => {
          host.connected = false;
          onClose?.();
        },
      ),
  };
}

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
  if (hosts.has(name)) {
    return { ok: false, error: `Host "${name}" already exists` };
  }
  const client = createDockerClient(url);
  try {
    await Promise.race([
      client.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out')), 5000)),
    ]);
    hosts.set(name, { name, url, client, connected: true, containers: 0, version: '' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Cannot connect to ${url}: ${errorMessage(err)}` };
  }
}

/** Get a host by name */
export function getHost(name: string): DockerHost | undefined {
  return hosts.get(name);
}

/** Return host entries for internal server services such as event monitoring. */
export function listDockerHosts(): DockerHost[] {
  return [...hosts.values()];
}

/** Remove a Docker host */
export function removeHost(name: string): boolean {
  if (name === 'local') {
    return false;
  } // Can't remove default
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

export function listDockerGraphSources(): GraphSourceAdapter[] {
  return [...hosts.values()].map(createDockerHostGraphAdapter);
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
  const collection = await collectSourceGraphs(listDockerGraphSources(), {
    timeoutMs: 5000,
    scopeIds: hosts.size > 1,
  });
  return collection.graph;
}
