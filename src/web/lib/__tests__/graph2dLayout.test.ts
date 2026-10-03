import { describe, expect, it } from 'vitest';
import type { GraphData, ServiceNode } from '../../../types';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  layoutGraph2d,
} from '../../../plugins/official/graph-view-2d/layout';

function node(id: string, overrides: Partial<ServiceNode> = {}): ServiceNode {
  return {
    id,
    name: id,
    fullName: id,
    host: 'local',
    project: 'app',
    containerId: id,
    image: 'test',
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
    ...overrides,
  };
}

describe('2D graph layout', () => {
  it('places declared dependencies to the right, including materialized 3D endpoints', () => {
    const graph: GraphData = {
      nodes: [node('db'), node('api'), node('web')],
      links: [
        { source: { id: 'web' }, target: { id: 'api' }, type: 'depends_on' },
        { source: 'api', target: 'db', type: 'depends_on' },
      ],
    };
    const positions = new Map(layoutGraph2d(graph).nodes.map((n) => [n.id, n.x]));
    expect(positions.get('web')).toBeLessThan(positions.get('api')!);
    expect(positions.get('api')).toBeLessThan(positions.get('db')!);
  });

  it('keeps positions stable across metrics, input ordering and 3D simulation coordinates', () => {
    const graph: GraphData = { nodes: [node('api'), node('db')], links: [] };
    const before = structuredClone(graph);
    const initial = layoutGraph2d(graph);
    expect(graph).toEqual(before);
    expect(
      layoutGraph2d({
        ...graph,
        nodes: [...graph.nodes]
          .reverse()
          .map((n) => ({ ...n, cpu: 99, memory: 123, x: 800, y: 120 })),
      }),
    ).toEqual(initial);
  });

  it('handles cycles, duplicate links, missing targets and deep chains without overlapping cards', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => node(`service-${i}`));
    const graph: GraphData = {
      nodes,
      links: nodes
        .slice(1)
        .map((n, i) => ({ source: nodes[i].id, target: n.id, type: 'depends_on' })),
    };
    graph.links.push({ source: nodes[1].id, target: nodes[0].id, type: 'depends_on' });
    graph.links.push(graph.links[0], {
      source: nodes[0].id,
      target: 'missing',
      type: 'depends_on',
    });
    const result = layoutGraph2d(graph);
    expect(result.nodes).toHaveLength(30);
    for (const a of result.nodes) {
      expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
      for (const b of result.nodes.filter((n) => n.id !== a.id)) {
        expect(Math.abs(a.x - b.x) >= CARD_WIDTH || Math.abs(a.y - b.y) >= CARD_HEIGHT).toBe(true);
      }
    }
    const chain = layoutGraph2d({ ...graph, links: graph.links.slice(0, 29) });
    expect(chain.width).toBeLessThan(1300);
    expect(new Set(chain.nodes.map((n) => `${n.x}:${n.y}`)).size).toBe(30);
  });

  it('separates equal network names by source and includes single-member networks', () => {
    const result = layoutGraph2d({
      nodes: [
        node('a', { networks: ['backend', 'solo', 'backend'] }),
        node('b', { networks: ['backend'] }),
        node('c', { sourceId: 'remote', networks: ['backend'] }),
      ],
      links: [],
    });
    expect(result.networks).toHaveLength(3);
    expect(
      result.networks.find((n) => n.source === 'local' && n.name === 'backend')?.members,
    ).toEqual(['a', 'b']);
    expect(result.networks.find((n) => n.source === 'remote')?.members).toEqual(['c']);
    expect(result.networks.find((n) => n.name === 'solo')?.members).toEqual(['a']);
    expect(result.groups).toHaveLength(2);
  });

  it('packs unrelated services into a grid instead of a long single column', () => {
    const result = layoutGraph2d({
      nodes: Array.from({ length: 16 }, (_, i) => node(`service-${i}`)),
      links: [],
    });
    expect(new Set(result.nodes.map((n) => n.x)).size).toBe(4);
    expect(new Set(result.nodes.map((n) => n.y)).size).toBe(4);
    expect(result.height).toBeLessThan(650);
  });

  it('returns finite empty dimensions', () => {
    expect(layoutGraph2d({ nodes: [], links: [] })).toEqual({
      nodes: [],
      networks: [],
      groups: [],
      width: 0,
      height: 0,
    });
  });
});
