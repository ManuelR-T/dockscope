import { EntityActionDeclaration, EntityRef, PluginConfig } from 'dockscope';
import { isWorkloadKind, parseResourceId } from '../utils';
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

export function entityActions(ref: EntityRef): EntityActionDeclaration[] {
  const resource = parseResourceId(ref.entityId);
  const name = ref.context?.name || resource.name;
  const fullName = `${resource.namespace}/${resource.name}`;
  const actions: EntityActionDeclaration[] = [];

  // Restart is offered on controllers only. There is no such thing as
  // restarting a pod in Kubernetes: deleting one just has its ReplicaSet make
  // an identical replacement. Rolling the controller's pod template is the
  // operation users actually mean.
  if (isWorkloadKind(resource.kind)) {
    actions.push({
      id: 'restart',
      title: 'Restart',
      capability: 'action.lifecycle',
      icon: 'restart',
      placement: 'primary',
      confirm: {
        title: `Restart ${resource.kind}`,
        message: `Roll out fresh pods for ${fullName}? Kubernetes replaces them gradually.`,
        confirmLabel: 'Restart',
        variant: 'warning',
      },
    });
  }

  if (resource.kind === 'deployment' || resource.kind === 'statefulset') {
    actions.push({
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
    });
  }

  if (resource.kind === 'hpa') {
    actions.push({
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
    });
  }
  actions.push({
    id: 'delete',
    title: 'Delete',
    capability: 'action.lifecycle',
    icon: 'trash',
    tone: 'danger',
    effect: 'remove',
    confirm: {
      title: `Delete ${resource.kind}`,
      message: `Delete ${fullName}? This removes the Kubernetes ${resource.kind} resource.`,
      confirmLabel: 'Delete',
      variant: 'danger',
      typeToConfirm: name,
    },
  });
  return actions;
}

async function deleteResource(
  client: KubeClient,
  resource: { kind: string; namespace: string; name: string },
) {
  const { kind, name, namespace } = resource;
  if (isWorkloadKind(kind)) {
    return deleteWorkload(client, { ...resource, kind });
  }
  if (kind === 'pod') {
    return deletePod(client, name, namespace);
  } else if (kind === 'hpa') {
    return deleteHpa(client, name, namespace);
  } else if (kind === 'service') {
    return deleteService(client, name, namespace);
  } else if (kind === 'ingress') {
    return deleteIngress(client, name, namespace);
  }
}

export type ActionsOptions = Partial<HpaActionOptions> & { replicas?: number };

const SUPPORTED_ACTIONS = ['delete', 'restart', 'scale', 'set_hpa_constraints'];

export async function runResourceAction(
  client: KubeClient,
  resourceId: string,
  action: string,
  options?: ActionsOptions & PluginConfig,
) {
  const resource = parseResourceId(resourceId);
  if (!SUPPORTED_ACTIONS.includes(action)) {
    throw new Error(`Unsupported Kubernetes action: ${action}`);
  }

  if (action === 'set_hpa_constraints') {
    if (resource.kind !== 'hpa') {
      throw new Error('Only HPA resources can have replica constraints changed');
    }
    if (!options) {
      throw new Error('Missing options');
    }
    await hpaPatch(client, resource.name, resource.namespace, options);
    return;
  }

  if (action === 'restart') {
    if (!isWorkloadKind(resource.kind)) {
      throw new Error(
        `Only Deployments, StatefulSets and DaemonSets can be restarted, not a ${resource.kind}`,
      );
    }
    await restartWorkload(client, { ...resource, kind: resource.kind });
    return;
  }

  if (action === 'scale') {
    if (resource.kind !== 'deployment' && resource.kind !== 'statefulset') {
      throw new Error(`Only Deployments and StatefulSets can be scaled, not a ${resource.kind}`);
    }
    const replicas = options?.replicas;
    if (typeof replicas !== 'number' || !Number.isInteger(replicas) || replicas < 0) {
      throw new Error('Replicas must be a non-negative whole number');
    }
    await scaleWorkload(client, { ...resource, kind: resource.kind }, replicas);
    return;
  }

  await deleteResource(client, resource);
}
