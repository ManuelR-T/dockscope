import { describe, expect, it } from 'vitest';
import type { GraphData } from '../../types';
import { collectSourceGraphs } from '../sources/collect';
import type { DataSourceDescriptor, GraphSourceAdapter } from '../sources/model';

function descriptor(id: string): DataSourceDescriptor {
  return {
    id,
    label: id,
    kind: 'docker',
    pluginId: 'core.docker',
    capabilities: ['source.graph'],
    status: 'connected',
  };
}

function graph(nodeId: string): GraphData {
  return {
    nodes: [
      {
        id: nodeId,
        name: nodeId,
        fullName: nodeId,
        project: '',
        host: 'local',
        containerId: `${nodeId}abcdef`,
        image: 'test:latest',
        status: 'running',
        health: 'none',
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
      },
    ],
    links: [],
  };
}

function adapter(id: string, data: GraphData): GraphSourceAdapter {
  const source = descriptor(id);
  return {
    describe: () => source,
    collectGraph: async () => ({ source, graph: data, collectedAt: 10 }),
  };
}

describe('collectSourceGraphs', () => {
  it('collects source snapshots, scopes IDs, and builds entity tables', async () => {
    const collection = await collectSourceGraphs(
      [adapter('host-a', graph('abcdef123456')), adapter('host-b', graph('abcdef123456'))],
      { now: () => 100 },
    );

    expect(collection.graph.nodes.map((node) => node.id)).toEqual([
      'host-a:abcdef123456',
      'host-b:abcdef123456',
    ]);
    expect(collection.tables.nodes.ids).toEqual(['host-a:abcdef123456', 'host-b:abcdef123456']);
    expect(collection.errors).toEqual([]);
    expect(collection.collectedAt).toBe(100);
  });

  it('returns source-scoped errors without failing the full collection', async () => {
    const failingSource = descriptor('broken');
    const failing: GraphSourceAdapter = {
      describe: () => failingSource,
      collectGraph: async () => {
        throw new Error('not reachable');
      },
    };

    const collection = await collectSourceGraphs([adapter('host-a', graph('abc')), failing], {
      now: () => 200,
    });

    expect(collection.graph.nodes.map((node) => node.id)).toEqual(['host-a:abc']);
    expect(collection.errors).toEqual([
      { source: failingSource, message: 'not reachable', collectedAt: 200 },
    ]);
  });
});
