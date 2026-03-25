import Dockerode from 'dockerode';

const DEMUX_HEADER_SIZE = 8;

/** Demux Docker log buffer (handles both multiplexed and TTY formats) */
export function demuxLogBuffer(buffer: Buffer): string {
  if (buffer.length >= DEMUX_HEADER_SIZE && buffer[0] !== undefined && buffer[0] <= 2) {
    const lines: string[] = [];
    let offset = 0;
    while (offset + DEMUX_HEADER_SIZE <= buffer.length) {
      const size = buffer.readUInt32BE(offset + 4);
      offset += DEMUX_HEADER_SIZE;
      if (offset + size > buffer.length) break;
      lines.push(buffer.subarray(offset, offset + size).toString('utf-8'));
      offset += size;
    }
    return lines.join('');
  }
  return buffer.toString('utf-8');
}

export async function getContainerLogs(
  docker: Dockerode,
  containerId: string,
  tail: number = 200,
): Promise<string> {
  const container = docker.getContainer(containerId);
  const logBuffer = await container.logs({
    stdout: true,
    stderr: true,
    tail,
    follow: false,
    timestamps: true,
  });
  const buf = Buffer.isBuffer(logBuffer) ? logBuffer : Buffer.from(logBuffer as any);
  return demuxLogBuffer(buf);
}

export function streamContainerLogs(
  docker: Dockerode,
  containerId: string,
  onData: (text: string) => void,
  onError?: (err: Error) => void,
): () => void {
  let destroyed = false;
  let logStream: NodeJS.ReadableStream | null = null;

  const container = docker.getContainer(containerId);
  container.logs(
    { stdout: true, stderr: true, tail: 100, follow: true, timestamps: true },
    (err: any, stream: any) => {
      if (err || !stream) {
        onError?.(err || new Error('Failed to get log stream'));
        return;
      }
      if (destroyed) {
        stream.destroy?.();
        return;
      }
      logStream = stream;
      stream.on('data', (chunk: Buffer) => {
        const text = demuxLogBuffer(chunk);
        if (text) onData(text);
      });
      stream.on('error', (e: Error) => onError?.(e));
    },
  );

  return () => {
    destroyed = true;
    (logStream as any)?.destroy?.();
  };
}
