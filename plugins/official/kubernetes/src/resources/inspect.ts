import { V1Container, V1EnvVar, V1Pod, V1Volume } from '@kubernetes/client-node';
import { ContainerInspect } from 'dockscope';
import { KubeClient } from '../client';
import { PodRef, readPod } from './pods';

/**
 * Render an env var as the `KEY=value` line the Env tab expects.
 *
 * A Kubernetes env var is often a reference rather than a literal. Resolving
 * those would mean reading the Secret itself, so the reference is shown
 * instead: it tells you where the value comes from, which is the thing you
 * need when debugging, without pulling secret material into the UI.
 */
export function formatEnvVar(env: V1EnvVar): string {
  if (env.value !== undefined) {
    return `${env.name}=${env.value}`;
  }

  const from = env.valueFrom;
  if (from?.secretKeyRef) {
    return `${env.name}=<secret:${from.secretKeyRef.name}/${from.secretKeyRef.key}>`;
  }
  if (from?.configMapKeyRef) {
    return `${env.name}=<configMap:${from.configMapKeyRef.name}/${from.configMapKeyRef.key}>`;
  }
  if (from?.fieldRef) {
    return `${env.name}=<field:${from.fieldRef.fieldPath}>`;
  }
  if (from?.resourceFieldRef) {
    return `${env.name}=<resource:${from.resourceFieldRef.resource}>`;
  }
  return `${env.name}=`;
}

/** Whole-source imports, which have no individual keys to list. */
function envFromLines(container: V1Container): string[] {
  return (container.envFrom || []).map((source) => {
    if (source.secretRef) {
      return `<envFrom secret:${source.secretRef.name}>`;
    }
    if (source.configMapRef) {
      return `<envFrom configMap:${source.configMapRef.name}>`;
    }
    return '<envFrom unknown>';
  });
}

/** The kind of storage backing a volume, for the mount's `type` column. */
export function volumeType(volume: V1Volume | undefined): string {
  if (!volume) {
    return 'volume';
  }
  const kind = Object.keys(volume).find((key) => key !== 'name');
  if (!kind) {
    return 'volume';
  }
  return kind === 'persistentVolumeClaim' ? 'pvc' : kind;
}

/** What a volume points at, for the mount's `source` column. */
function volumeSource(volume: V1Volume | undefined, fallback: string): string {
  if (!volume) {
    return fallback;
  }
  if (volume.persistentVolumeClaim) {
    return volume.persistentVolumeClaim.claimName;
  }
  if (volume.configMap) {
    return volume.configMap.name || fallback;
  }
  if (volume.secret) {
    return volume.secret.secretName || fallback;
  }
  if (volume.hostPath) {
    return volume.hostPath.path;
  }
  return fallback;
}

export function podInspect(pod: V1Pod, id: string): ContainerInspect {
  const containers = pod.spec?.containers || [];
  const volumes = pod.spec?.volumes || [];
  const volumesByName = new Map(volumes.map((volume) => [volume.name, volume]));

  // A pod's node is the pod, not one container, so a sidecar pod's values are
  // aggregated. The container name only prefixes keys when there is more than
  // one, so the common single-container case stays clean.
  const multiple = containers.length > 1;
  const env: string[] = [];
  const mounts: ContainerInspect['mounts'] = [];
  const seenMounts = new Set<string>();

  for (const container of containers) {
    const prefix = multiple ? `${container.name}/` : '';

    for (const variable of container.env || []) {
      env.push(`${prefix}${formatEnvVar(variable)}`);
    }
    for (const line of envFromLines(container)) {
      env.push(multiple ? `${prefix}${line}` : line);
    }

    for (const mount of container.volumeMounts || []) {
      const volume = volumesByName.get(mount.name);
      const entry = {
        type: volumeType(volume),
        source: volumeSource(volume, mount.name),
        destination: mount.mountPath,
        mode: mount.readOnly ? 'ro' : 'rw',
      };
      // Sidecars routinely mount the same volume; list it once.
      const key = `${entry.type}:${entry.source}:${entry.destination}:${entry.mode}`;
      if (!seenMounts.has(key)) {
        seenMounts.add(key);
        mounts.push(entry);
      }
    }
  }

  const primary = containers[0];

  return {
    id,
    env,
    labels: pod.metadata?.labels || {},
    mounts,
    // Pods use Always/OnFailure/Never; Docker's field is lowercase and the
    // sidebar hides the value when it reads "no".
    restartPolicy: pod.spec?.restartPolicy || 'Always',
    entrypoint: primary?.command ?? null,
    cmd: primary?.args ?? null,
    workingDir: primary?.workingDir || '',
    created: pod.metadata?.creationTimestamp
      ? new Date(pod.metadata.creationTimestamp).toISOString()
      : '',
  };
}

export async function inspectPod(
  client: KubeClient,
  ref: PodRef,
  id: string,
): Promise<ContainerInspect> {
  return podInspect(await readPod(client, ref), id);
}
