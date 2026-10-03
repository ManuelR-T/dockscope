import type { GraphData, ServiceNode } from '../../../types';
import { endpointId } from '../../../web/lib/graphLinks';

export const CARD_WIDTH = 208;
export const CARD_HEIGHT = 94;
const COLUMN_GAP = 88;
const ROW_GAP = 44;
const GROUP_GAP = 72;
const PADDING = 36;

export interface PositionedService {
  id: string;
  x: number;
  y: number;
}

export interface Graph2dNetwork {
  id: string;
  name: string;
  source: string;
  members: string[];
}

export interface Graph2dGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Graph2dLayout {
  nodes: PositionedService[];
  networks: Graph2dNetwork[];
  groups: Graph2dGroup[];
  width: number;
  height: number;
}

function source(node: ServiceNode): string {
  return node.sourceId || node.host || 'local';
}

function scope(node: ServiceNode): string {
  return node.namespace || node.project || 'Standalone';
}

/** Stable, non-physical positions. Stats and renderer-owned x/y values do not affect layout. */
export function layoutGraph2d(graph: GraphData): Graph2dLayout {
  const scopes = new Map<string, ServiceNode[]>();
  for (const node of graph.nodes) {
    const key = JSON.stringify([source(node), scope(node)]);
    const members = scopes.get(key) || [];
    members.push(node);
    scopes.set(key, members);
  }

  const layout: Graph2dLayout = { nodes: [], networks: [], groups: [], width: 0, height: 0 };
  let groupY = 0;
  for (const [id, members] of [...scopes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    members.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const memberIds = new Set(members.map((node) => node.id));
    const incoming = new Map(members.map((node) => [node.id, 0]));
    const outgoing = new Map(members.map((node) => [node.id, new Set<string>()]));
    for (const link of graph.links) {
      const from = endpointId(link.source);
      const to = endpointId(link.target);
      if (link.type !== 'depends_on' || from === to || !memberIds.has(from) || !memberIds.has(to)) {
        continue;
      }
      if (!outgoing.get(from)!.has(to)) {
        outgoing.get(from)!.add(to);
        incoming.set(to, incoming.get(to)! + 1);
      }
    }
    const ranks = new Map(members.map((node) => [node.id, 0]));
    const queue = members.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      for (const next of outgoing.get(current)!) {
        ranks.set(next, Math.max(ranks.get(next)!, ranks.get(current)! + 1));
        incoming.set(next, incoming.get(next)! - 1);
        if (incoming.get(next) === 0) {
          queue.push(next);
        }
      }
    }
    // Cycles remain finite in the first column; wrapping limits very deep stacks to four columns.
    const rows = new Map<number, number>();
    const hasDependencies = [...outgoing.values()].some((targets) => targets.size > 0);
    const gridColumns = Math.min(4, Math.ceil(Math.sqrt(members.length)));
    for (const [index, node] of members.entries()) {
      const rank = incoming.get(node.id)! > 0 ? 0 : ranks.get(node.id)!;
      const column = hasDependencies ? rank % 4 : index % gridColumns;
      const row = rows.get(column) || 0;
      rows.set(column, row + 1);
      layout.nodes.push({
        id: node.id,
        x: PADDING + column * (CARD_WIDTH + COLUMN_GAP),
        y: groupY + 64 + row * (CARD_HEIGHT + ROW_GAP),
      });
    }
    const columns = Math.max(...rows.keys()) + 1;
    const height = 64 + Math.max(...rows.values()) * (CARD_HEIGHT + ROW_GAP);
    const width = PADDING * 2 + columns * CARD_WIDTH + (columns - 1) * COLUMN_GAP;
    layout.groups.push({
      id,
      label: `${source(members[0])} / ${scope(members[0])}`,
      x: 0,
      y: groupY,
      width,
      height,
    });
    layout.width = Math.max(layout.width, width);
    groupY += height + GROUP_GAP;
  }

  layout.networks = collectGraph2dNetworks(graph.nodes);
  layout.height = Math.max(0, groupY - GROUP_GAP);
  return layout;
}

export function collectGraph2dNetworks(nodes: readonly ServiceNode[]): Graph2dNetwork[] {
  const networkMembers = new Map<string, Graph2dNetwork>();
  for (const node of nodes) {
    for (const name of new Set(node.networks)) {
      const id = JSON.stringify([source(node), name]);
      let hub = networkMembers.get(id);
      if (!hub) {
        hub = { id, name, source: source(node), members: [] };
        networkMembers.set(id, hub);
      }
      hub.members.push(node.id);
    }
  }
  return [...networkMembers.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((network) => ({ ...network, members: network.members.sort() }));
}
