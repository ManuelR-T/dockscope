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

export const getContainerStats = (id: string): Promise<ContainerStats> =>
  _getStats(getDefaultDockerClient(), id);

export const getContainerLogs = (id: string, tail?: number): Promise<string> =>
  _getLogs(getDefaultDockerClient(), id, tail);

export const streamContainerLogs = (
  id: string,
  onData: (t: string) => void,
  onError?: (e: Error) => void,
) => _streamLogs(getDefaultDockerClient(), id, onData, onError);

export const diagnoseCrash = (id: string): Promise<CrashDiagnostic | null> =>
  _analyzeCrash(getDefaultDockerClient(), id);

export async function containerAction(
  containerId: string,
  action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill',
): Promise<void> {
  const container = getDefaultDockerClient().getContainer(containerId);
  await (container[action] as () => Promise<void>)();
}

export async function removeContainer(
  containerId: string,
  removeVolumes: boolean = false,
): Promise<void> {
  const container = getDefaultDockerClient().getContainer(containerId);
  await container.remove({ force: true, v: removeVolumes });
}

export async function getContainerTop(containerId: string): Promise<ContainerTopResult> {
  const container = getDefaultDockerClient().getContainer(containerId);
  const top = await container.top();
  return { titles: top.Titles || [], processes: top.Processes || [] };
}

/** Create an interactive exec session, returns a bidirectional stream */
export async function createExecSession(
  containerId: string,
  cmd: string[] = ['/bin/sh'],
): Promise<{
  stream: NodeJS.ReadWriteStream;
  inspect: () => Promise<{ Running: boolean; ExitCode: number }>;
}> {
  const container = getDefaultDockerClient().getContainer(containerId);
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
      exec.inspect().then((info: any) => ({ Running: info.Running, ExitCode: info.ExitCode })),
  };
}

const DIFF_KIND_MAP: Record<number, 'A' | 'C' | 'D'> = { 0: 'C', 1: 'A', 2: 'D' };

export async function getContainerDiff(containerId: string): Promise<ContainerDiffEntry[]> {
  const container = getDefaultDockerClient().getContainer(containerId);
  const diff = await Promise.race([
    container.changes(),
    new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Diff timed out')), 10000)),
  ]);
  if (!diff) {
    return [];
  }
  return diff.map((d: any) => ({
    kind: DIFF_KIND_MAP[d.Kind] || 'C',
    path: d.Path,
  }));
}

export async function inspectContainer(containerId: string): Promise<ContainerInspect> {
  const container = getDefaultDockerClient().getContainer(containerId);
  const info = await container.inspect();
  return {
    id: shortId(info.Id),
    env: info.Config.Env || [],
    labels: info.Config.Labels || {},
    mounts: (info.Mounts || []).map((m: any) => ({
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

export async function getSystemInfo(): Promise<SystemInfo> {
  const info = await getDefaultDockerClient().info();
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
