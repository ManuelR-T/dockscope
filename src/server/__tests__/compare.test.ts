import { describe, it, expect } from 'vitest';
import { compareEnvironments } from '../compare';
import type { ServiceNode, GraphData } from '../../types';

/** Helper to create a minimal ServiceNode with overrides */
function makeNode(overrides: Partial<ServiceNode> & { name: string }): ServiceNode {
  return {
    id: overrides.id ?? overrides.name,
    name: overrides.name,
    fullName: overrides.fullName ?? overrides.name,
    project: overrides.project ?? '',
    host: overrides.host ?? 'local',
    containerId: overrides.containerId ?? overrides.name,
    image: overrides.image ?? 'nginx:latest',
    status: overrides.status ?? 'running',
    health: overrides.health ?? 'none',
    ports: overrides.ports ?? [],
    networks: overrides.networks ?? [],
    volumeCount: overrides.volumeCount ?? 0,
    cpu: overrides.cpu ?? 0,
    memory: overrides.memory ?? 0,
    memoryLimit: overrides.memoryLimit ?? 0,
    networkRx: overrides.networkRx ?? 0,
    networkTx: overrides.networkTx ?? 0,
    networkRxRate: overrides.networkRxRate ?? 0,
    networkTxRate: overrides.networkTxRate ?? 0,
  };
}

function makeGraph(nodes: ServiceNode[]): GraphData {
  return { nodes, links: [] };
}

