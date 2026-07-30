import { Writable } from 'stream';
import { KubeClient } from '../client';
import { LogsOptions } from 'dockscope';

export async function getLogsForPod(
  client: KubeClient,
  name: string,
  namespace: string,
  options?: LogsOptions,
): Promise<string> {
  const chunks: Buffer[] = [];

  const pod = await client.coreApi
    .listNamespacedPod({
      namespace,
    })
    .then((l) => {
      return l.items.filter((p) => p.metadata?.name === name);
    });

  if (pod.length !== 1) {
    throw new Error('Pod not found.');
  }

  const containers = pod[0]!.spec?.containers;

  if (!containers || containers?.length === 0) {
    throw new Error('No container found for pod.');
  }

  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      const fullLogs = Buffer.concat(chunks).toString('utf8');
      resolve(fullLogs);
    });

    stream.on('error', reject);

    client.logs
      .log(namespace, name, containers[0]!.name, stream, {
        tailLines: options?.tail || 200,
      })
      .catch(reject);
  });
}
