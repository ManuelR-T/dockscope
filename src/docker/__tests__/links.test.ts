import { describe, it, expect } from 'vitest';
import { extractDependsOnFromLabels, extractNetworkLinks } from '../links';
import type { ServiceNode } from '../../types';

function makeNode(id: string, name: string, project = ''): ServiceNode {
  return {
    id,
    name,
    fullName: name,
    project,
    containerId: id + '0'.repeat(52),
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
  };
}

describe('extractDependsOnFromLabels', () => {
  it('extracts depends_on from container labels', () => {
    const nodes = [makeNode('abc123456789', 'web', 'proj'), makeNode('def123456789', 'db', 'proj')];
    const containers = [
      {
        Id: 'abc123456789aaa',
        Labels: {
          'com.docker.compose.depends_on': 'db:service_started:false',
          'com.docker.compose.project': 'proj',
        },
      },
      {
        Id: 'def123456789aaa',
        Labels: { 'com.docker.compose.project': 'proj' },
      },
    ];
    const projectMap = new Map([
      ['abc123456789', 'proj'],
      ['def123456789', 'proj'],
    ]);

    const { links } = extractDependsOnFromLabels(containers, nodes, projectMap);
    expect(links).toHaveLength(1);
    expect(links[0].source).toBe('abc123456789');
    expect(links[0].target).toBe('def123456789');
    expect(links[0].type).toBe('depends_on');
  });

  it('returns empty for containers without depends_on', () => {
    const nodes = [makeNode('abc123456789', 'web')];
    const containers = [{ Id: 'abc123456789aaa', Labels: {} }];
    const { links } = extractDependsOnFromLabels(containers, nodes, new Map());
    expect(links).toHaveLength(0);
  });

  it('deduplicates links', () => {
    const nodes = [makeNode('abc123456789', 'web', 'p'), makeNode('def123456789', 'db', 'p')];
    const containers = [
      {
        Id: 'abc123456789aaa',
        Labels: {
          'com.docker.compose.depends_on': 'db:service_started:false,db:service_started:false',
          'com.docker.compose.project': 'p',
        },
      },
      { Id: 'def123456789aaa', Labels: { 'com.docker.compose.project': 'p' } },
    ];
    const projectMap = new Map([
      ['abc123456789', 'p'],
      ['def123456789', 'p'],
    ]);

    const { links } = extractDependsOnFromLabels(containers, nodes, projectMap);
    expect(links).toHaveLength(1);
  });
});

describe('extractNetworkLinks', () => {
  it('creates links between containers in same network', () => {
    const networkMap = new Map([['mynet', ['a', 'b', 'c']]]);
    const links = extractNetworkLinks(networkMap);
    expect(links).toHaveLength(3); // a-b, a-c, b-c
    expect(links.every((l) => l.type === 'network')).toBe(true);
    expect(links.every((l) => l.label === 'mynet')).toBe(true);
  });

  it('skips default networks', () => {
    const networkMap = new Map([
      ['bridge', ['a', 'b']],
      ['host', ['c', 'd']],
      ['none', ['e', 'f']],
    ]);
    const links = extractNetworkLinks(networkMap);
    expect(links).toHaveLength(0);
  });

  it('deduplicates links', () => {
    const networkMap = new Map([['net1', ['a', 'b']]]);
    const links = extractNetworkLinks(networkMap);
    expect(links).toHaveLength(1);
  });

  it('handles single container in network', () => {
    const networkMap = new Map([['solo', ['a']]]);
    const links = extractNetworkLinks(networkMap);
    expect(links).toHaveLength(0);
  });

  it('handles empty network map', () => {
    const links = extractNetworkLinks(new Map());
    expect(links).toHaveLength(0);
  });
});
