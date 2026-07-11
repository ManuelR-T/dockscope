import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { GraphData, ServerHandle } from '../../types';

const mockGraph: GraphData = {
  nodes: [
    {
      id: '123456789abc',
      name: 'web',
      fullName: 'dockscope-web-1',
      project: 'dockscope',
      host: 'local',
      containerId: '123456789abcdef',
      image: 'nginx:latest',
      status: 'running',
      health: 'healthy',
      ports: ['8080:80/tcp'],
      networks: ['bridge'],
      volumeCount: 0,
      cpu: 0,
      memory: 0,
      memoryLimit: 0,
      networkRx: 0,
      networkTx: 0,
      networkRxRate: 0,
      networkTxRate: 0,
    },
  ],
  links: [],
};

const mocks = vi.hoisted(() => ({
  buildGraph: vi.fn(),
  checkConnection: vi.fn(),
  composeAction: vi.fn(),
  containerAction: vi.fn(),
  diagnoseCrash: vi.fn(),
  getContainerDiff: vi.fn(),
  getContainerLogs: vi.fn(),
  getContainerStats: vi.fn(),
  getContainerTop: vi.fn(),
  getHost: vi.fn(),
  getSystemInfo: vi.fn(),
  inspectContainer: vi.fn(),
  listComposeProjects: vi.fn(),
  removeContainer: vi.fn(),
  streamContainerLogs: vi.fn(),
  watchEvents: vi.fn(),
  refreshHostStatus: vi.fn(),
  listDockerHosts: vi.fn(),
  listDockerGraphSources: vi.fn(),
  initHosts: vi.fn(),
  stopWatching: vi.fn(),
}));

vi.mock('../../docker/client.js', () => ({
  buildGraph: mocks.buildGraph,
  checkConnection: mocks.checkConnection,
  composeAction: mocks.composeAction,
  containerAction: mocks.containerAction,
  createExecSession: vi.fn(),
  diagnoseCrash: mocks.diagnoseCrash,
  getContainerDiff: mocks.getContainerDiff,
  getContainerLogs: mocks.getContainerLogs,
  getContainerStats: mocks.getContainerStats,
  getContainerTop: mocks.getContainerTop,
  getSystemInfo: mocks.getSystemInfo,
  initDockerClient: vi.fn(),
  inspectContainer: mocks.inspectContainer,
  listComposeProjects: mocks.listComposeProjects,
  removeContainer: mocks.removeContainer,
  streamContainerLogs: mocks.streamContainerLogs,
  watchEvents: mocks.watchEvents,
}));

vi.mock('../../docker/projects.js', () => ({
  composeAction: mocks.composeAction,
  listComposeProjects: mocks.listComposeProjects,
}));

vi.mock('../../docker/hosts.js', () => ({
  addHost: vi.fn(),
  getHost: mocks.getHost,
  initHosts: mocks.initHosts,
  listDockerHosts: mocks.listDockerHosts,
  listDockerGraphSources: mocks.listDockerGraphSources,
  listHosts: vi.fn(() => []),
  refreshHostStatus: mocks.refreshHostStatus,
  removeHost: vi.fn(),
}));

async function startTestServer(): Promise<ServerHandle> {
  const { startServer } = await import('../index');
  return startServer({ port: 0, open: false, disableExternalPlugins: true });
}

function readWsMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (err) {
        reject(err);
      }
    });
    ws.once('error', reject);
  });
}

function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > 1000) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for condition'));
      }
    }, 10);
  });
}

function requiredLogCallback(callback: ((text: string) => void) | null): (text: string) => void {
  if (!callback) {
    throw new Error('Expected callback to be registered');
  }
  return callback;
}

