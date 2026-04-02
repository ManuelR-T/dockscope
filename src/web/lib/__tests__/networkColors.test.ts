import { describe, it, expect } from 'vitest';
import { buildNetworkColorMap } from '../networkColors';
import type { ServiceLink } from '../../../types';

describe('buildNetworkColorMap', () => {
  it('returns empty map for no links', () => {
    expect(buildNetworkColorMap([])).toEqual(new Map());
  });

  it('ignores depends_on links', () => {
    const links: ServiceLink[] = [{ source: 'a', target: 'b', type: 'depends_on' }];
    expect(buildNetworkColorMap(links)).toEqual(new Map());
  });

  it('assigns colors to network links', () => {
    const links: ServiceLink[] = [
      { source: 'a', target: 'b', type: 'network', label: 'frontend' },
      { source: 'c', target: 'd', type: 'network', label: 'backend' },
    ];
    const map = buildNetworkColorMap(links);
    expect(map.size).toBe(2);
    expect(map.has('frontend')).toBe(true);
    expect(map.has('backend')).toBe(true);
  });

  it('assigns colors in sorted order (deterministic)', () => {
    const links: ServiceLink[] = [
      { source: 'a', target: 'b', type: 'network', label: 'zebra' },
      { source: 'c', target: 'd', type: 'network', label: 'alpha' },
    ];
    const map = buildNetworkColorMap(links);
    // alpha comes first alphabetically, gets first color
    const colors = [...map.values()];
    expect(colors[0]).not.toBe(colors[1]);
  });

  it('deduplicates same network name', () => {
    const links: ServiceLink[] = [
      { source: 'a', target: 'b', type: 'network', label: 'shared' },
      { source: 'c', target: 'd', type: 'network', label: 'shared' },
    ];
    const map = buildNetworkColorMap(links);
    expect(map.size).toBe(1);
  });

  it('wraps colors when more networks than palette', () => {
    const links: ServiceLink[] = Array.from({ length: 10 }, (_, i) => ({
      source: `a${i}`,
      target: `b${i}`,
      type: 'network' as const,
      label: `net${i}`,
    }));
    const map = buildNetworkColorMap(links);
    expect(map.size).toBe(10);
    // Colors should wrap (8 palette entries)
    const colors = [...map.values()];
    expect(colors[0]).toBe(colors[8]);
  });
});
