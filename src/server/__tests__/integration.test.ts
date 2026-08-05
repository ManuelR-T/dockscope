import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * Auth state is read from the environment at startup, so every test in this
 * file gets a throwaway file. Without this the suite reads whatever the
 * developer has configured in `~/.dockscope/auth.json` and fails on their
 * machine while passing in CI. Individual describes override these afterwards.
 */
let sharedAuthDir = '';

beforeAll(async () => {
  sharedAuthDir = await mkdtemp(path.join(tmpdir(), 'dockscope-it-shared-'));
});

afterAll(async () => {
  await rm(sharedAuthDir, { recursive: true, force: true });
});

beforeEach(() => {
  delete process.env.DOCKSCOPE_TOKEN;
  delete process.env.DOCKSCOPE_AUTH_PROXY_HEADER;
  delete process.env.DOCKSCOPE_TRUSTED_PROXIES;
  process.env.DOCKSCOPE_AUTH_FILE = path.join(sharedAuthDir, `${randomUUID()}.json`);
});

afterEach(() => {
  delete process.env.DOCKSCOPE_TOKEN;
  delete process.env.DOCKSCOPE_AUTH_PROXY_HEADER;
  delete process.env.DOCKSCOPE_TRUSTED_PROXIES;
  delete process.env.DOCKSCOPE_AUTH_FILE;
});

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

  it('rejects a WebSocket handshake from a forged cross-origin Origin', async () => {
    server = await startTestServer();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      origin: 'https://evil.example',
    });

    const outcome = await new Promise<'open' | 'rejected'>((resolve) => {
      ws.once('open', () => resolve('open'));
      ws.once('error', () => resolve('rejected'));
      ws.once('unexpected-response', () => resolve('rejected'));
    });

    expect(outcome).toBe('rejected');
    ws.close();
  });

  it('accepts a same-origin WebSocket handshake', async () => {
    server = await startTestServer();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      origin: `http://127.0.0.1:${server.port}`,
    });

    const initial = await readWsMessage(ws);
    expect(initial).toEqual({ type: 'graph', data: mockGraph });
    ws.close();
  });
});

/**
 * The origin checks above stop a web page driving the API; they do nothing
 * about anything that can open a socket. These cover the token gate end to end,
 * because the pure functions cannot show middleware ordering or that the
 * WebSocket upgrade is actually refused.
 */
