import type { GraphData, DockerEvent, WSMessage, ContainerStats, LogChunk } from '../../types';
import { DOCKER } from '../lib/constants';
export { addToast } from './toast.svelte';

let graph = $state<GraphData>({ nodes: [], links: [] });
let nodeIndex = new Map<string, any>();
let events = $state<DockerEvent[]>([]);
let connected = $state(false);
let streamingLogs = $state('');
let streamingLogContainerId = $state<string | null>(null);
let composeEnabled = $state(true);

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout>;

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onopen = () => {
    connected = true;
  };

  ws.onclose = () => {
    connected = false;
    reconnectTimer = setTimeout(connect, DOCKER.wsReconnectDelay);
  };

  ws.onerror = () => {
    ws?.close();
  };

  ws.onmessage = (e) => {
    try {
      const msg: WSMessage = JSON.parse(e.data);
      switch (msg.type) {
        case 'graph': {
          const incoming = msg.data as GraphData;
          const existingMap = new Map(graph.nodes.map((n: any) => [n.id, n]));

          // Merge: preserve d3 simulation positions (x, y, z, vx, vy, vz)
          const mergedNodes = incoming.nodes.map((newNode) => {
            const existing = existingMap.get(newNode.id);
            if (existing) {
              Object.assign(existing, {
                name: newNode.name,
                fullName: newNode.fullName,
                project: newNode.project,
                containerId: newNode.containerId,
                image: newNode.image,
                status: newNode.status,
                health: newNode.health,
                ports: newNode.ports,
                networks: newNode.networks,
                volumeCount: newNode.volumeCount,
              });
              return existing;
            }
            return newNode;
          });

          graph = { nodes: mergedNodes, links: incoming.links };
          nodeIndex = new Map(mergedNodes.map((n: any) => [n.id, n]));
          break;
        }

        case 'stats': {
          // Mutate in-place — no reactivity trigger needed,
          // the force graph reads these on its own render loop
          const stats = msg.data as ContainerStats;
          const node = nodeIndex.get(stats.id);
          if (node) {
            node.cpu = stats.cpu;
            node.memory = stats.memory;
            node.memoryLimit = stats.memoryLimit;
            node.networkRx = stats.networkRx;
            node.networkTx = stats.networkTx;
            node.networkRxRate = stats.networkRxRate;
            node.networkTxRate = stats.networkTxRate;
          }
          break;
        }

        case 'event':
          events = [msg.data as DockerEvent, ...events].slice(0, 200);
          break;

        case 'log_chunk': {
          const chunk = msg.data as LogChunk;
          if (chunk.containerId === streamingLogContainerId) {
            streamingLogs += chunk.text;
            // Cap at ~500KB to avoid memory issues
            if (streamingLogs.length > DOCKER.logMaxBuffer) {
              streamingLogs = streamingLogs.slice(-DOCKER.logTrimTo);
            }
          }
          break;
        }

        case 'error':
          console.error('DockScope error:', (msg.data as { message: string }).message);
          break;
      }
    } catch {
      // ignore malformed messages
    }
  };
}

export function initDocker() {
  fetch('/api/graph')
    .then((r) => r.json())
    .then((data) => {
      graph = data;
    })
    .catch(() => {});

  fetch('/api/features')
    .then((r) => r.json())
    .then((data) => {
      composeEnabled = data.compose ?? true;
    })
    .catch(() => {});

  connect();

  return () => {
    clearTimeout(reconnectTimer);
    ws?.close();
  };
}

export function subscribeLogs(containerId: string) {
  unsubscribeLogs();
  streamingLogContainerId = containerId;
  streamingLogs = '';
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe_logs', data: { containerId } }));
  }
}

export function unsubscribeLogs() {
  if (streamingLogContainerId && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'unsubscribe_logs' }));
  }
  streamingLogContainerId = null;
}

export function getDockerState() {
  return {
    get graph() {
      return graph;
    },
    get events() {
      return events;
    },
    get connected() {
      return connected;
    },
    get streamingLogs() {
      return streamingLogs;
    },
    get streamingLogContainerId() {
      return streamingLogContainerId;
    },
    get composeEnabled() {
      return composeEnabled;
    },
  };
}
