import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../plugin-contract/registry';
import { collectSourceGraphs } from '../sources/collect';
import type { DockscopePlugin } from '../plugin-contract/manifest';
import type { GraphEntity } from '../sources/entities';
import { buildScopeOptions, isNodeInScope } from '../../web/lib/graphFilters';
import { mergeGraphData } from '../../web/lib/graphMerge';
import { nodeSelectionKey } from '../../web/lib/graphSelection';
import { sanitizeNode } from '../../web/lib/recording';

function plugin(id: string, entities: GraphEntity[]): DockscopePlugin {
  return {
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      manifestVersion: '1',
      dockscopeApiVersion: '1',
      hostApiVersion: '1',
      capabilities: ['source.graph'],
      permissions: [],
    },
    getEntitySources: () => [
      {
        describe: () => ({
          id,
          label: id,
          pluginId: id,
          kind: 'plugin',
          status: 'connected',
          capabilities: ['source.graph'],
        }),
        collectEntities: async () => ({ entities, collectedAt: 100 }),
      },
    ],
  };
}

describe('generic entity plugins', () => {
  it('collects plugin-defined kinds and metrics without requiring container fields', async () => {
    const registry = new PluginRegistry();
    const entity: GraphEntity = {
      id: 'home',
      name: 'Home',
      kind: 'endpoint',
      status: 'healthy',
      metrics: [
        { name: 'response_time', label: 'Response time', value: 42, unit: 'ms', observedAt: 100 },
      ],
    };
    registry.register(plugin('test.http', [entity]));
    registry.register(plugin('test.other', [{ ...entity, kind: 'virtual-machine' }]));
    const result = await collectSourceGraphs(registry.getGraphSources());
    expect(result.errors).toEqual([]);
    expect(result.graph.nodes[0]).toMatchObject({
      id: 'test.http:home',
      entityId: 'home',
      sourceId: 'test.http',
      kind: 'endpoint',
      entityStatus: 'healthy',
      metrics: entity.metrics,
    });
    expect(result.graph.nodes[1].id).toBe('test.other:home');
    expect(buildScopeOptions(result.graph.nodes)).toEqual([
      { value: 'source:test.http', label: 'test.http' },
      { value: 'source:test.other', label: 'test.other' },
    ]);
    expect(isNodeInScope(result.graph.nodes[0], 'docker-project:test.http')).toBe(false);
    expect(nodeSelectionKey(result.graph.nodes[0])).not.toBe(
      nodeSelectionKey(result.graph.nodes[1]),
    );

    const updated = structuredClone(result.graph);
    updated.nodes[0].metrics![0].value = 89;
    updated.nodes[0].metadata = { lastChecked: 'today' };
    const merged = mergeGraphData(result.graph, updated, 200);
    expect(merged.nodes[0].metrics![0].value).toBe(89);
    expect(merged.nodes[0].metadata).toEqual({ lastChecked: 'today' });
    expect(sanitizeNode(merged.nodes[0])).toMatchObject({
      entityId: 'home',
      sourceId: 'test.http',
      entityStatus: 'healthy',
      metrics: [
        { name: 'response_time', label: 'Response time', value: 89, unit: 'ms', observedAt: 100 },
      ],
      metadata: { lastChecked: 'today' },
    });
  });

  it('isolates invalid metric data to the offending source', async () => {
    const registry = new PluginRegistry();
    registry.register(
      plugin('test.bad', [
        {
          id: 'bad',
          name: 'Bad',
          kind: 'probe',
          status: 'unknown',
          metrics: [{ name: 'latency', label: 'Latency', value: NaN, unit: 'ms', observedAt: 100 }],
        },
      ]),
    );
    registry.register(
      plugin('test.good', [{ id: 'good', name: 'Good', kind: 'probe', status: 'healthy' }]),
    );
    const result = await collectSourceGraphs(registry.getGraphSources());
    expect(result.graph.nodes.map((node) => node.entityId)).toEqual(['good']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source.id).toBe('test.bad');
  });

  it('keeps graph identity and local links stable when another source is added', async () => {
    const registry = new PluginRegistry();
    const first = plugin('test.source', [
      { id: 'home', name: 'Home', kind: 'probe', status: 'healthy' },
      { id: 'test.source:home', name: 'Other', kind: 'probe', status: 'unknown' },
    ]);
    const original = first.getEntitySources!()[0];
    first.getEntitySources = () => [
      {
        ...original,
        collectEntities: async () => ({
          ...(await original.collectEntities()),
          links: [{ source: 'home', target: 'test.source:home', type: 'depends_on' }],
        }),
      },
    ];
    registry.register(first);
    const alone = await collectSourceGraphs(registry.getGraphSources());
    expect(alone.graph.nodes.map((node) => node.id)).toEqual([
      'test.source:home',
      'test.source:test.source%3Ahome',
    ]);
    expect(alone.graph.links).toEqual([
      { source: 'test.source:home', target: 'test.source:test.source%3Ahome', type: 'depends_on' },
    ]);
    registry.register(plugin('test.second', []));
    expect((await collectSourceGraphs(registry.getGraphSources())).graph).toEqual(alone.graph);
  });
});
