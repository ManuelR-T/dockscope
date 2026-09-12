import { EntityActionDeclaration, EntityRef, PluginConfig } from 'dockscope';
import {
  isWorkloadKind,
  parseResourceId,
  RESOURCE_KINDS,
  WORKLOAD_KINDS,
  type ResourceKind,
} from '../utils';
import { KubeClient } from '../client';
import { deleteHpa, HpaActionOptions, hpaPatch } from './hpa';
import { deleteService } from './service';
import { deletePod } from './pod';
import { deleteIngress } from './ingress';
import { deleteWorkload, restartWorkload, scaleWorkload } from './workload';

function numericMetadata(ref: EntityRef, key: string, fallback: number): number {
  const value = ref.context?.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

type Resource = ReturnType<typeof parseResourceId>;
export type ActionsOptions = Partial<HpaActionOptions> & { replicas?: number };

interface ActionDefinition {
  kinds: readonly ResourceKind[];
  declaration: (ref: EntityRef, resource: Resource) => EntityActionDeclaration;
  execute: (
    client: KubeClient,
    resource: Resource,
    options?: ActionsOptions & PluginConfig,
  ) => Promise<void>;
}

type DeleteResource = (client: KubeClient, resource: Resource) => Promise<unknown>;

const RESOURCE_DELETERS: Record<ResourceKind, DeleteResource> = {
  deployment: (client, resource) => deleteWorkload(client, { ...resource, kind: 'deployment' }),
  statefulset: (client, resource) => deleteWorkload(client, { ...resource, kind: 'statefulset' }),
  daemonset: (client, resource) => deleteWorkload(client, { ...resource, kind: 'daemonset' }),
  pod: (client, { name, namespace }) => deletePod(client, name, namespace),
  hpa: (client, { name, namespace }) => deleteHpa(client, name, namespace),
  service: (client, { name, namespace }) => deleteService(client, name, namespace),
  ingress: (client, { name, namespace }) => deleteIngress(client, name, namespace),
};

// Insertion order is the order presented in the UI. Each action owns both
// its declaration and execution; unknown action names never resolve via a prototype.
const ACTIONS = new Map<string, ActionDefinition>([
  // Restart is offered on controllers only. There is no such thing as
  // restarting a pod in Kubernetes: deleting one just has its ReplicaSet make
  // an identical replacement. Rolling the controller's pod template is the
  // operation users actually mean.
  [
    'restart',
    {
      kinds: WORKLOAD_KINDS,
      declaration: (_ref, resource) => ({
        id: 'restart',
        title: 'Restart',
        capability: 'action.lifecycle',
        icon: 'restart',
        placement: 'primary',
        confirm: {
          title: `Restart ${resource.kind}`,
          message: `Roll out fresh pods for ${resource.namespace}/${resource.name}? Kubernetes replaces them gradually.`,
          confirmLabel: 'Restart',
          variant: 'warning',
        },
      }),
      execute: async (client, resource) => {
        if (!isWorkloadKind(resource.kind)) {
          throw new Error(
            `Only Deployments, StatefulSets and DaemonSets can be restarted, not a ${resource.kind}`,
          );
        }
        await restartWorkload(client, { ...resource, kind: resource.kind });
      },
    },
  ],
  [
    'scale',
    {
      kinds: ['deployment', 'statefulset'],
      declaration: (ref) => ({
        id: 'scale',
        title: 'Scale',
        capability: 'action.scale',
        icon: 'scale',
        input: {
          fields: [
            {
              key: 'replicas',
              label: 'Replicas',
              type: 'number',
              required: true,
              default: numericMetadata(ref, 'desiredReplicas', 1),
            },
          ],
        },
      }),
      execute: async (client, resource, options) => {
        if (resource.kind !== 'deployment' && resource.kind !== 'statefulset') {
          throw new Error(
            `Only Deployments and StatefulSets can be scaled, not a ${resource.kind}`,
          );
        }
        const replicas = options?.replicas;
        if (typeof replicas !== 'number' || !Number.isInteger(replicas) || replicas < 0) {
          throw new Error('Replicas must be a non-negative whole number');
        }
        await scaleWorkload(client, { ...resource, kind: resource.kind }, replicas);
      },
    },
  ],
  [
    'set_hpa_constraints',
    {
      kinds: ['hpa'],
      declaration: (ref) => ({
        id: 'set_hpa_constraints',
        title: 'Set replica bounds',
        capability: 'action.scale',
        icon: 'scale',
        input: {
          fields: [
            {
              key: 'minReplicas',
              label: 'Min replicas',
              type: 'number',
              required: true,
              default: numericMetadata(ref, 'minReplicas', 1),
            },
            {
              key: 'maxReplicas',
              label: 'Max replicas',
              type: 'number',
              required: true,
              default: numericMetadata(ref, 'maxReplicas', 1),
            },
          ],
        },
      }),
      execute: async (client, resource, options) => {
        if (resource.kind !== 'hpa') {
          throw new Error('Only HPA resources can have replica constraints changed');
        }
        if (!options) {
          throw new Error('Missing options');
        }
        await hpaPatch(client, resource.name, resource.namespace, options);
      },
    },
  ],
  [
    'delete',
    {
      kinds: RESOURCE_KINDS,
      declaration: (ref, resource) => ({
        id: 'delete',
        title: 'Delete',
        capability: 'action.lifecycle',
        icon: 'trash',
        tone: 'danger',
        effect: 'remove',
        confirm: {
          title: `Delete ${resource.kind}`,
          message: `Delete ${resource.namespace}/${resource.name}? This removes the Kubernetes ${resource.kind} resource.`,
          confirmLabel: 'Delete',
          variant: 'danger',
          typeToConfirm: ref.context?.name || resource.name,
        },
      }),
      execute: async (client, resource) => {
        await RESOURCE_DELETERS[resource.kind](client, resource);
      },
    },
  ],
]);

export function entityActions(ref: EntityRef): EntityActionDeclaration[] {
  const resource = parseResourceId(ref.entityId);
  return [...ACTIONS.values()]
    .filter(({ kinds }) => kinds.includes(resource.kind))
    .map(({ declaration }) => declaration(ref, resource));
}

export async function runResourceAction(
  client: KubeClient,
  resourceId: string,
  action: string,
  options?: ActionsOptions & PluginConfig,
) {
  const resource = parseResourceId(resourceId);
  const definition = ACTIONS.get(action);
  if (!definition) {
    throw new Error(`Unsupported Kubernetes action: ${action}`);
  }

  await definition.execute(client, resource, options);
}
