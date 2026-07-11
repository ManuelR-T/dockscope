import type {
  GraphData,
  ServiceLink,
  ServiceNode,
  DockerEvent,
  WSMessage,
  ContainerStats,
  LogChunk,
  Anomaly,
  CrashDiagnostic,
} from '../../types';
import { DOCKER } from '../lib/constants';
import {
  mergeGraphData,
  nextRolloutExpiry,
  pruneExpiredRollouts,
  pruneLinksToExistingNodes,
} from '../lib/graphMerge';
import { shouldRefreshLogSubscription } from '../lib/logSubscriptions';
import { addToast } from './toast.svelte';
export { addToast };

let graph = $state<GraphData>({ nodes: [], links: [] });
let nodeIndex = new Map<string, ServiceNode>();
let events = $state<DockerEvent[]>([]);
let connected = $state(false);
let streamingLogs = $state('');
let streamingLogContainerId = $state<string | null>(null);
let streamingLogHost = $state<string | null>(null);
let composeEnabled = $state(true);
let anomalies = $state<Map<string, Anomaly>>(new Map());
let diagnostics = $state<Map<string, CrashDiagnostic>>(new Map());

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shouldReconnect = false;
let rolloutPruneTimer: ReturnType<typeof setTimeout> | null = null;

// --- Recording / replay integration ---
// The recorder store taps raw messages (for capture) and injects recorded
// messages back (for replay) without this store knowing about it.
let messageTap: ((msg: WSMessage) => void) | null = null;
let replayMode = $state(false);

/** Message types that replay owns — live updates of these are ignored while replaying */
const REPLAYED_TYPES = new Set(['graph', 'stats', 'event', 'anomaly', 'diagnostic']);

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (!shouldReconnect || reconnectTimer) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, DOCKER.wsReconnectDelay);
}

function sendLogSubscription() {
  if (streamingLogContainerId && ws?.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'subscribe_logs',
        data: { entityId: streamingLogContainerId, sourceId: streamingLogHost || 'local' },
      }),
    );
  }
}

function refreshLogSubscription() {
  const containerId = streamingLogContainerId;
  if (!containerId) {
    return;
  }
  subscribeLogs(containerId, streamingLogHost || 'local');
}

function setGraphData(nodes: ServiceNode[], links: ServiceLink[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  graph = { nodes, links: pruneLinksToExistingNodes(links, nodeIds) };
  nodeIndex = new Map(nodes.map((node) => [node.id, node]));
}

function scheduleRolloutPrune() {
  if (rolloutPruneTimer) {
    clearTimeout(rolloutPruneTimer);
    rolloutPruneTimer = null;
  }

  const now = Date.now();
  const nextExpiry = nextRolloutExpiry(graph.nodes, now);
  if (nextExpiry === null) {
    return;
  }

  rolloutPruneTimer = setTimeout(
    () => {
      setGraphData(pruneExpiredRollouts(graph.nodes, Date.now()), graph.links);
      scheduleRolloutPrune();
    },
    Math.max(0, nextExpiry - now),
  );
}

function mergeGraph(incoming: GraphData) {
  const merged = mergeGraphData(graph, incoming, Date.now());
  setGraphData(merged.nodes, merged.links);
  scheduleRolloutPrune();
}

function isSocketActive(socket: WebSocket | null): boolean {
  return socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN;
}

function connect() {
  if (!shouldReconnect) {
    return;
  }
  if (isSocketActive(ws)) {
    return;
  }

  clearReconnectTimer();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  ws = socket;

  socket.onopen = () => {
    if (ws !== socket) {
      return;
    }
    connected = true;
    sendLogSubscription();
  };

  socket.onclose = () => {
    if (ws !== socket) {
      return;
    }
    connected = false;
    ws = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    if (ws === socket) {
      socket.close();
    }
  };

  socket.onmessage = (e) => {
    if (ws !== socket) {
      return;
    }
    try {
      const msg: WSMessage = JSON.parse(e.data);
      messageTap?.(msg);
      if (replayMode && REPLAYED_TYPES.has(msg.type)) {
        return;
      }
      handleMessage(msg);
    } catch {
      // ignore malformed messages
    }
  };
}

function handleMessage(msg: WSMessage, opts: { replay?: boolean } = {}) {
  switch (msg.type) {
    case 'graph': {
      mergeGraph(msg.data as GraphData);
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

    case 'event': {
      const event = msg.data as DockerEvent;
      events = [event, ...events].slice(0, 200);
      if (shouldRefreshLogSubscription(streamingLogContainerId, streamingLogHost, event)) {
        refreshLogSubscription();
      }
      break;
    }

    case 'log_chunk': {
      const chunk = msg.data as LogChunk;
      if ((chunk.entityId ?? chunk.containerId) === streamingLogContainerId) {
        streamingLogs += chunk.text;
        // Cap at ~500KB to avoid memory issues
        if (streamingLogs.length > DOCKER.logMaxBuffer) {
          streamingLogs = streamingLogs.slice(-DOCKER.logTrimTo);
        }
      }
      break;
    }

    case 'anomaly': {
      const a = msg.data as Anomaly;
      const key = `${a.containerId}:${a.analyzerId ?? 'legacy'}:${a.metric}`;
      if (dismissedAnomalies.has(key)) {
        break;
      }
      const updated = new Map(anomalies);
      updated.set(key, a);
      anomalies = updated;
      if (!opts.replay) {
        addToast(
          `${a.containerName}: ${a.metric.toUpperCase()} spike (${Math.round(a.value)}% vs avg ${Math.round(a.average)}%)`,
          'error',
        );
      }
      break;
    }

    case 'diagnostic':
      addDiagnostic(msg.data as CrashDiagnostic);
      break;

    case 'error':
      console.error('DockScope error:', (msg.data as { message: string }).message);
      break;
  }
}

export function initDocker() {
  shouldReconnect = true;

  fetch('/api/graph')
    .then((r) => r.json())
    .then((data) => {
      mergeGraph(data);
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
    shouldReconnect = false;
    clearReconnectTimer();
    if (ws?.readyState === WebSocket.OPEN && streamingLogContainerId) {
      ws.send(JSON.stringify({ type: 'unsubscribe_logs' }));
    }
    ws?.close();
    ws = null;
    connected = false;
    if (rolloutPruneTimer) {
      clearTimeout(rolloutPruneTimer);
      rolloutPruneTimer = null;
    }
  };
}

export function subscribeLogs(containerId: string, host = 'local') {
  unsubscribeLogs();
  streamingLogContainerId = containerId;
  streamingLogHost = host;
  streamingLogs = '';
  sendLogSubscription();
}

export function unsubscribeLogs() {
  if (streamingLogContainerId && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'unsubscribe_logs' }));
  }
  streamingLogContainerId = null;
  streamingLogHost = null;
}