describe('compareEnvironments', () => {
  it('returns empty results for two empty graphs', () => {
    const result = compareEnvironments(makeGraph([]), makeGraph([]));
    expect(result.onlyInA).toEqual([]);
    expect(result.onlyInB).toEqual([]);
    expect(result.matched).toEqual([]);
  });

  it('matches identical services with no diffs', () => {
    const node = makeNode({ name: 'web', image: 'nginx:1.25', ports: ['80/tcp'] });
    const result = compareEnvironments(makeGraph([node]), makeGraph([{ ...node }]));
    expect(result.onlyInA).toEqual([]);
    expect(result.onlyInB).toEqual([]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].name).toBe('web');
    expect(result.matched[0].diffs).toEqual([]);
  });

  it('detects services only in A', () => {
    const nodeA = makeNode({ name: 'web' });
    const result = compareEnvironments(makeGraph([nodeA]), makeGraph([]));
    expect(result.onlyInA).toHaveLength(1);
    expect(result.onlyInA[0].name).toBe('web');
    expect(result.onlyInB).toEqual([]);
    expect(result.matched).toEqual([]);
  });

  it('detects services only in B', () => {
    const nodeB = makeNode({ name: 'db' });
    const result = compareEnvironments(makeGraph([]), makeGraph([nodeB]));
    expect(result.onlyInA).toEqual([]);
    expect(result.onlyInB).toHaveLength(1);
    expect(result.onlyInB[0].name).toBe('db');
  });

  it('detects image differences', () => {
    const a = makeNode({ name: 'web', image: 'nginx:1.24' });
    const b = makeNode({ name: 'web', image: 'nginx:1.25' });
    const result = compareEnvironments(makeGraph([a]), makeGraph([b]));
    expect(result.matched).toHaveLength(1);
    const diffs = result.matched[0].diffs;
    expect(diffs).toContainEqual({ field: 'Image', hostA: 'nginx:1.24', hostB: 'nginx:1.25' });
  });

  it('normalizes implicit :latest tag when comparing images', () => {
    const a = makeNode({ name: 'web', image: 'nginx' });
    const b = makeNode({ name: 'web', image: 'nginx:latest' });
    const result = compareEnvironments(makeGraph([a]), makeGraph([b]));
    expect(result.matched[0].diffs.find((d) => d.field === 'Image')).toBeUndefined();
  });

  it('detects status differences', () => {
    const a = makeNode({ name: 'web', status: 'running' });
    const b = makeNode({ name: 'web', status: 'exited' });
    const result = compareEnvironments(makeGraph([a]), makeGraph([b]));
    expect(result.matched[0].diffs).toContainEqual({
      field: 'Status',
      hostA: 'running',
      hostB: 'exited',
    });
  });

  it('detects health differences', () => {
    const a = makeNode({ name: 'web', health: 'healthy' });
    const b = makeNode({ name: 'web', health: 'unhealthy' });
    const result = compareEnvironments(makeGraph([a]), makeGraph([b]));
    expect(result.matched[0].diffs).toContainEqual({
      field: 'Health',
      hostA: 'healthy',
      hostB: 'unhealthy',
    });
  });

  it('detects port differences', () => {
    const a = makeNode({ name: 'web', ports: ['8080:80/tcp'] });
    const b = makeNode({ name: 'web', ports: ['80/tcp'] });
    const result = compareEnvironments(makeGraph([a]), makeGraph([b]));
    expect(result.matched[0].diffs).toContainEqual({
      field: 'Ports',
      hostA: '8080:80/tcp',
      hostB: '80/tcp',
    });
  });

  it('treats same ports in different order as equal', () => {
    const a = makeNode({ name: 'web', ports: ['443/tcp', '80/tcp'] });
    const b = makeNode({ name: 'web', ports: ['80/tcp', '443/tcp'] });
    const result = compareEnvironments(makeGraph([a]), makeGraph([b]));
    expect(result.matched[0].diffs.find((d) => d.field === 'Ports')).toBeUndefined();
  });

  it('detects network differences', () => {
    const a = makeNode({ name: 'web', networks: ['frontend'] });
    const b = makeNode({ name: 'web', networks: ['frontend', 'backend'] });
    const result = compareEnvironments(makeGraph([a]), makeGraph([b]));
    expect(result.matched[0].diffs).toContainEqual({
      field: 'Networks',
      hostA: 'frontend',
      hostB: 'backend, frontend',
    });
  });

  it('detects memory limit differences', () => {
    const a = makeNode({ name: 'web', memoryLimit: 536870912 }); // 512 MB
    const b = makeNode({ name: 'web', memoryLimit: 1073741824 }); // 1024 MB
    const result = compareEnvironments(makeGraph([a]), makeGraph([b]));
    expect(result.matched[0].diffs).toContainEqual({
      field: 'Memory Limit',
      hostA: '512 MB',
      hostB: '1024 MB',
    });
  });

  it('matches services by project/name for compose projects', () => {
    const a = makeNode({ name: 'web', project: 'myapp' });
    const b = makeNode({ name: 'web', project: 'myapp' });
    const result = compareEnvironments(makeGraph([a]), makeGraph([b]));
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].name).toBe('myapp/web');
  });

  it('treats same name in different projects as different services', () => {
    const a = makeNode({ name: 'web', project: 'staging' });
    const b = makeNode({ name: 'web', project: 'production' });
    const result = compareEnvironments(makeGraph([a]), makeGraph([b]));
    expect(result.matched).toEqual([]);
    expect(result.onlyInA).toHaveLength(1);
    expect(result.onlyInB).toHaveLength(1);
  });

  it('handles mixed: some matched, some only in A, some only in B', () => {
    const a = makeGraph([
      makeNode({ name: 'web' }),
      makeNode({ name: 'redis' }),
    ]);
    const b = makeGraph([
      makeNode({ name: 'web', image: 'nginx:1.26' }),
      makeNode({ name: 'postgres' }),
    ]);
    const result = compareEnvironments(a, b);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].name).toBe('web');
    expect(result.onlyInA).toHaveLength(1);
    expect(result.onlyInA[0].name).toBe('redis');
    expect(result.onlyInB).toHaveLength(1);
    expect(result.onlyInB[0].name).toBe('postgres');
  });

  it('shows (none) for empty ports when other side has ports', () => {
    const a = makeNode({ name: 'web', ports: [] });
    const b = makeNode({ name: 'web', ports: ['80/tcp'] });
    const result = compareEnvironments(makeGraph([a]), makeGraph([b]));
    expect(result.matched[0].diffs).toContainEqual({
      field: 'Ports',
      hostA: '(none)',
      hostB: '80/tcp',
    });
  });
});
