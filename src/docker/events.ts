import { shortId } from '../utils.js';
import type { DockerEvent } from '../types.js';
import { getDefaultDockerClient } from './connection.js';

export function watchEvents(
  callback: (event: DockerEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  let destroyed = false;
  let stream: NodeJS.ReadableStream | null = null;

  getDefaultDockerClient().getEvents({}, (err, eventStream) => {
    if (err || !eventStream) {
      onError?.(err || new Error('Failed to get event stream'));
      return;
    }
    if (destroyed) {
      (eventStream as any).destroy?.();
      return;
    }
    stream = eventStream;
    eventStream.on('data', (chunk: Buffer) => {
      try {
        const raw = JSON.parse(chunk.toString());
        callback({
          id: shortId(raw.Actor?.ID || raw.id || ''),
          type: raw.Type || 'unknown',
          action: raw.Action || raw.status || 'unknown',
          actor:
            raw.Actor?.Attributes?.name ||
            raw.Actor?.Attributes?.['com.docker.compose.service'] ||
            shortId(raw.Actor?.ID || '') ||
            'unknown',
          time: raw.time || Math.floor(Date.now() / 1000),
          message: `${raw.Type || ''} ${raw.Action || ''}: ${raw.Actor?.Attributes?.name || shortId(raw.Actor?.ID || '') || ''}`,
        });
      } catch {
        /* ignore */
      }
    });
    eventStream.on('error', (e: Error) => onError?.(e));
  });

  return () => {
    destroyed = true;
    (stream as any)?.destroy?.();
  };
}