describe('access token', () => {
  const TOKEN = 'integration-test-token';
  let server: ServerHandle | null = null;
  let authDir = '';

  beforeAll(async () => {
    authDir = await mkdtemp(path.join(tmpdir(), 'dockscope-it-auth-'));
  });

  afterAll(async () => {
    await rm(authDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkConnection.mockResolvedValue(true);
    mocks.buildGraph.mockResolvedValue(mockGraph);
    // The graph has to reach the handler for real, so an authorised request can
    // be distinguished from one that merely got past the middleware.
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
    mocks.listDockerHosts.mockReturnValue([]);
    mocks.watchEvents.mockReturnValue(vi.fn());
    process.env.DOCKSCOPE_TOKEN = TOKEN;
    // Never let a test read or write the developer's own state file.
    process.env.DOCKSCOPE_AUTH_FILE = path.join(authDir, 'auth.json');
  });

  afterEach(async () => {
    delete process.env.DOCKSCOPE_TOKEN;
    delete process.env.DOCKSCOPE_AUTH_FILE;
    await server?.close();
    server = null;
  });

  const base = () => `http://127.0.0.1:${server!.port}`;

  async function openSession(): Promise<string> {
    const response = await fetch(`${base()}/api/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toBeTruthy();
    return cookie!.split(';')[0]!;
  }

  it('refuses an API request that carries no credentials', async () => {
    server = await startTestServer();
    const response = await fetch(`${base()}/api/graph`);
    expect(response.status).toBe(401);
  });

  it('still answers the status check, so the UI knows to prompt', async () => {
    server = await startTestServer();
    const response = await fetch(`${base()}/api/auth`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ required: true, authenticated: false });
  });

  it('refuses the wrong token and hands out no cookie', async () => {
    server = await startTestServer();
    const response = await fetch(`${base()}/api/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong' }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('issues an HttpOnly session for the right token', async () => {
    server = await startTestServer();
    const response = await fetch(`${base()}/api/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    });

    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    // Plain HTTP here, so marking it Secure would stop it being sent at all.
    expect(cookie).not.toContain('Secure');
  });

  it('accepts an API request carrying the session', async () => {
    server = await startTestServer();
    const cookie = await openSession();

    const response = await fetch(`${base()}/api/graph`, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(mockGraph);
  });

  it('accepts the raw token as a bearer header, for non-browser clients', async () => {
    server = await startTestServer();
    const response = await fetch(`${base()}/api/graph`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
  });

  it('stops honouring a session after sign-out', async () => {
    server = await startTestServer();
    const cookie = await openSession();

    await fetch(`${base()}/api/auth/session`, { method: 'DELETE', headers: { cookie } });

    const response = await fetch(`${base()}/api/graph`, { headers: { cookie } });
    expect(response.status).toBe(401);
  });

  // The socket carries exec and lifecycle actions, so leaving it open would
  // make gating the REST API pointless.
  it('refuses a WebSocket handshake with no session', async () => {
    server = await startTestServer();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      origin: base(),
    });

    const outcome = await new Promise<'open' | 'rejected'>((resolve) => {
      ws.once('open', () => resolve('open'));
      ws.once('error', () => resolve('rejected'));
      ws.once('unexpected-response', () => resolve('rejected'));
    });

    expect(outcome).toBe('rejected');
    ws.close();
  });

  it('accepts a WebSocket handshake carrying the session cookie', async () => {
    server = await startTestServer();
    const cookie = await openSession();

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      origin: base(),
      headers: { cookie },
    });

    const initial = await readWsMessage(ws);
    expect(initial).toEqual({ type: 'graph', data: mockGraph });
    ws.close();
  });

  it('reports that the token is pinned by the environment', async () => {
    server = await startTestServer();
    const status = await (await fetch(`${base()}/api/auth`)).json();
    expect(status).toMatchObject({ required: true, managedByEnv: true, setup: 'configured' });
  });

  // Every field on every route, so the client never fills a gap with a default
  // and forgets, say, that DOCKSCOPE_TOKEN pinned the token.
  it('answers every auth endpoint with the same status shape', async () => {
    server = await startTestServer();
    const shape = ['required', 'authenticated', 'managedByEnv', 'viaProxy', 'setup'];

    const status = await (await fetch(`${base()}/api/auth`)).json();
    const login = await fetch(`${base()}/api/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const loggedIn = await login.json();
    const signedOut = await (
      await fetch(`${base()}/api/auth/session`, { method: 'DELETE', headers: { cookie } })
    ).json();

    for (const body of [status, loggedIn, signedOut]) {
      expect(Object.keys(body)).toEqual(expect.arrayContaining(shape));
      expect(body.managedByEnv).toBe(true);
    }
    expect(loggedIn.authenticated).toBe(true);
    expect(signedOut.authenticated).toBe(false);
  });
});

/**
 * First-run setup: with no token anywhere, the dashboard is open but offers to
 * claim the instance. Tests connect over loopback, which is always allowed.
 */
describe('first-run setup', () => {
  let server: ServerHandle | null = null;
  let authDir = '';

  beforeAll(async () => {
    authDir = await mkdtemp(path.join(tmpdir(), 'dockscope-it-setup-'));
  });

  afterAll(async () => {
    await rm(authDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.checkConnection.mockResolvedValue(true);
    mocks.buildGraph.mockResolvedValue(mockGraph);
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
    mocks.listDockerHosts.mockReturnValue([]);
    mocks.watchEvents.mockReturnValue(vi.fn());
    delete process.env.DOCKSCOPE_TOKEN;
    // A fresh file per test, so one test's token cannot leak into the next.
    process.env.DOCKSCOPE_AUTH_FILE = path.join(authDir, `${randomUUID()}.json`);
  });

  afterEach(async () => {
    delete process.env.DOCKSCOPE_AUTH_FILE;
    await server?.close();
    server = null;
  });

  const base = () => `http://127.0.0.1:${server!.port}`;

  const setup = (token: string) =>
    fetch(`${base()}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });

  it('offers setup and leaves the dashboard usable meanwhile', async () => {
    server = await startTestServer();

    expect(await (await fetch(`${base()}/api/auth`)).json()).toMatchObject({
      required: false,
      authenticated: true,
      setup: 'available',
    });
    expect((await fetch(`${base()}/api/graph`)).status).toBe(200);
  });

  it('refuses a token that is too short to be worth having', async () => {
    server = await startTestServer();
    const response = await setup('short');
    expect(response.status).toBe(400);
    expect((await (await fetch(`${base()}/api/auth`)).json()).required).toBe(false);
  });

  it('locks the instance and signs in whoever set it up', async () => {
    server = await startTestServer();

    const response = await setup('a-perfectly-good-token');
    expect(response.status).toBe(200);
    // Handing back a session is what stops setup locking you out of the page
    // you are looking at.
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    expect(cookie).toBeTruthy();

    expect((await fetch(`${base()}/api/graph`)).status).toBe(401);
    expect((await fetch(`${base()}/api/graph`, { headers: { cookie: cookie! } })).status).toBe(200);
  });

  it('accepts the freshly chosen token as a bearer credential', async () => {
    server = await startTestServer();
    await setup('a-perfectly-good-token');

    const response = await fetch(`${base()}/api/graph`, {
      headers: { authorization: 'Bearer a-perfectly-good-token' },
    });
    expect(response.status).toBe(200);
  });

  it('keeps the token across a restart', async () => {
    server = await startTestServer();
    await setup('a-perfectly-good-token');
    await server.close();

    server = await startTestServer();
    expect((await fetch(`${base()}/api/graph`)).status).toBe(401);
    expect(
      (
        await fetch(`${base()}/api/graph`, {
          headers: { authorization: 'Bearer a-perfectly-good-token' },
        })
      ).status,
    ).toBe(200);
  });

  // Claiming is for an unclaimed instance; changing an existing token requires
  // already holding it.
  it('refuses to overwrite the token without credentials', async () => {
    server = await startTestServer();
    await setup('a-perfectly-good-token');

    expect((await setup('someone-elses-token')).status).toBe(401);
  });

  it('lets an authenticated user change the token', async () => {
    server = await startTestServer();
    const first = await setup('a-perfectly-good-token');
    const cookie = first.headers.get('set-cookie')!.split(';')[0]!;

    const changed = await fetch(`${base()}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ token: 'the-second-good-token' }),
    });
    expect(changed.status).toBe(200);

    expect(
      (
        await fetch(`${base()}/api/graph`, {
          headers: { authorization: 'Bearer the-second-good-token' },
        })
      ).status,
    ).toBe(200);
    // The old one stops working, which is the point of changing it.
    expect(
      (
        await fetch(`${base()}/api/graph`, {
          headers: { authorization: 'Bearer a-perfectly-good-token' },
        })
      ).status,
    ).toBe(401);
  });

  // Sessions are verified by id alone, so a rotation has to clear them
  // explicitly; it is normally a response to the token being exposed.
  it('cuts off sessions issued under the previous token', async () => {
    server = await startTestServer();
    const claimed = await setup('a-perfectly-good-token');
    const oldCookie = claimed.headers.get('set-cookie')!.split(';')[0]!;

    expect((await fetch(`${base()}/api/graph`, { headers: { cookie: oldCookie } })).status).toBe(
      200,
    );

    const rotated = await fetch(`${base()}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: oldCookie },
      body: JSON.stringify({ token: 'the-rotated-good-token' }),
    });
    expect(rotated.status).toBe(200);

    // The cookie that performed the rotation is replaced, not merely kept.
    const newCookie = rotated.headers.get('set-cookie')!.split(';')[0]!;
    expect(newCookie).not.toBe(oldCookie);

    expect((await fetch(`${base()}/api/graph`, { headers: { cookie: oldCookie } })).status).toBe(
      401,
    );
    expect((await fetch(`${base()}/api/graph`, { headers: { cookie: newCookie } })).status).toBe(
      200,
    );
  });

  it('cuts off sessions when the token is removed', async () => {
    server = await startTestServer();
    const claimed = await setup('a-perfectly-good-token');
    const cookie = claimed.headers.get('set-cookie')!.split(';')[0]!;

    await fetch(`${base()}/api/auth/token`, { method: 'DELETE', headers: { cookie } });
    // Auth is off now, so the request succeeds on its own merits; what matters
    // is that the session itself is gone if a token is set again.
    await setup('a-second-good-token');
    expect((await fetch(`${base()}/api/graph`, { headers: { cookie } })).status).toBe(401);
  });

  it('removes the token again, reopening the instance', async () => {
    server = await startTestServer();
    const claimed = await setup('a-perfectly-good-token');
    const cookie = claimed.headers.get('set-cookie')!.split(';')[0]!;

    const removed = await fetch(`${base()}/api/auth/token`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(removed.status).toBe(200);
    expect((await fetch(`${base()}/api/graph`)).status).toBe(200);

    // And it stays removed across a restart.
    await server.close();
    server = await startTestServer();
    expect((await (await fetch(`${base()}/api/auth`)).json()).required).toBe(false);
  });

  it('refuses to remove the token without credentials', async () => {
    server = await startTestServer();
    await setup('a-perfectly-good-token');
    expect((await fetch(`${base()}/api/auth/token`, { method: 'DELETE' })).status).toBe(401);
  });

  const setReminder = (declined: boolean) =>
    fetch(`${base()}/api/auth/reminder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ declined }),
    });

  it('stops offering setup once the reminder is declined, and remembers it', async () => {
    server = await startTestServer();
    expect((await setReminder(true)).status).toBe(200);

    expect(await (await fetch(`${base()}/api/auth`)).json()).toMatchObject({
      required: false,
      setup: 'declined',
    });

    await server.close();
    server = await startTestServer();
    expect((await (await fetch(`${base()}/api/auth`)).json()).setup).toBe('declined');
  });

  // Not a one-way door: the choice is reversible from the security panel.
  it('offers setup again when the reminder is turned back on', async () => {
    server = await startTestServer();
    await setReminder(true);
    expect((await setReminder(false)).status).toBe(200);

    expect((await (await fetch(`${base()}/api/auth`)).json()).setup).toBe('available');
    // And claiming works again straight away.
    expect((await setup('a-perfectly-good-token')).status).toBe(200);
  });

  it('still allows setup while the reminder is declined', async () => {
    server = await startTestServer();
    await setReminder(true);
    // Declining only silences the prompt; the security panel can still set one.
    expect((await setup('a-perfectly-good-token')).status).toBe(200);
  });

  it('locks out a source that keeps guessing', async () => {
    server = await startTestServer();
    await setup('a-perfectly-good-token');

    const guess = () =>
      fetch(`${base()}/api/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'wrong' }),
      });

    let status = 401;
    for (let i = 0; i < 12 && status === 401; i += 1) {
      status = (await guess()).status;
    }
    expect(status).toBe(429);

    // Even the correct token is refused while the lockout stands.
    const correct = await fetch(`${base()}/api/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'a-perfectly-good-token' }),
    });
    expect(correct.status).toBe(429);
    expect(correct.headers.get('retry-after')).toBeTruthy();
  }, 20000);
});

