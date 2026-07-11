import type { DockscopePlugin } from '../core/plugins.js';
import type {
  EntityActionProvider,
  EntityDiagnosticProvider,
  EntityExecProvider,
  EntityFilesystemProvider,
  EntityInspectProvider,
  EntityLogStreamProvider,
  EntityLifecycleProvider,
  EntityLogsProvider,
  EntityRef,
  EntityStatsProvider,
  LifecycleAction,
} from '../core/operations.js';
import type { EntityActionDeclaration } from '../core/entity-actions.js';
import type { PluginSystemProvider } from '../core/plugin-system.js';
import {
  PluginConnectionError,
  type PluginConnectionProvider,
} from '../core/plugin-connections.js';
import { DOCKER_SOURCE_CAPABILITIES } from './capabilities.js';
import {
  containerAction,
  createExecSession,
  diagnoseCrash,
  getContainerDiff,
  getContainerLogs,
  getContainerStats,
  getContainerTop,
  getSystemInfo,
  inspectContainer,
  removeContainer,
  streamContainerLogs,
} from './client.js';
import {
  addHost,
  getHost,
  listDockerGraphSources,
  listDockerHosts,
  listHosts,
  refreshHostStatus,
  removeHost,
} from './hosts.js';

function canHandleDockerEntity(ref: EntityRef): boolean {
  return !ref.sourceId || Boolean(getHost(ref.sourceId));
}

function dockerClientForRef(ref: EntityRef) {
  return ref.sourceId ? getHost(ref.sourceId)?.client : undefined;
}

const dockerStatsProvider: EntityStatsProvider = {
  canHandle: canHandleDockerEntity,
  getStats: (ref) => getContainerStats(ref.entityId, dockerClientForRef(ref), ref.nodeId),
};

const dockerSystemProvider: PluginSystemProvider = {
  async listSystems() {
    return Promise.all(
      listDockerHosts().map(async (host) => {
        try {
          const info = await getSystemInfo(host.client);
          return {
            id: host.name,
            label: host.name,
            runtime: 'docker',
            status: 'connected' as const,
            version: info.dockerVersion,
            os: info.os,
            cpuCount: info.cpus,
            memoryBytes: info.totalMemory,
            workloadsRunning: info.containersRunning,
            workloadsStopped: info.containersStopped,
            artifacts: info.images,
            metadata: { endpoint: host.url },
          };
        } catch {
          return {
            id: host.name,
            label: host.name,
            runtime: 'docker',
            status: 'disconnected' as const,
            ...(host.version ? { version: host.version } : {}),
            metadata: { endpoint: host.url },
          };
        }
      }),
    );
  },
};

const dockerConnectionProvider: PluginConnectionProvider = {
  describe: () => ({
    id: 'hosts',
    label: 'Docker host',
    description: 'Connect a local or remote Docker daemon.',
    input: {
      fields: [
        { key: 'name', label: 'Name', type: 'string', required: true },
        { key: 'url', label: 'Docker URL', type: 'string', required: true },
      ],
    },
  }),
  listConnections: () =>
    listHosts().map((host) => ({
      id: host.name,
      label: host.name,
      endpoint: host.url,
      status: host.connected ? ('connected' as const) : ('disconnected' as const),
      removable: host.name !== 'local',
      metadata: { containers: host.containers, version: host.version },
    })),
  async addConnection(input) {
    const name = input.name;
    const url = input.url;
    if (typeof name !== 'string' || typeof url !== 'string') {
      throw new PluginConnectionError('Docker connections require name and url strings');
    }
    const result = await addHost(name, url);
    if (!result.ok) {
      throw new PluginConnectionError(result.error ?? 'Docker connection failed');
    }
  },
  async removeConnection(connectionId) {
    if (!removeHost(connectionId)) {
      throw new PluginConnectionError(`Cannot remove Docker host "${connectionId}"`);
    }
  },
  refreshConnections: refreshHostStatus,
};

const DOCKER_LIFECYCLE_ACTIONS = new Set<LifecycleAction>([
  'start',
  'stop',
  'restart',
  'pause',
  'unpause',
  'kill',
]);

