import { describe, it, expect } from 'vitest';
import { computeImportance } from '../importance';
import type { ServiceNode, ServiceLink } from '../../../types';

function makeNode(overrides: Partial<ServiceNode> & { id: string }): ServiceNode {
  return {
    name: overrides.id,
    fullName: overrides.id,
    project: '',
    host: 'local',
    containerId: overrides.id,
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
    ...overrides,
  };
}

describe('computeImportance', () => {
  it('returns empty map for no nodes', () => {
    expect(computeImportance([], [])).toEqual(new Map());
  });

  it('returns scores for all nodes', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' })];
    const scores = computeImportance(nodes, []);
    expect(scores.size).toBe(2);
    expect(scores.has('a')).toBe(true);
    expect(scores.has('b')).toBe(true);
  });

  it('scores are between 0 and 1', () => {
    const nodes = [
      makeNode({ id: 'a', ports: ['8080:80/tcp'], cpu: 90 }),
      makeNode({ id: 'b' }),
      makeNode({ id: 'c', ports: ['3000:3000/tcp'], cpu: 10 }),
    ];
    const links: ServiceLink[] = [{ source: 'a', target: 'b', type: 'depends_on' }];
    const scores = computeImportance(nodes, links);
    for (const score of scores.values()) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('nodes with exposed ports score higher', () => {
    const nodes = [
      makeNode({ id: 'exposed', ports: ['8080:80/tcp'] }),
      makeNode({ id: 'internal', ports: ['80/tcp'] }),
    ];
    const scores = computeImportance(nodes, []);
    expect(scores.get('exposed')!).toBeGreaterThan(scores.get('internal')!);
  });

  it('nodes with more connections score higher', () => {
    const nodes = [makeNode({ id: 'hub' }), makeNode({ id: 'a' }), makeNode({ id: 'b' })];
    const links: ServiceLink[] = [
      { source: 'a', target: 'hub', type: 'depends_on' },
      { source: 'b', target: 'hub', type: 'depends_on' },
    ];
    const scores = computeImportance(nodes, links);
    expect(scores.get('hub')!).toBeGreaterThan(scores.get('a')!);
  });

  it('nodes with dependency chain score higher', () => {
    const nodes = [makeNode({ id: 'root' }), makeNode({ id: 'mid' }), makeNode({ id: 'leaf' })];
    const links: ServiceLink[] = [
      { source: 'mid', target: 'root', type: 'depends_on' },
      { source: 'leaf', target: 'mid', type: 'depends_on' },
    ];
    const scores = computeImportance(nodes, links);
    // root has deepest chain (mid + leaf depend on it transitively)
    expect(scores.get('root')!).toBeGreaterThan(scores.get('leaf')!);
  });

  it('factors in CPU usage', () => {
    const nodes = [makeNode({ id: 'busy', cpu: 95 }), makeNode({ id: 'idle', cpu: 1 })];
    const scores = computeImportance(nodes, []);
    expect(scores.get('busy')!).toBeGreaterThan(scores.get('idle')!);
  });

  it('factors in network count', () => {
    const nodes = [
      makeNode({ id: 'multi', networks: ['a', 'b', 'c'] }),
      makeNode({ id: 'single', networks: ['a'] }),
    ];
    const scores = computeImportance(nodes, []);
    expect(scores.get('multi')!).toBeGreaterThan(scores.get('single')!);
  });
});
