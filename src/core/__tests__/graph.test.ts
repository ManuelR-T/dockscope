import { describe, expect, it } from 'vitest';
import type { GraphData } from '../../types';
import { graphToTables, mergeSourceSnapshots, scopeGraphToSource } from '../sources/graph';
import type { SourceGraphSnapshot } from '../sources/model';

const graph: GraphData = {
  nodes: [
    {
      id: 'abc123def456',
      name: 'api',
      fullName: 'api',
      project: '',
      host: 'remote-a',
      containerId: 'abc123def4567890',
      image: 'api:latest',
      status: 'running',
      health: 'none',
      ports: [],
      networks: ['backend'],
      volumeCount: 0,
      cpu: 0,
      memory: 0,
      memoryLimit: 0,
      networkRx: 0,
      networkTx: 0,
      networkRxRate: 0,
      networkTxRate: 0,
    },
    {
      id: 'def456abc123',
      name: 'db',
      fullName: 'db',
      project: '',
      host: 'remote-a',
      containerId: 'def456abc1237890',
      image: 'postgres:latest',
      status: 'running',
      health: 'none',
      ports: [],
      networks: ['backend'],
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
  links: [{ source: 'abc123def456', target: 'def456abc123', type: 'network', label: 'backend' }],
};

describe('core graph helpers', () => {
  it('scopes node and link IDs to a data source', () => {
    expect(scopeGraphToSource(graph, 'remote-a', true)).toEqual({
      nodes: [
        expect.objectContaining({ id: 'remote-a:abc123def456' }),
        expect.objectContaining({ id: 'remote-a:def456abc123' }),
      ],
      links: [
        {
          source: 'remote-a:abc123def456',
          target: 'remote-a:def456abc123',
          type: 'network',
          label: 'backend',
        },
      ],
    });
  });

  it('leaves graph IDs unchanged when source scoping is disabled', () => {
    expect(scopeGraphToSource(graph, 'remote-a', false)).toBe(graph);
  });

  it('merges source snapshots into one graph', () => {
    const snapshots: SourceGraphSnapshot[] = [
      {
        source: {
          id: 'remote-a',
          label: 'remote-a',
          kind: 'docker',
          pluginId: 'core.docker',
          capabilities: ['source.graph'],
          status: 'connected',
        },
        graph,
        collectedAt: 1,
      },
    ];
    expect(mergeSourceSnapshots(snapshots)).toEqual(graph);
  });

  it('builds entity tables for data-oriented consumers', () => {
    const tables = graphToTables(graph);
    expect(tables.nodes.ids).toEqual(['abc123def456', 'def456abc123']);
    expect(tables.nodes.byId.abc123def456.name).toBe('api');
    expect(tables.links.ids).toEqual(['network:abc123def456->def456abc123:backend']);
  });
});
