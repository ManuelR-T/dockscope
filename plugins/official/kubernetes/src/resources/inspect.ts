import { V1Container, V1EnvVar, V1EnvVarSource, V1Pod, V1Volume } from '@kubernetes/client-node';
import { ContainerInspect } from 'dockscope';
import { KubeClient } from '../client';
import { PodRef, readPod } from './pods';

// First matching reference wins, including when its rendered value is empty.
const ENV_REFERENCE_FORMATTERS: readonly ((from: V1EnvVarSource) => string | undefined)[] = [
  ({ secretKeyRef: ref }) => (ref ? `<secret:${ref.name}/${ref.key}>` : undefined),
  ({ configMapKeyRef: ref }) => (ref ? `<configMap:${ref.name}/${ref.key}>` : undefined),
  ({ fieldRef: ref }) => (ref ? `<field:${ref.fieldPath}>` : undefined),
  ({ resourceFieldRef: ref }) => (ref ? `<resource:${ref.resource}>` : undefined),
];

const ENV_FROM_SOURCES = [
  { key: 'secretRef', label: 'secret' },
  { key: 'configMapRef', label: 'configMap' },
] as const;

const VOLUME_SOURCE_FORMATTERS: readonly ((
  volume: V1Volume,
  fallback: string,
) => string | undefined)[] = [
  ({ persistentVolumeClaim: source }) => source?.claimName,
  ({ configMap: source }, fallback) => (source ? source.name || fallback : undefined),
  ({ secret: source }, fallback) => (source ? source.secretName || fallback : undefined),
  ({ hostPath: source }) => source?.path,
];

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

  const reference = ENV_REFERENCE_FORMATTERS.map((format) => format(env.valueFrom || {})).find(
    (value) => value !== undefined,
  );
  return `${env.name}=${reference ?? ''}`;
}

/** Whole-source imports, which have no individual keys to list. */
function envFromLines(container: V1Container): string[] {
  return (container.envFrom || []).map((source) => {
    const match = ENV_FROM_SOURCES.find(({ key }) => source[key]);
    return match ? `<envFrom ${match.label}:${source[match.key]?.name}>` : '<envFrom unknown>';
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
  return (
    VOLUME_SOURCE_FORMATTERS.map((format) => format(volume, fallback)).find(
      (value) => value !== undefined,
    ) ?? fallback
  );
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
