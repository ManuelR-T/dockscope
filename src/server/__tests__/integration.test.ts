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
  containerAction: vi.fn(),
  streamContainerLogs: vi.fn(),
  watchEvents: vi.fn(),
  buildMultiHostGraph: vi.fn(),
  refreshHostStatus: vi.fn(),
  initHosts: vi.fn(),
  stopWatching: vi.fn(),
}));

vi.mock('../../docker/client.js', () => ({
  buildGraph: mocks.buildGraph,
  checkConnection: mocks.checkConnection,
  composeAction: vi.fn(),
  containerAction: mocks.containerAction,
  createExecSession: vi.fn(),
  diagnoseCrash: vi.fn(),
  getContainerDiff: vi.fn(),
  getContainerLogs: vi.fn(),
  getContainerStats: vi.fn(),
  getContainerTop: vi.fn(),
  getSystemInfo: vi.fn(),
  initDockerClient: vi.fn(),
  inspectContainer: vi.fn(),
  listComposeProjects: vi.fn(),
  removeContainer: vi.fn(),
  streamContainerLogs: mocks.streamContainerLogs,
  watchEvents: mocks.watchEvents,
}));

vi.mock('../../docker/hosts.js', () => ({
  addHost: vi.fn(),
  buildMultiHostGraph: mocks.buildMultiHostGraph,
  getHost: vi.fn(),
  initHosts: mocks.initHosts,
  listHosts: vi.fn(() => []),
  refreshHostStatus: mocks.refreshHostStatus,
  removeHost: vi.fn(),
}));

async function startTestServer(): Promise<ServerHandle> {
  const { startServer } = await import('../index');
  return startServer({ port: 0, open: false });
}

function readWsMessage(ws: WebSocket): Promise<any> {
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

function requiredCallback<T extends (...args: any[]) => void>(callback: T | null): T {
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
    mocks.buildMultiHostGraph.mockResolvedValue(mockGraph);
    mocks.refreshHostStatus.mockResolvedValue(undefined);
    mocks.stopWatching = vi.fn();
    mocks.watchEvents.mockReturnValue(mocks.stopWatching);
  });

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('serves route responses through real HTTP', async () => {
    server = await startTestServer();

    const graphResponse = await fetch(`http://127.0.0.1:${server.port}/api/graph`);
    expect(graphResponse.status).toBe(200);
    expect(await graphResponse.json()).toEqual(mockGraph);
    expect(mocks.buildGraph).toHaveBeenCalledOnce();

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
    ws.send(JSON.stringify({ type: 'subscribe_logs', data: { containerId: '123456789abc' } }));

    await waitFor(() => pushLog !== null);
    expect(mocks.streamContainerLogs).toHaveBeenCalledWith(
      '123456789abc',
      expect.any(Function),
      expect.any(Function),
    );

    requiredCallback(pushLog)('hello from container\n');
    expect(await readWsMessage(ws)).toEqual({
      type: 'log_chunk',
      data: { containerId: '123456789abc', text: 'hello from container\n' },
    });

    ws.close();
    await waitFor(() => stopLogs.mock.calls.length === 1);
  });
});
