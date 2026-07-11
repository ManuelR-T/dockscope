import { shortId } from '../utils.js';
import type {
  ContainerDiffEntry,
  ContainerInspect,
  ContainerStats,
  ContainerTopResult,
  CrashDiagnostic,
  SystemInfo,
} from '../types.js';
import { analyzeCrash as _analyzeCrash } from './diagnostics.js';
import { getContainerLogs as _getLogs, streamContainerLogs as _streamLogs } from './logs.js';
import { getContainerStats as _getStats } from './metrics.js';
import { getDefaultDockerClient } from './connection.js';
import type Dockerode from 'dockerode';

interface DockerDiffEntry {
  Kind?: number;
  Path?: string;
}

function dockerClient(client?: Dockerode): Dockerode {
  return client || getDefaultDockerClient();
}

function isDockerDiffEntry(value: unknown): value is DockerDiffEntry {
  return typeof value === 'object' && value !== null;
}

export const getContainerStats = (
  id: string,
  client?: Dockerode,
  rateKey?: string,
): Promise<ContainerStats> => _getStats(dockerClient(client), id, rateKey);

export const getContainerLogs = (id: string, tail?: number, client?: Dockerode): Promise<string> =>
  _getLogs(dockerClient(client), id, tail);

export const streamContainerLogs = (
  id: string,
  onData: (t: string) => void,
  onError?: (e: Error) => void,
  client?: Dockerode,
) => _streamLogs(dockerClient(client), id, onData, onError);

export const diagnoseCrash = (id: string, client?: Dockerode): Promise<CrashDiagnostic | null> =>
  _analyzeCrash(dockerClient(client), id);

export async function containerAction(
  containerId: string,
  action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill',
  client?: Dockerode,
): Promise<void> {
  const container = dockerClient(client).getContainer(containerId);
  await (container[action] as () => Promise<void>)();
}

export async function removeContainer(
  containerId: string,
  removeVolumes: boolean = false,
  client?: Dockerode,
): Promise<void> {
  const container = dockerClient(client).getContainer(containerId);
  await container.remove({ force: true, v: removeVolumes });
}

export async function getContainerTop(
  containerId: string,
  client?: Dockerode,
): Promise<ContainerTopResult> {
  const container = dockerClient(client).getContainer(containerId);
  const top = await container.top();
  return { titles: top.Titles || [], processes: top.Processes || [] };
}

/** Create an interactive exec session, returns a bidirectional stream */
export async function createExecSession(
  containerId: string,
  cmd: string[] = ['/bin/sh'],
  client?: Dockerode,
): Promise<{
  stream: NodeJS.ReadWriteStream;
  inspect: () => Promise<{ Running: boolean; ExitCode: number }>;
}> {
  const container = dockerClient(client).getContainer(containerId);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
  });
  const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
  return {
    stream,
    inspect: () =>
      exec.inspect().then((info) => ({ Running: info.Running, ExitCode: info.ExitCode ?? 0 })),
  };
}

const DIFF_KIND_MAP: Record<number, 'A' | 'C' | 'D'> = { 0: 'C', 1: 'A', 2: 'D' };

export async function getContainerDiff(
  containerId: string,
  client?: Dockerode,
): Promise<ContainerDiffEntry[]> {
  const container = dockerClient(client).getContainer(containerId);
  const diff = await Promise.race([
    container.changes(),
    new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Diff timed out')), 10000)),
  ]);
  if (!diff) {
    return [];
  }
  return (Array.isArray(diff) ? diff.filter(isDockerDiffEntry) : []).map((d) => {
    const kind = d.Kind === undefined ? 'C' : DIFF_KIND_MAP[d.Kind] || 'C';
    return {
      kind,
      path: d.Path || '',
    };
  });
}

export async function inspectContainer(
  containerId: string,
  client?: Dockerode,
): Promise<ContainerInspect> {
  const container = dockerClient(client).getContainer(containerId);
  const info = await container.inspect();
  return {
    id: shortId(info.Id),
    env: info.Config.Env || [],
    labels: info.Config.Labels || {},
    mounts: (info.Mounts || []).map((m) => ({
      type: m.Type || 'bind',
      source: m.Source || '',
      destination: m.Destination || '',
      mode: m.Mode || 'rw',
    })),
    restartPolicy: info.HostConfig.RestartPolicy?.Name || 'no',
    entrypoint: (info.Config.Entrypoint as string[] | null) || null,
    cmd: (info.Config.Cmd as string[] | null) || null,
    workingDir: info.Config.WorkingDir || '/',
    created: info.Created,
  };
}

export async function getSystemInfo(client?: Dockerode): Promise<SystemInfo> {
  const info = await dockerClient(client).info();
  return {
    dockerVersion: info.ServerVersion || 'unknown',
    os: `${info.OperatingSystem || 'unknown'} (${info.Architecture || ''})`,
    totalMemory: info.MemTotal || 0,
    cpus: info.NCPU || 0,
    containersRunning: info.ContainersRunning || 0,
    containersStopped: info.ContainersStopped || 0,
    images: info.Images || 0,
  };
}
