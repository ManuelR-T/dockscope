import type { DockscopePlugin } from '../core/plugins.js';
import type {
  EntityDiagnosticProvider,
  EntityExecProvider,
  EntityFilesystemProvider,
  EntityInspectProvider,
  EntityLogStreamProvider,
  EntityLifecycleProvider,
  EntityLogsProvider,
  EntityRef,
  EntityStatsProvider,
} from '../core/operations.js';
import { DOCKER_SOURCE_CAPABILITIES } from './capabilities.js';
import {
  containerAction,
  createExecSession,
  diagnoseCrash,
  getContainerDiff,
  getContainerLogs,
  getContainerStats,
  getContainerTop,
  inspectContainer,
  removeContainer,
  streamContainerLogs,
} from './client.js';
import { getHost, listDockerGraphSources } from './hosts.js';

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
