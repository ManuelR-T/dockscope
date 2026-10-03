import type { Anomaly, CrashDiagnostic, ServiceNode } from '../types.js';
import type { SourceGraphCollection } from '../core/sources/model.js';
import type { WebhookEventFamily } from '../shared/webhooks.js';

export interface WebhookIdentity {
  sourceId: string;
  workload?: { entityId: string; name: string; project: string };
}
export type WebhookAlert = WebhookIdentity & {
  family: WebhookEventFamily;
  eventType: string;
  time: number;
} & (
    | { type: 'anomaly'; data: Anomaly }
    | { type: 'diagnostic'; data: CrashDiagnostic }
    | {
        type: 'transition';
        data: {
          message: string;
          previous?: string;
          current?: string;
          metric?: 'cpu' | 'memory';
          value?: number;
          analyzerId?: string;
          crash?: boolean;
        };
      }
  );

export function workloadIdentity(node: ServiceNode): WebhookIdentity {
  return {
    sourceId: node.sourceId || node.host || 'local',
    workload: {
      entityId: node.entityId || node.containerId,
      name: node.name,
      project: node.namespace || node.project,
    },
  };
}

/** Only successful snapshots update workload health. Missing nodes never imply deletion. */
export class WebhookTransitions {
  private health = new Map<string, Map<string, string>>();
  private connected = new Map<string, boolean>();
  constructor(private emit: (alert: WebhookAlert) => void) {}

  observe(collection: SourceGraphCollection): void {
    const present = new Set(
      [...collection.snapshots, ...collection.errors].map((item) => item.source.id),
    );
    for (const id of this.connected.keys()) {
      if (!present.has(id)) {
        this.connected.delete(id);
        this.health.delete(id);
      }
    }
    for (const item of [...collection.snapshots, ...collection.errors]) {
      const sourceId = item.source.id;
      const connected = 'graph' in item;
      const previous = this.connected.get(sourceId);
      this.connected.set(sourceId, connected);
      if (previous !== undefined && previous !== connected) {
        this.emit({
          family: 'connectivity',
          type: 'transition',
          eventType: connected ? 'source.reconnected' : 'source.disconnected',
          sourceId,
          time: collection.collectedAt,
          data: {
            message: `${item.source.label} ${connected ? 'reconnected' : 'disconnected'}`,
            previous: previous ? 'connected' : 'disconnected',
            current: connected ? 'connected' : 'disconnected',
          },
        });
      }
      if (!('graph' in item)) {
        continue;
      }
      const previousHealth = this.health.get(sourceId);
      const next = new Map<string, string>();
      for (const node of item.graph.nodes) {
        const identity = workloadIdentity(node);
        const entityId = identity.workload!.entityId;
        next.set(entityId, node.health);
        const old = previousHealth?.get(entityId);
        if (
          old !== undefined &&
          old !== node.health &&
          ['healthy', 'unhealthy'].includes(node.health)
        ) {
          this.emit({
            ...identity,
            sourceId,
            family: 'health',
            type: 'transition',
            eventType: `health.${node.health}`,
            time: collection.collectedAt,
            data: {
              message: `${node.name} is ${node.health}`,
              previous: old,
              current: node.health,
            },
          });
        }
      }
      this.health.set(sourceId, next);
    }
  }
}
