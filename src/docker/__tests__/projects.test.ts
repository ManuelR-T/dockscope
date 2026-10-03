import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFile, listContainers } = vi.hoisted(() => ({
  execFile: vi.fn((_file, _args, _options, callback) =>
    callback(null, { stdout: 'done', stderr: '' }),
  ),
  listContainers: vi.fn(),
}));
vi.mock('child_process', () => ({ execFile }));
vi.mock('../connection', () => ({ getDefaultDockerClient: () => ({ listContainers }) }));

const project = 'custom-preview-name';
const containers = [
  {
    Id: 'fixture-container',
    State: 'running',
    Labels: {
      'com.docker.compose.project': project,
      'com.docker.compose.project.working_dir': '/tmp',
      'com.docker.compose.project.config_files': '/tmp/preview.compose.yml',
    },
  },
];

beforeEach(() => {
  vi.resetModules();
  execFile.mockClear();
  listContainers.mockResolvedValue(containers);
});

describe('Compose project identity', () => {
  it.each(['up', 'down', 'destroy'] as const)(
    '%s uses the selected project name rather than the working directory',
    async (action) => {
      const { composeAction } = await import('../projects');
      await composeAction(project, action);
      expect(execFile).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining(['--project-name', project]),
        { cwd: '/tmp' },
        expect.any(Function),
      );
    },
  );

  it('retains the selected project name when destroying a cached project after down', async () => {
    const { listComposeProjects, composeAction } = await import('../projects');
    await listComposeProjects();
    listContainers.mockResolvedValue([]);
    await composeAction(project, 'destroy');
    expect(execFile).toHaveBeenCalledWith(
      'docker',
      [
        'compose',
        '--project-name',
        project,
        '-f',
        '/tmp/preview.compose.yml',
        'down',
        '-v',
        '--remove-orphans',
      ],
      { cwd: '/tmp' },
      expect.any(Function),
    );
    expect(await listComposeProjects()).toEqual([]);
  });
});
