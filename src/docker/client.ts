import Dockerode from 'dockerode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  ServiceNode,
  GraphData,
  ContainerStats,
  ContainerInspect,
  ContainerDiffEntry,
  ContainerTopResult,
  SystemInfo,
  DockerEvent,
  CrashDiagnostic,
} from '../types.js';
import { getContainerStats as _getStats } from './metrics.js';
import { getContainerLogs as _getLogs, streamContainerLogs as _streamLogs } from './logs.js';
import {
  extractDependsOnFromLabels,
  extractDependsOnFromFile,
  extractNetworkLinks,
} from './links.js';
import { analyzeCrash as _analyzeCrash } from './diagnostics.js';

const docker = new Dockerode();

export async function checkConnection(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

export async function buildGraph(composeFile?: string): Promise<GraphData> {
  const containers = await docker.listContainers({ all: true });
  const nodes: ServiceNode[] = [];
  const networkMap = new Map<string, string[]>();
  const containerProject = new Map<string, string>();

  for (const container of containers) {
    const composeService = container.Labels['com.docker.compose.service'];
    const project = container.Labels['com.docker.compose.project'] || '';
    const rawName =
      composeService || container.Names[0]?.replace(/^\//, '') || container.Id.substring(0, 12);

    const hasDuplicate = containers.some(
      (c) =>
        c.Id !== container.Id &&
        (c.Labels['com.docker.compose.service'] || c.Names[0]?.replace(/^\//, '')) === rawName &&
        (c.Labels['com.docker.compose.project'] || '') !== project,
    );
    const serviceName = hasDuplicate && project ? `${project}/${rawName}` : rawName;
    const shortId = container.Id.substring(0, 12);
    containerProject.set(shortId, project);

    const healthStatus = container.Status?.toLowerCase() || '';
    let health: ServiceNode['health'] = 'none';
    if (healthStatus.includes('healthy') && !healthStatus.includes('unhealthy')) health = 'healthy';
    else if (healthStatus.includes('unhealthy')) health = 'unhealthy';
    else if (healthStatus.includes('starting') || healthStatus.includes('health:'))
      health = 'starting';

    nodes.push({
      id: shortId,
      name: serviceName,
      fullName: container.Names[0]?.replace(/^\//, '') || serviceName,
      project,
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
      if (!networkMap.has(net)) networkMap.set(net, []);
      networkMap.get(net)!.push(shortId);
    }
  }

  // Build links from all sources
  const { links: labelLinks, seen } = extractDependsOnFromLabels(
    containers,
    nodes,
    containerProject,
  );
  const fileLinks = await extractDependsOnFromFile(composeFile, nodes, containerProject, seen);
  const netLinks = extractNetworkLinks(networkMap);

  return { nodes, links: [...labelLinks, ...fileLinks, ...netLinks] };
}

// --- Delegate to extracted modules ---
export const getContainerStats = (id: string): Promise<ContainerStats> => _getStats(docker, id);
export const getContainerLogs = (id: string, tail?: number): Promise<string> =>
  _getLogs(docker, id, tail);
export const streamContainerLogs = (
  id: string,
  onData: (t: string) => void,
  onError?: (e: Error) => void,
) => _streamLogs(docker, id, onData, onError);
export const diagnoseCrash = (id: string): Promise<CrashDiagnostic | null> =>
  _analyzeCrash(docker, id);

const execFileAsync = promisify(execFile);

// --- Project metadata cache (survives docker compose down) ---
interface ProjectMeta {
  workDir: string;
  configFiles: string;
}
const projectCache = new Map<string, ProjectMeta>();

/** Cache project metadata from container labels */
function cacheProjectMeta(containers: any[]): void {
  for (const c of containers) {
    const project = c.Labels['com.docker.compose.project'];
    const workDir = c.Labels['com.docker.compose.project.working_dir'];
    const configFiles = c.Labels['com.docker.compose.project.config_files'];
    if (project && workDir && configFiles && !projectCache.has(project)) {
      projectCache.set(project, { workDir, configFiles });
    }
  }
}

/** List all compose projects (live + cached) with their container counts */
export async function listComposeProjects(): Promise<
  { name: string; running: number; stopped: number }[]
> {
  const containers = await docker.listContainers({ all: true });
  cacheProjectMeta(containers);

  const projects = new Map<string, { running: number; stopped: number }>();

  // Live containers
  for (const c of containers) {
    const project = c.Labels['com.docker.compose.project'];
    if (!project) continue;
    if (!projects.has(project)) projects.set(project, { running: 0, stopped: 0 });
    const p = projects.get(project)!;
    if (c.State === 'running') p.running++;
    else p.stopped++;
  }

  // Cached projects with no live containers (after down)
  for (const [name] of projectCache) {
    if (!projects.has(name)) {
      projects.set(name, { running: 0, stopped: 0 });
    }
  }

  return [...projects.entries()]
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Get containers for a compose project */
async function getProjectContainers(project: string) {
  return docker.listContainers({
    all: true,
    filters: { label: [`com.docker.compose.project=${project}`] },
  });
}

/** Build the docker compose command from container labels or cache */
function getComposeCommand(
  project: string,
  containers: any[],
): { args: string[]; cwd: string } | null {
  // Try live container labels first
  let workDir = containers[0]?.Labels['com.docker.compose.project.working_dir'];
  let configFiles = containers[0]?.Labels['com.docker.compose.project.config_files'];

  // Fall back to cache (for projects that were downed)
  if (!workDir || !configFiles) {
    const cached = projectCache.get(project);
    if (cached) {
      workDir = cached.workDir;
      configFiles = cached.configFiles;
    }
  }

  if (!workDir || !configFiles) return null;
  const args = configFiles.split(',').flatMap((f: string) => ['-f', f.trim()]);
  return { args, cwd: workDir };
}

/** Run a docker compose action on a specific project */
export async function composeAction(
  project: string,
  action: 'up' | 'down' | 'destroy' | 'stop' | 'start' | 'restart',
): Promise<string> {
  const containers = await getProjectContainers(project);

  if (action === 'up' || action === 'down' || action === 'destroy') {
    const compose = getComposeCommand(project, containers);
    if (compose) {
      const subArgs =
        action === 'up'
          ? ['up', '-d']
          : action === 'destroy'
            ? ['down', '-v', '--remove-orphans']
            : ['down'];
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['compose', ...compose.args, ...subArgs],
        { cwd: compose.cwd },
      );
      if (action === 'destroy') projectCache.delete(project);
      return stdout || stderr || `${action} completed`;
    }
    if (action === 'up') {
      for (const c of containers) {
        if (c.State !== 'running') await docker.getContainer(c.Id).start();
      }
      return `Started containers in project ${project}`;
    }
    return 'Could not find compose config';
  }

  // stop / start / restart — act on individual containers
  for (const c of containers) {
    const container = docker.getContainer(c.Id);
    if (action === 'stop' && c.State === 'running') await container.stop();
    else if (action === 'start' && c.State !== 'running') await container.start();
    else if (action === 'restart' && c.State === 'running') await container.restart();
  }
  return `${action} completed for project ${project}`;
}

export async function containerAction(
  containerId: string,
  action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill',
): Promise<void> {
  const container = docker.getContainer(containerId);
  await (container[action] as () => Promise<void>)();
}

export async function removeContainer(
  containerId: string,
  removeVolumes: boolean = false,
): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.remove({ force: true, v: removeVolumes });
}

export async function getContainerTop(containerId: string): Promise<ContainerTopResult> {
  const container = docker.getContainer(containerId);
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
  const container = docker.getContainer(containerId);
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
  const container = docker.getContainer(containerId);
  const diff = await Promise.race([
    container.changes(),
    new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Diff timed out')), 10000)),
  ]);
  if (!diff) return [];
  return diff.map((d: any) => ({
    kind: DIFF_KIND_MAP[d.Kind] || 'C',
    path: d.Path,
  }));
}

export async function inspectContainer(containerId: string): Promise<ContainerInspect> {
  const container = docker.getContainer(containerId);
  const info = await container.inspect();
  return {
    id: info.Id.substring(0, 12),
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
  const info = await docker.info();
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

export function watchEvents(
  callback: (event: DockerEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  let destroyed = false;
  let stream: NodeJS.ReadableStream | null = null;

  docker.getEvents({}, (err, eventStream) => {
    if (err || !eventStream) {
      onError?.(err || new Error('Failed to get event stream'));
      return;
    }
    if (destroyed) {
      (eventStream as any).destroy?.();
      return;
    }
    stream = eventStream;
    eventStream.on('data', (chunk: Buffer) => {
      try {
        const raw = JSON.parse(chunk.toString());
        callback({
          id: (raw.Actor?.ID || raw.id || '').substring(0, 12),
          type: raw.Type || 'unknown',
          action: raw.Action || raw.status || 'unknown',
          actor:
            raw.Actor?.Attributes?.name ||
            raw.Actor?.Attributes?.['com.docker.compose.service'] ||
            raw.Actor?.ID?.substring(0, 12) ||
            'unknown',
          time: raw.time || Math.floor(Date.now() / 1000),
          message: `${raw.Type || ''} ${raw.Action || ''}: ${raw.Actor?.Attributes?.name || raw.Actor?.ID?.substring(0, 12) || ''}`,
        });
      } catch {
        /* ignore */
      }
    });
    eventStream.on('error', (e: Error) => onError?.(e));
  });

  return () => {
    destroyed = true;
    (stream as any)?.destroy?.();
  };
}
