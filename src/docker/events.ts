import { shortId } from '../utils.js';
import type { DockerEvent } from '../types.js';
import { getDefaultDockerClient } from './connection.js';
import type Dockerode from 'dockerode';

export function watchEvents(
  callback: (event: DockerEvent) => void,
  onError?: (err: Error) => void,
  client: Dockerode = getDefaultDockerClient(),
  host = 'local',
  onClose?: () => void,
): () => void {
  let destroyed = false;
  let stream: NodeJS.ReadableStream | null = null;
  let closed = false;

  const destroyStream = (target: NodeJS.ReadableStream | null | undefined) => {
    const destroy = (target as (NodeJS.ReadableStream & { destroy?: () => void }) | null)?.destroy;
    destroy?.call(target);
  };

  const notifyClosed = () => {
    if (!destroyed && !closed) {
      closed = true;
      onClose?.();
    }
  };

  client.getEvents({}, (err, eventStream) => {
    if (err || !eventStream) {
      onError?.(err || new Error('Failed to get event stream'));
      notifyClosed();
      return;
    }
    if (destroyed) {
      destroyStream(eventStream);
      return;
    }
    stream = eventStream;
    eventStream.on('data', (chunk: Buffer) => {
      try {
        const raw = JSON.parse(chunk.toString());
        const containerId = raw.Actor?.ID || raw.id || '';
        const actor =
          raw.Actor?.Attributes?.name ||
          raw.Actor?.Attributes?.['com.docker.compose.service'] ||
          shortId(containerId) ||
          'unknown';
        callback({
          id: shortId(containerId),
          containerId,
          project: raw.Actor?.Attributes?.['com.docker.compose.project'],
          host,
          type: raw.Type || 'unknown',
          action: raw.Action || raw.status || 'unknown',
          actor,
          time: raw.time || Math.floor(Date.now() / 1000),
          message: `${host} ${raw.Type || ''} ${raw.Action || ''}: ${actor}`,
        });
      } catch {
        /* ignore */
      }
    });
    eventStream.on('error', (e: Error) => {
      onError?.(e);
      notifyClosed();
    });
    eventStream.on('end', notifyClosed);
    eventStream.on('close', notifyClosed);
  });

  return () => {
    destroyed = true;
    destroyStream(stream);
  };
}
