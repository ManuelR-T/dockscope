import type { ServiceNode, ServiceLink } from '../../types.js';
import type { DataSourceDescriptor, GraphSourceAdapter } from './model.js';

/** A current observation, not a container-statistics field. Omit unavailable values. */
export interface EntityMetric {
  name: string;
  label: string;
  value: number;
  unit: string;
  observedAt: number;
}

export interface GraphEntity {
  /** Stable identity within this source. */
  id: string;
  name: string;
  /** Plugin-owned kind, e.g. "endpoint" or "virtual-machine". */
  kind: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  metadata?: Record<string, string | number | boolean>;
  metrics?: EntityMetric[];
}

export interface EntitySourceAdapter {
  describe(): DataSourceDescriptor;
  collectEntities(): Promise<{
    entities: GraphEntity[];
    links?: ServiceLink[];
    collectedAt: number;
  }>;
}

/** Keep legacy graph/rendering defaults here, never in third-party plugins. */
export function adaptEntitySource(adapter: EntitySourceAdapter): GraphSourceAdapter {
  return {
    describe: () => adapter.describe(),
    async collectGraph() {
      const source = adapter.describe();
      const snapshot = await adapter.collectEntities();
      const ids = new Set<string>();
      const nodes = snapshot.entities.map((entity): ServiceNode => {
        if (
          typeof entity.id !== 'string' ||
          !entity.id ||
          entity.id.length > 512 ||
          /[\s/?#]/.test(entity.id) ||
          ids.has(entity.id)
        ) {
          throw new Error('Entity source requires unique, URL-safe identities');
        }
        ids.add(entity.id);
        if (
          typeof entity.name !== 'string' ||
          !entity.name.trim() ||
          typeof entity.kind !== 'string' ||
          !entity.kind.trim() ||
          !['healthy', 'unhealthy', 'unknown'].includes(entity.status)
        ) {
          throw new Error('Entity source requires a name, kind and valid status');
        }
        const names = new Set<string>();
        for (const metric of entity.metrics ?? []) {
          if (
            typeof metric.name !== 'string' ||
            !metric.name ||
            typeof metric.label !== 'string' ||
            !metric.label ||
            typeof metric.unit !== 'string' ||
            !Number.isFinite(metric.value) ||
            !Number.isFinite(metric.observedAt) ||
            !Number.isFinite(new Date(metric.observedAt).getTime()) ||
            names.has(metric.name)
          ) {
            throw new Error('Entity metrics require unique names and finite observations');
          }
          names.add(metric.name);
        }
        return {
          id: `${source.id}:${encodeURIComponent(entity.id)}`,
          entityId: entity.id,
          sourceId: source.id,
          entityStatus: entity.status,
          name: entity.name,
          fullName: entity.name,
          runtime: source.pluginId,
          kind: entity.kind,
          project: source.label,
          host: source.id,
          metadata: entity.metadata,
          metrics: entity.metrics,
          status: entity.status === 'unknown' ? 'unknown' : 'running',
          health: entity.status === 'unknown' ? 'none' : entity.status,
          containerId: entity.id,
          image: '',
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
      });
      const graphIds = new Map(nodes.map((node) => [node.entityId!, node.id]));
      const endpoint = (value: ServiceLink['source']): string => {
        const id = typeof value === 'string' ? value : value.id;
        const graphId = graphIds.get(id);
        if (!graphId) {
          throw new Error(`Entity link refers to an unknown local entity: ${id}`);
        }
        return graphId;
      };
      const links = (snapshot.links ?? []).map((link) => ({
        ...link,
        source: endpoint(link.source),
        target: endpoint(link.target),
      }));
      return { source, graph: { nodes, links }, collectedAt: snapshot.collectedAt };
    },
  };
}