describe('server integration', () => {
  let server: ServerHandle | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkConnection.mockResolvedValue(true);
    mocks.buildGraph.mockResolvedValue(mockGraph);
    mocks.listComposeProjects.mockResolvedValue([{ name: 'demo', running: 1, stopped: 0 }]);
    mocks.composeAction.mockResolvedValue('restart completed for project demo');
    mocks.getContainerLogs.mockResolvedValue('hello\n');
    mocks.getContainerStats.mockResolvedValue({
      id: '123456789abc',
      cpu: 12,
      memory: 256,
      memoryLimit: 512,
      networkRx: 10,
      networkTx: 20,
      networkRxRate: 1,
      networkTxRate: 2,
    });
    mocks.getContainerTop.mockResolvedValue({ titles: ['PID'], processes: [['1']] });
    mocks.getSystemInfo.mockResolvedValue({
      dockerVersion: '27.5.1',
      os: 'Linux (x86_64)',
      totalMemory: 8_000_000_000,
      cpus: 4,
      containersRunning: 1,
      containersStopped: 0,
      images: 2,
    });
    mocks.getContainerDiff.mockResolvedValue([{ kind: 'C', path: '/app/index.js' }]);
    mocks.inspectContainer.mockResolvedValue({
      id: '123456789abc',
      env: [],
      labels: {},
      mounts: [],
      restartPolicy: 'no',
      entrypoint: null,
      cmd: null,
      workingDir: '/',
      created: 'now',
    });
    mocks.diagnoseCrash.mockResolvedValue(null);
    mocks.removeContainer.mockResolvedValue(undefined);
    mocks.refreshHostStatus.mockResolvedValue(undefined);
    const source = {
      id: 'local',
      label: 'local',
      kind: 'docker',
      pluginId: 'core.docker',
      capabilities: ['source.graph'],
      status: 'connected',
    };
    mocks.listDockerGraphSources.mockReturnValue([
      {
        describe: () => source,
        collectGraph: async () => ({ source, graph: mockGraph, collectedAt: 1 }),
        startEvents: mocks.watchEvents,
      },
    ]);
    mocks.listDockerHosts.mockReturnValue([
      {
        name: 'local',
        url: 'local',
        client: {},
        connected: true,
        containers: 1,
        version: 'test',
      },
    ]);
    mocks.getHost.mockImplementation((name) =>
      name === 'local'
        ? {
            name: 'local',
            url: 'local',
            client: {},
            connected: true,
            containers: 1,
            version: 'test',
          }
        : undefined,
    );
    mocks.stopWatching = vi.fn();
    mocks.watchEvents.mockReturnValue(mocks.stopWatching);
  });

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('serves route responses through real HTTP', async () => {
    server = await startTestServer();
    expect(mocks.checkConnection).not.toHaveBeenCalled();

    const graphResponse = await fetch(`http://127.0.0.1:${server.port}/api/graph`);
    expect(graphResponse.status).toBe(200);
    expect(await graphResponse.json()).toEqual(mockGraph);
    expect(mocks.buildGraph).not.toHaveBeenCalled();
    expect(mocks.listDockerGraphSources).toHaveBeenCalled();

    const sourcesResponse = await fetch(`http://127.0.0.1:${server.port}/api/sources`);
    expect(sourcesResponse.status).toBe(200);
    expect(await sourcesResponse.json()).toEqual([
      {
        id: 'local',
        label: 'local',
        kind: 'docker',
        pluginId: 'core.docker',
        capabilities: ['source.graph'],
        status: 'connected',
      },
    ]);

    const systemsResponse = await fetch(`http://127.0.0.1:${server.port}/api/systems`);
    expect(systemsResponse.status).toBe(200);
    expect(await systemsResponse.json()).toEqual([
      expect.objectContaining({
        id: 'local',
        pluginId: 'core.docker',
        runtime: 'docker',
        status: 'connected',
        version: '27.5.1',
      }),
    ]);

    const healthResponse = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toMatchObject({ status: 'ok' });

    const connectionProvidersResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/connections/providers`,
    );
    expect(connectionProvidersResponse.status).toBe(200);
    expect(await connectionProvidersResponse.json()).toEqual([
      expect.objectContaining({ pluginId: 'core.docker', id: 'hosts', label: 'Docker host' }),
    ]);

    const pluginsResponse = await fetch(`http://127.0.0.1:${server.port}/api/plugins`);
    expect(pluginsResponse.status).toBe(200);
    const plugins = await pluginsResponse.json();
    expect(plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          manifest: expect.objectContaining({
            id: 'core.docker',
            name: 'Docker',
            builtin: true,
            capabilities: expect.arrayContaining(['source.graph', 'source.metrics']),
          }),
          status: 'started',
          enabled: true,
        }),
        expect.objectContaining({
          manifest: expect.objectContaining({
            id: 'core.compose',
            capabilities: expect.arrayContaining(['source.inventory', 'action.deploy']),
          }),
          status: 'started',
          enabled: true,
        }),
      ]),
    );

    const pluginErrorsResponse = await fetch(`http://127.0.0.1:${server.port}/api/plugins/errors`);
    expect(pluginErrorsResponse.status).toBe(200);
    expect(await pluginErrorsResponse.json()).toEqual([]);

    const pluginWarningsResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/plugins/warnings`,
    );
    expect(pluginWarningsResponse.status).toBe(200);
    expect(await pluginWarningsResponse.json()).toEqual([]);

    const pluginUiResponse = await fetch(`http://127.0.0.1:${server.port}/api/plugins/ui`);
    expect(pluginUiResponse.status).toBe(200);
    expect(await pluginUiResponse.json()).toEqual([]);

    const pluginConfigResponse = await fetch(`http://127.0.0.1:${server.port}/api/plugins/config`);
    expect(pluginConfigResponse.status).toBe(200);
    expect(await pluginConfigResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pluginId: 'core.docker', values: {} }),
        expect.objectContaining({ pluginId: 'core.compose', values: {} }),
      ]),
    );

    const pluginSecretsResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/plugins/secrets`,
    );
    expect(pluginSecretsResponse.status).toBe(200);
    expect(await pluginSecretsResponse.json()).toEqual([]);

    const projectsResponse = await fetch(`http://127.0.0.1:${server.port}/api/projects`);
    expect(projectsResponse.status).toBe(200);
    expect(await projectsResponse.json()).toEqual([
      {
        name: 'demo',
        running: 1,
        stopped: 0,
        pluginId: 'core.compose',
        providerId: 'compose',
      },
    ]);

    const projectActionResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/projects/demo/restart?pluginId=core.compose&providerId=compose`,
      { method: 'POST' },
    );
    expect(projectActionResponse.status).toBe(200);
    expect(await projectActionResponse.json()).toEqual({
      ok: true,
      message: 'restart completed for project demo',
    });
    expect(mocks.composeAction).toHaveBeenCalledWith('demo', 'restart');

    const statsResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/containers/123456789abc/stats?nodeId=local:123456789abc`,
    );
    expect(statsResponse.status).toBe(200);
    expect(await statsResponse.json()).toEqual({
      id: 'local:123456789abc',
      cpu: 12,
      memory: 256,
      memoryLimit: 512,
      networkRx: 10,
      networkTx: 20,
      networkRxRate: 1,
      networkTxRate: 2,
    });
    expect(mocks.getContainerStats).toHaveBeenCalledWith(
      '123456789abc',
      undefined,
      'local:123456789abc',
    );

    const logsResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/containers/123456789abc/logs?tail=50`,
    );
    expect(logsResponse.status).toBe(200);
    expect(await logsResponse.json()).toEqual({ logs: 'hello\n' });
    expect(mocks.getContainerLogs).toHaveBeenCalledWith('123456789abc', 50, undefined);

    const operationsResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/entities/123456789abcdef/operations?sourceId=local&nodeId=123456789abc`,
    );
    expect(operationsResponse.status).toBe(200);
    expect(await operationsResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'actions', pluginId: 'core.docker' }),
        expect.objectContaining({ id: 'stats', pluginId: 'core.docker' }),
      ]),
    );

    const actionsResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/entities/123456789abcdef/actions?sourceId=local&nodeId=123456789abc`,
    );
    expect(actionsResponse.status).toBe(200);
    expect(await actionsResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'restart',
          pluginId: 'core.docker',
          placement: 'primary',
        }),
      ]),
    );

    const entityActionResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/entities/123456789abcdef/actions/core.docker/restart?sourceId=local&nodeId=123456789abc`,
      { method: 'POST' },
    );
    expect(entityActionResponse.status).toBe(200);
    expect(await entityActionResponse.json()).toEqual({
      ok: true,
      message: 'Container restart completed',
    });

    const invalidIdResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/containers/not-a-container/logs`,
    );
    expect(invalidIdResponse.status).toBe(400);
    expect(await invalidIdResponse.json()).toEqual({ error: 'Invalid container ID format' });
  });

  it('returns container action failures as HTTP 500 errors', async () => {
    mocks.containerAction.mockRejectedValueOnce(new Error('Docker refused stop'));
    server = await startTestServer();

    const response = await fetch(
      `http://127.0.0.1:${server.port}/api/containers/123456789abc/stop`,
      { method: 'POST' },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Docker refused stop' });
  });

  it('sends initial graph data and streams subscribed logs over WebSocket', async () => {
    let pushLog: ((text: string) => void) | null = null;
    const stopLogs = vi.fn();
    mocks.streamContainerLogs.mockImplementation((_id, onData) => {
      pushLog = onData;
      return stopLogs;
    });

    server = await startTestServer();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);

    const initial = await readWsMessage(ws);
    expect(initial).toEqual({ type: 'graph', data: mockGraph });

    ws.send('{malformed json');
    ws.send(JSON.stringify({ type: 'subscribe_logs', data: {} }));
    ws.send(JSON.stringify({ type: 'exec_input', data: { text: 42 } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.streamContainerLogs).not.toHaveBeenCalled();

    ws.send(JSON.stringify({ type: 'subscribe_logs', data: { entityId: '123456789abc' } }));

    await waitFor(() => pushLog !== null);
    expect(mocks.streamContainerLogs).toHaveBeenCalledWith(
      '123456789abc',
      expect.any(Function),
      expect.any(Function),
      undefined,
    );

    requiredLogCallback(pushLog)('hello from container\n');
    expect(await readWsMessage(ws)).toEqual({
      type: 'log_chunk',
      data: {
        entityId: '123456789abc',
        containerId: '123456789abc',
        text: 'hello from container\n',
      },
    });

    ws.close();
    await waitFor(() => stopLogs.mock.calls.length === 1);
  });
});
