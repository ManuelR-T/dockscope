import type { ServiceLink } from '../../types';

const NET_COLORS = [
  '0,228,255', // cyan
  '0,255,106', // green
  '168,85,247', // purple
  '255,138,43', // amber
  '236,72,153', // pink
  '59,130,246', // blue
  '255,221,51', // yellow
  '20,184,166', // teal
];

/** Build a stable network name → RGB string map from all links in the graph */
export function buildNetworkColorMap(links: ServiceLink[]): Map<string, string> {
  const names = new Set<string>();
  for (const link of links) {
    if (link.type === 'network' && link.label) names.add(link.label);
  }
  const sorted = [...names].sort();
  return new Map(sorted.map((n, i) => [n, NET_COLORS[i % NET_COLORS.length]]));
}