const dismissedDiagnostics = new Set<string>();

export function addDiagnostic(diag: CrashDiagnostic) {
  if (dismissedDiagnostics.has(diag.containerId)) {
    return;
  }
  const updated = new Map(diagnostics);
  updated.set(diag.containerId, diag);
  diagnostics = updated;
}

export function removeDiagnostic(containerId: string) {
  dismissedDiagnostics.add(containerId);
  const updated = new Map(diagnostics);
  updated.delete(containerId);
  diagnostics = updated;
}

const dismissedAnomalies = new Set<string>();

export function removeAnomaly(key: string) {
  dismissedAnomalies.add(key);
  const updated = new Map(anomalies);
  updated.delete(key);
  anomalies = updated;
}

/** Get active anomalies for a specific container */
export function getAnomaliesForContainer(containerId: string): Anomaly[] {
  const result: Anomaly[] = [];
  for (const [key, a] of anomalies) {
    if (key.startsWith(containerId + ':')) {
      result.push(a);
    }
  }
  return result;
}

// --- Recording / replay API (used by the recorder store) ---

/** Tap every raw WS message before it is handled — used to capture recordings */
export function setMessageTap(tap: ((msg: WSMessage) => void) | null) {
  messageTap = tap;
}

function clearTransientState() {
  events = [];
  anomalies = new Map();
  diagnostics = new Map();
}

/**
 * Toggle replay mode. While active, live graph/stats/event updates are ignored
 * and the recorder drives state via applyReplayMessage. On exit, live state is
 * re-fetched immediately instead of waiting for the next server broadcast.
 */
export function setReplayMode(active: boolean) {
  if (replayMode === active) {
    return;
  }
  replayMode = active;
  unsubscribeLogs();
  clearTransientState();
  if (!active) {
    fetch('/api/graph')
      .then((r) => r.json())
      .then((data) => {
        if (!replayMode) {
          mergeGraph(data);
        }
      })
      .catch(() => {});
  }
}

/** Reset graph/events to the recording's starting point */
export function resetReplayGraph(initial: GraphData) {
  clearTransientState();
  // Clone so the force graph never mutates the recording's own objects
  mergeGraph(structuredClone(initial));
}

/** Apply a recorded message through the normal handling path */
export function applyReplayMessage(msg: WSMessage) {
  handleMessage(structuredClone(msg), { replay: true });
}

export function getDockerState() {
  return {
    get graph() {
      return graph;
    },
    get replayMode() {
      return replayMode;
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
    get anomalies() {
      return anomalies;
    },
    get diagnostics() {
      return diagnostics;
    },
  };
}
