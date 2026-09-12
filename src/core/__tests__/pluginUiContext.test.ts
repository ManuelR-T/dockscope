import { describe, expect, it } from 'vitest';
import type { ServiceNode } from '../../types';
import { pluginUiContextFromNode } from '../plugin-contract/ui';

function node(overrides: Partial<ServiceNode> = {}): ServiceNode {
  return {
    id: 'remote:123',
    name: 'api',
    fullName: 'project-api-1',
    project: 'project',
    host: 'remote',
    containerId: '1234567890',
    image: 'api:latest',
    status: 'running',
    health: 'healthy',
    ports: [],
    networks: [],
    volumeCount: 0,
    cpu: 0,
    memory: 0,
    memoryLimit: 0,
    networkRx: 0,
    networkTx: 0,
    networkRxRate: 0,
    networkTxRate: 0,
    metadata: { secret: 'not panel context' },
    ...overrides,
  };
}

describe('plugin UI context projection', () => {
  it('exposes only context fields with legacy Docker defaults', () => {
    const graphNode = Object.freeze(node());
    expect(pluginUiContextFromNode(graphNode)).toEqual({
      node: {
        id: 'remote:123',
        name: 'api',
        sourceId: 'remote',
        entityId: '1234567890',
        runtime: 'docker',
        kind: 'container',
        namespace: undefined,
        status: 'running',
        project: 'project',
        host: 'remote',
      },
    });
  });

  it('preserves Kubernetes runtime, kind and namespace', () => {
    expect(
      pluginUiContextFromNode(
        node({ runtime: 'kubernetes', kind: 'pod', namespace: 'production' }),
      ),
    ).toMatchObject({
      node: {
        runtime: 'kubernetes',
        kind: 'pod',
        namespace: 'production',
        status: 'running',
      },
    });
  });

  it('prefers generic entity identity and health over compatibility fields', () => {
    expect(
      pluginUiContextFromNode(
        node({
          sourceId: 'endpoints',
          entityId: 'homepage',
          entityStatus: 'unknown',
          runtime: 'official.endpoints',
          kind: 'endpoint',
        }),
      ),
    ).toMatchObject({
      node: {
        sourceId: 'endpoints',
        entityId: 'homepage',
        status: 'unknown',
        runtime: 'official.endpoints',
        kind: 'endpoint',
      },
    });
  });

  it.each([null, undefined])('returns empty context for an absent node (%s)', (graphNode) => {
    expect(pluginUiContextFromNode(graphNode)).toEqual({});
  });
});
