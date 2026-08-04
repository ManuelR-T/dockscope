import {
  V1DaemonSet,
  V1Deployment,
  V1OwnerReference,
  V1Pod,
  V1ReplicaSet,
  V1StatefulSet,
  V2HorizontalPodAutoscaler,
} from '@kubernetes/client-node';
import { Resources } from './index';

export type WorkloadKind = 'deployment' | 'statefulset' | 'daemonset';

/** The three controller kinds we draw, keyed by their Kubernetes `kind` string. */
const WORKLOAD_KINDS: Record<string, WorkloadKind> = {
  Deployment: 'deployment',
  StatefulSet: 'statefulset',
  DaemonSet: 'daemonset',
};

export interface WorkloadRef {
  kind: WorkloadKind;
  namespace: string;
  name: string;
}

/**
 * A Deployment, StatefulSet or DaemonSet reduced to what the graph needs, so
 * the rest of the plugin does not branch on three near-identical API types.
 */
export interface Workload extends WorkloadRef {
  desired: number;
  ready: number;
  /** The controller's own `kind`, e.g. "Deployment", for labels and actions. */
  apiKind: string;
  images: string[];
}

function meta(resource: { metadata?: { namespace?: string; name?: string } }) {
  return {
    namespace: resource.metadata?.namespace || 'default',
    name: resource.metadata?.name || 'unknown',
  };
}

function images(template?: { spec?: { containers?: { image?: string }[] } }): string[] {
  return (template?.spec?.containers || [])
    .map((container) => container.image)
    .filter((image): image is string => Boolean(image));
}

function fromDeployment(deployment: V1Deployment): Workload {
  return {
    ...meta(deployment),
    kind: 'deployment',
    apiKind: 'Deployment',
    desired: deployment.spec?.replicas ?? 0,
    ready: deployment.status?.readyReplicas ?? 0,
    images: images(deployment.spec?.template),
  };
}

function fromStatefulSet(statefulSet: V1StatefulSet): Workload {
  return {
    ...meta(statefulSet),
    kind: 'statefulset',
    apiKind: 'StatefulSet',
    desired: statefulSet.spec?.replicas ?? 0,
    ready: statefulSet.status?.readyReplicas ?? 0,
    images: images(statefulSet.spec?.template),
  };
}

function fromDaemonSet(daemonSet: V1DaemonSet): Workload {
  return {
    ...meta(daemonSet),
    kind: 'daemonset',
    apiKind: 'DaemonSet',
    // A DaemonSet's "replicas" is however many nodes it should run on.
    desired: daemonSet.status?.desiredNumberScheduled ?? 0,
    ready: daemonSet.status?.numberReady ?? 0,
    images: images(daemonSet.spec?.template),
  };
}

export function listWorkloads(resources: Resources): Workload[] {
  return [
    ...resources.deployments.items.map(fromDeployment),
    ...resources.statefulSets.items.map(fromStatefulSet),
    ...resources.daemonSets.items.map(fromDaemonSet),
  ];
}

export function workloadKey({ kind, namespace, name }: WorkloadRef): string {
  return `${kind}/${namespace}/${name}`;
}

function controllerOf(
  resource: { metadata?: { ownerReferences?: V1OwnerReference[] } } | undefined,
): V1OwnerReference | undefined {
  const owners = resource?.metadata?.ownerReferences || [];
  // `controller: true` marks the single managing owner; other entries are
  // merely related. Fall back to the first owner for hand-written manifests
  // that omit the flag.
  return owners.find((owner) => owner.controller) || owners[0];
}

/**
 * Resolve the workload a pod ultimately belongs to.
 *
 * A Deployment does not own its pods directly: it owns a ReplicaSet per
 * revision, and the ReplicaSet owns the pods. This walks that second hop so
 * pods attach to the Deployment a user actually thinks in terms of.
 *
 * Returns undefined for pods with no controller (bare pods) and for pods owned
 * by something we do not draw, such as the static control-plane pods that are
 * owned by their Node, or Jobs.
 */
export function resolvePodOwner(pod: V1Pod, replicaSets: V1ReplicaSet[]): WorkloadRef | undefined {
  const namespace = pod.metadata?.namespace || 'default';
  const owner = controllerOf(pod);
  if (!owner?.name) {
    return undefined;
  }

  if (owner.kind === 'ReplicaSet') {
    const replicaSet = replicaSets.find(
      (candidate) =>
        candidate.metadata?.name === owner.name &&
        (candidate.metadata?.namespace || 'default') === namespace,
    );
    const parent = controllerOf(replicaSet);
    // An orphaned ReplicaSet (its Deployment was deleted) leaves the pod with
    // nothing drawable to attach to.
    if (!parent?.name || !WORKLOAD_KINDS[parent.kind]) {
      return undefined;
    }
    return { kind: WORKLOAD_KINDS[parent.kind]!, namespace, name: parent.name };
  }

  const kind = WORKLOAD_KINDS[owner.kind];
  return kind ? { kind, namespace, name: owner.name } : undefined;
}

/**
 * The workload an autoscaler scales.
 *
 * scaleTargetRef names the controller directly, which is what the HPA edge
 * should point at. Linking the HPA to pods instead made the graph claim it
 * "scales Deployment" while pointing at something that was not one.
 */
export function resolveHpaTarget(hpa: V2HorizontalPodAutoscaler): WorkloadRef | undefined {
  const target = hpa.spec?.scaleTargetRef;
  if (!target?.name) {
    return undefined;
  }
  const kind = WORKLOAD_KINDS[target.kind];
  return kind
    ? { kind, namespace: hpa.metadata?.namespace || 'default', name: target.name }
    : undefined;
}