/**
 * The arrangement most homelabs actually use: an identity proxy (Authelia,
 * Authentik, oauth2-proxy) authenticates the user and passes it down. Tests
 * connect over loopback, so loopback is the trusted proxy here.
 */
describe('reverse-proxy authentication', () => {
  let server: ServerHandle | null = null;
  let authDir = '';

  beforeAll(async () => {
    authDir = await mkdtemp(path.join(tmpdir(), 'dockscope-it-proxy-'));
  });

  afterAll(async () => {
    await rm(authDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkConnection.mockResolvedValue(true);
    mocks.buildGraph.mockResolvedValue(mockGraph);
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
    mocks.listDockerHosts.mockReturnValue([]);
    mocks.watchEvents.mockReturnValue(vi.fn());
    process.env.DOCKSCOPE_TOKEN = 'a-token-that-is-long-enough';
    process.env.DOCKSCOPE_AUTH_PROXY_HEADER = 'Remote-User';
    process.env.DOCKSCOPE_TRUSTED_PROXIES = '127.0.0.1';
    process.env.DOCKSCOPE_AUTH_FILE = path.join(authDir, `${randomUUID()}.json`);
  });

  afterEach(async () => {
    delete process.env.DOCKSCOPE_TOKEN;
    delete process.env.DOCKSCOPE_AUTH_PROXY_HEADER;
    delete process.env.DOCKSCOPE_TRUSTED_PROXIES;
    delete process.env.DOCKSCOPE_AUTH_FILE;
    await server?.close();
    server = null;
  });

  const base = () => `http://127.0.0.1:${server!.port}`;

  it('accepts a request the proxy vouched for, with no token exchange', async () => {
    server = await startTestServer();
    const response = await fetch(`${base()}/api/graph`, { headers: { 'Remote-User': 'manuel' } });
    expect(response.status).toBe(200);
  });

  it('still refuses a request with no header at all', async () => {
    server = await startTestServer();
    expect((await fetch(`${base()}/api/graph`)).status).toBe(401);
  });

  // With a proxy configured, a request that goes around it straight to the
  // port is refused even though no token is set.
  it('refuses an unproxied request even with no token configured', async () => {
    delete process.env.DOCKSCOPE_TOKEN;
    server = await startTestServer();

    expect((await fetch(`${base()}/api/graph`)).status).toBe(401);
    expect(
      (await fetch(`${base()}/api/graph`, { headers: { 'Remote-User': 'manuel' } })).status,
    ).toBe(200);
    // And there is nothing to claim, so no setup screen appears either.
    expect(await (await fetch(`${base()}/api/auth`)).json()).toMatchObject({
      required: true,
      setup: 'configured',
    });
  });

  it('reports that a proxy is handling the login, so no prompt is shown', async () => {
    server = await startTestServer();
    const status = await (
      await fetch(`${base()}/api/auth`, { headers: { 'Remote-User': 'manuel' } })
    ).json();
    expect(status).toMatchObject({ authenticated: true, viaProxy: true, setup: 'configured' });
  });

  it('accepts a WebSocket the proxy vouched for', async () => {
    server = await startTestServer();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      origin: base(),
      headers: { 'Remote-User': 'manuel' },
    });

    const initial = await readWsMessage(ws);
    expect(initial).toEqual({ type: 'graph', data: mockGraph });
    ws.close();
  });
});
