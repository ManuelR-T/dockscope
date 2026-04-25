import { execFile } from 'child_process';
import { promisify } from 'util';
import { getDefaultDockerClient } from './connection.js';

const execFileAsync = promisify(execFile);

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
  const docker = getDefaultDockerClient();
  const containers = await docker.listContainers({ all: true });
  cacheProjectMeta(containers);

  const projects = new Map<string, { running: number; stopped: number }>();

  for (const c of containers) {
    const project = c.Labels['com.docker.compose.project'];
    if (!project) {
      continue;
    }
    if (!projects.has(project)) {
      projects.set(project, { running: 0, stopped: 0 });
    }
    const p = projects.get(project)!;
    if (c.State === 'running') {
      p.running++;
    } else {
      p.stopped++;
    }
  }

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
  return getDefaultDockerClient().listContainers({
    all: true,
    filters: { label: [`com.docker.compose.project=${project}`] },
  });
}

/** Build the docker compose command from container labels or cache */
function getComposeCommand(
  project: string,
  containers: any[],
): { args: string[]; cwd: string } | null {
  let workDir = containers[0]?.Labels['com.docker.compose.project.working_dir'];
  let configFiles = containers[0]?.Labels['com.docker.compose.project.config_files'];

  if (!workDir || !configFiles) {
    const cached = projectCache.get(project);
    if (cached) {
      workDir = cached.workDir;
      configFiles = cached.configFiles;
    }
  }

  if (!workDir || !configFiles) {
    return null;
  }
  const args = configFiles.split(',').flatMap((f: string) => ['-f', f.trim()]);
  return { args, cwd: workDir };
}

/** Run a docker compose action on a specific project */
export async function composeAction(
  project: string,
  action: 'up' | 'down' | 'destroy' | 'stop' | 'start' | 'restart',
): Promise<string> {
  const docker = getDefaultDockerClient();
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
      if (action === 'destroy') {
        projectCache.delete(project);
      }
      return stdout || stderr || `${action} completed`;
    }
    if (action === 'up') {
      for (const c of containers) {
        if (c.State !== 'running') {
          await docker.getContainer(c.Id).start();
        }
      }
      return `Started containers in project ${project}`;
    }
    return 'Could not find compose config';
  }

  for (const c of containers) {
    const container = docker.getContainer(c.Id);
    if (action === 'stop' && c.State === 'running') {
      await container.stop();
    } else if (action === 'start' && c.State !== 'running') {
      await container.start();
    } else if (action === 'restart' && c.State === 'running') {
      await container.restart();
    }
  }
  return `${action} completed for project ${project}`;
}
