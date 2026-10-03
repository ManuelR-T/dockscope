import { describe, expect, it } from 'vitest';
import type { ServiceNode } from '../../../types';
import { graphViewState, resolveGraphViewSelection } from '../pluginGraphView';

const node: ServiceNode = {
  id: 'remote/api',
  name: 'api',
  fullName: 'api',
  host: 'remote',
  sourceId: 'docker.remote',
  entityId: 'abc',
  containerId: 'abc',
  project: 'app',
  image: 'test',
  status: 'running',
  health: 'none',
  ports: [],
  networks: ['private'],
  volumeCount: 0,
  cpu: 12,
  memory: 1024,
  memoryLimit: 2048,
  networkRx: 0,
  networkTx: 0,
  networkRxRate: 0,
  networkTxRate: 0,
};

describe('graph view host projection', () => {
  it('sends live display state without inspect data, credentials or cyclic renderer objects', () => {
    const three: Record<string, unknown> = {};
    three.self = three;
    const raw = {
      ...node,
      x: 42,
      __threeObj: three,
      env: ['TOKEN=secret'],
      inspect: { password: 'secret' },
    };
    const graph = {
      nodes: [raw],
      links: [{ source: raw, target: node.id, type: 'network' as const }],
    };
    const state = graphViewState(
      graph,
      raw,
      { searchQuery: 'api', statusFilter: new Set(['running']), scopeFilter: 'app' },
      true,
      true,
      ['abc', 'abc'],
    );
    expect(() => JSON.stringify(state)).not.toThrow();
    expect(state.graph.nodes[0]).toEqual(node);
    expect(state.graph.links[0].source).toBe(node.id);
    expect(state).toMatchObject({
      selectedNodeId: node.id,
      replayMode: true,
      colorNetworks: true,
      anomalyEntityIds: ['abc'],
      filters: { searchQuery: 'api', statusFilter: ['running'], scopeFilter: 'app' },
    });
    expect(raw.__threeObj).toBe(three);
    expect(raw.env).toEqual(['TOKEN=secret']);
  });

  it('resolves selection only against current graph IDs, retaining the source identity', () => {
    const graph = { nodes: [node], links: [] };
    expect(resolveGraphViewSelection(graph, node.id)).toBe(node);
    expect(resolveGraphViewSelection(graph, 'abc')).toBeUndefined();
    expect(resolveGraphViewSelection(graph, 'http://untrusted')).toBeUndefined();
    expect(resolveGraphViewSelection(graph, null)).toBeNull();
    expect(resolveGraphViewSelection({ nodes: [], links: [] }, node.id)).toBeUndefined();
  });
});