function dockerActions(ref: EntityRef): EntityActionDeclaration[] {
  const name = ref.context?.name ?? ref.entityId;
  const status = ref.context?.status;
  const actions: EntityActionDeclaration[] = [];
  if (status === 'running') {
    actions.push(
      {
        id: 'pause',
        title: 'Pause',
        capability: 'action.lifecycle',
        icon: 'pause',
        placement: 'primary',
        tone: 'warning',
      },
      {
        id: 'restart',
        title: 'Restart',
        capability: 'action.lifecycle',
        icon: 'restart',
        placement: 'primary',
      },
      {
        id: 'stop',
        title: 'Stop',
        capability: 'action.lifecycle',
        icon: 'stop',
        placement: 'primary',
        tone: 'danger',
        confirm: {
          title: 'Stop Container',
          message: `Stop ${name}? The container will be gracefully terminated.`,
          confirmLabel: 'Stop',
          variant: 'warning',
        },
      },
    );
  } else if (status === 'paused') {
    actions.push(
      {
        id: 'unpause',
        title: 'Unpause',
        capability: 'action.lifecycle',
        icon: 'play',
        placement: 'primary',
        tone: 'success',
      },
      {
        id: 'restart',
        title: 'Restart',
        capability: 'action.lifecycle',
        icon: 'restart',
        placement: 'primary',
      },
    );
  } else {
    actions.push({
      id: 'start',
      title: 'Start',
      capability: 'action.lifecycle',
      icon: 'play',
      placement: 'primary',
      tone: 'success',
    });
  }
  if (status === 'running' || status === 'paused') {
    actions.push({
      id: 'kill',
      title: 'Kill',
      capability: 'action.lifecycle',
      icon: 'stop',
      tone: 'danger',
      confirm: {
        title: 'Kill Container',
        message: `Forcefully terminate ${name}? This does not allow graceful shutdown.`,
        confirmLabel: 'Kill',
        variant: 'warning',
      },
    });
  }
  actions.push(
    {
      id: 'remove',
      title: 'Remove',
      capability: 'action.lifecycle',
      icon: 'trash',
      tone: 'danger',
      effect: 'remove',
      confirm: {
        title: 'Remove Container',
        message: `Permanently remove ${name}? This deletes the container.`,
        confirmLabel: 'Remove',
        variant: 'danger',
        typeToConfirm: name,
      },
    },
    {
      id: 'remove-volumes',
      title: 'Remove + Volumes',
      capability: 'action.lifecycle',
      icon: 'trash',
      tone: 'danger',
      effect: 'remove',
      confirm: {
        title: 'Remove with Volumes',
        message: `Remove ${name} and all its volumes? This is irreversible.`,
        confirmLabel: 'Remove + Volumes',
        variant: 'danger',
        typeToConfirm: name,
      },
    },
  );
  return actions;
}

const dockerActionProvider: EntityActionProvider = {
  canHandle: canHandleDockerEntity,
  listActions: dockerActions,
  async runAction(ref, actionId) {
    const client = dockerClientForRef(ref);
    if (actionId === 'remove' || actionId === 'remove-volumes') {
      await removeContainer(ref.entityId, actionId === 'remove-volumes', client);
      return { ok: true, message: 'Container removed' };
    }
    if (!DOCKER_LIFECYCLE_ACTIONS.has(actionId as LifecycleAction)) {
      return { ok: false, message: `Unsupported Docker action: ${actionId}` };
    }
    await containerAction(ref.entityId, actionId as LifecycleAction, client);
    return { ok: true, message: `Container ${actionId} completed` };
  },
};

const dockerLogsProvider: EntityLogsProvider = {
  canHandle: canHandleDockerEntity,
  getLogs: (ref, options) => getContainerLogs(ref.entityId, options?.tail, dockerClientForRef(ref)),
};

const dockerLogStreamProvider: EntityLogStreamProvider = {
  canHandle: canHandleDockerEntity,
  streamLogs: (ref, onData, onError) =>
    streamContainerLogs(ref.entityId, onData, onError, dockerClientForRef(ref)),
};

const dockerLifecycleProvider: EntityLifecycleProvider = {
  canHandle: canHandleDockerEntity,
  runLifecycleAction: (ref, action) =>
    containerAction(ref.entityId, action, dockerClientForRef(ref)),
  removeEntity: (ref, options) =>
    removeContainer(ref.entityId, options?.volumes ?? false, dockerClientForRef(ref)),
};

const dockerInspectProvider: EntityInspectProvider = {
  canHandle: canHandleDockerEntity,
  inspect: (ref) => inspectContainer(ref.entityId, dockerClientForRef(ref)),
};

const dockerFilesystemProvider: EntityFilesystemProvider = {
  canHandle: canHandleDockerEntity,
  getTop: (ref) => getContainerTop(ref.entityId, dockerClientForRef(ref)),
  getDiff: (ref) => getContainerDiff(ref.entityId, dockerClientForRef(ref)),
};

const dockerDiagnosticProvider: EntityDiagnosticProvider = {
  canHandle: canHandleDockerEntity,
  diagnose: (ref) => diagnoseCrash(ref.entityId, dockerClientForRef(ref)),
};

const dockerExecProvider: EntityExecProvider = {
  canHandle: canHandleDockerEntity,
  createExecSession: (ref, command) =>
    createExecSession(ref.entityId, command || ['/bin/sh'], dockerClientForRef(ref)),
};

export function createDockerPlugin(): DockscopePlugin {
  return {
    manifest: {
      id: 'core.docker',
      name: 'Docker',
      version: '1.0.0',
      manifestVersion: '1',
      dockscopeApiVersion: '1',
      hostApiVersion: '1',
      description: 'Built-in Docker source, metrics, logs, actions, and diagnostics provider.',
      builtin: true,
      capabilities: DOCKER_SOURCE_CAPABILITIES,
      permissions: ['docker.socket', 'network.local', 'filesystem.read', 'process.exec'],
    },
    getGraphSources: listDockerGraphSources,
    getSystemProviders: () => [dockerSystemProvider],
    getConnectionProviders: () => [dockerConnectionProvider],
    getActionProviders: () => [dockerActionProvider],
    getStatsProviders: () => [dockerStatsProvider],
    getLogsProviders: () => [dockerLogsProvider],
    getLogStreamProviders: () => [dockerLogStreamProvider],
    getLifecycleProviders: () => [dockerLifecycleProvider],
    getInspectProviders: () => [dockerInspectProvider],
    getFilesystemProviders: () => [dockerFilesystemProvider],
    getDiagnosticProviders: () => [dockerDiagnosticProvider],
    getExecProviders: () => [dockerExecProvider],
  };
}
