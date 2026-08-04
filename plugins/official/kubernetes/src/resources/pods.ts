import { Writable } from 'stream';
import { V1Pod } from '@kubernetes/client-node';
import { KubeClient } from '../client';
import { LogsOptions } from 'dockscope';

export interface PodRef {
  namespace: string;
  name: string;
}

// Takes the parsed resource rather than two positional strings: `name` and
// `namespace` are both plain strings, so a swapped call site type-checks
// cleanly. It was swapped, and every pod answered "Pod not found."
export async function readPod(client: KubeClient, { namespace, name }: PodRef): Promise<V1Pod> {
  try {
    return await client.coreApi.readNamespacedPod({ namespace, name });
  } catch (error) {
    throw new Error(`Pod ${namespace}/${name} not found.`, { cause: error });
  }
}

/**
 * Logs and exec are per container, but the graph node is the pod. Everything
 * here targets the first container, which is the one a single-container pod
 * has and the primary of a sidecar pod by convention.
 */
export function primaryContainer(pod: V1Pod): string {
  const name = pod.spec?.containers?.[0]?.name;
  if (!name) {
    throw new Error('No container found for pod.');
  }
  return name;
}

export async function getLogsForPod(
  client: KubeClient,
  ref: PodRef,
  options?: LogsOptions,
): Promise<string> {
  const container = primaryContainer(await readPod(client, ref));
  const chunks: Buffer[] = [];

  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    stream.on('error', reject);

    client.logs
      .log(ref.namespace, ref.name, container, stream, {
        tailLines: options?.tail || 200,
        timestamps: true,
      })
      .catch(reject);
  });
}

/**
 * Follow a pod's logs, mirroring the Docker source: a tail of recent history
 * followed by live output, with timestamps so the client can shorten them.
 *
 * Returns the teardown the host calls when the viewer closes the tab. The
 * AbortController is what actually ends the HTTP request; without aborting it
 * the connection would outlive the subscription.
 */
export async function streamPodLogs(
  client: KubeClient,
  ref: PodRef,
  onData: (text: string) => void,
  onError?: (error: Error) => void,
): Promise<() => void> {
  const container = primaryContainer(await readPod(client, ref));
  let stopped = false;

  const stream = new Writable({
    write(chunk, encoding, callback) {
      if (!stopped) {
        onData(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      }
      callback();
    },
  });

  stream.on('error', (error: Error) => onError?.(error));

  const controller = await client.logs.log(ref.namespace, ref.name, container, stream, {
    follow: true,
    tailLines: 100,
    timestamps: true,
  });

  return () => {
    // Aborting is not instantaneous, so the flag suppresses any chunk that
    // lands between teardown and the request actually ending.
    stopped = true;
    controller.abort();
  };
}
