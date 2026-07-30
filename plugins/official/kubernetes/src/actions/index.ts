import { EntityActionDeclaration, EntityRef, PluginConfig } from 'dockscope';
import { parseResourceId } from '../utils';
import { KubeClient } from '../client';
import { deleteHpa, HpaActionOptions, hpaPatch } from './hpa';
import { deleteService } from './service';
import { deletePod } from './pod';
import { deleteIngress } from './ingress';

function numericMetadata(ref: EntityRef, key: string, fallback: number): number {
  const value = ref.context?.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function entityActions(ref: EntityRef): EntityActionDeclaration[] {
  const resource = parseResourceId(ref.entityId);
  const name = ref.context?.name || resource.name;
  const fullName = `${resource.namespace}/${resource.name}`;
  const actions: EntityActionDeclaration[] = [
    // Currently disabled as you cannot do that in kubernetes, it does not work like this, deployments need to be handled for this to work
    // {
    //   id: 'restart',
    //   title: 'Restart',
    //   capability: 'action.lifecycle',
    //   icon: 'restart',
    //   placement: 'primary',
    //   confirm: {
    //     title: resource.kind === 'pod' ? 'Restart Pod' : 'Restart Backing Pods',
    //     message:
    //       resource.kind === 'pod'
    //         ? `Restart pod ${name}? Kubernetes will recreate the current pod.`
    //         : `Restart backing pods for ${fullName}? Kubernetes will recreate the selected pods.`,
    //     confirmLabel: 'Restart',
    //     variant: 'warning',
    //   },
    // },
  ];
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
  { kind, name, namespace }: { kind: string; namespace: string; name: string },
) {
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

export type ActionsOptions = Partial<HpaActionOptions>;

export async function runResourceAction(
  client: KubeClient,
  resourceId: string,
  action: string,
  options?: ActionsOptions & PluginConfig,
) {
  const resource = parseResourceId(resourceId);
  if (!['delete', /*'restart',*/ 'set_hpa_constraints'].includes(action)) {
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
  // Currently disabled as you cannot do that in kubernetes, it does not work like this, deployments need to be handled for this to work
  //   if (action === 'restart') {
  //     const resources = await listResources(host);
  //     const pods = podsForRestart(resources, resource);
  //     if (pods.length === 0) {
  //       throw new Error(`No backing pods found for ${resource.kind} "${resource.name}"`);
  //     }
  //     await Promise.all(
  //       pods.map((pod) =>
  //         kubectl(host, ['delete', 'pod', nameOf(pod.metadata), '-n', namespaceOf(pod.metadata)]),
  //       ),
  //     );
  //     return;
  //   }
  await deleteResource(client, resource);
}
