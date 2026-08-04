import { EventEmitter } from 'events';
import { Writable } from 'stream';
import { describe, expect, it, vi } from 'vitest';
import type { V1Status } from '@kubernetes/client-node';
import type { KubeClient } from '../client';
import { DEFAULT_EXEC_COMMAND, createPodExecSession, exitCodeOf } from '../resources/exec';

/**
 * The host drives exec as one duplex stream, Kubernetes wants three. These
 * pin down the adaptation: writes reach stdin, container output surfaces as
 * readable data, and the session ends when the socket does.
 */

describe('exitCodeOf', () => {
  it('reads success as 0', () => {
    expect(exitCodeOf({ status: 'Success' } as V1Status)).toBe(0);
  });

  it('digs the code out of the failure causes', () => {
    expect(
      exitCodeOf({
        status: 'Failure',
        details: { causes: [{ reason: 'ExitCode', message: '137' }] },
      } as V1Status),
    ).toBe(137);
  });

  it('falls back to 1 when the failure carries no code', () => {
    expect(exitCodeOf({ status: 'Failure' } as V1Status)).toBe(1);
  });
});

interface ExecCall {
  namespace: string;
  name: string;
  container: string;
  command: string | string[];
  stderr: Writable | null;
  tty: boolean;
}

function fakeClient() {
  const socket = Object.assign(new EventEmitter(), { close: vi.fn() });
  const calls: ExecCall[] = [];
  let stdoutStream: Writable | null = null;
  let statusCallback: ((status: V1Status) => void) | undefined;
  const stdinChunks: string[] = [];

  const client = {
    coreApi: {
      readNamespacedPod: vi.fn(async () => ({
        metadata: { namespace: 'default', name: 'web' },
        spec: { containers: [{ name: 'nginx' }] },
      })),
    },
    exec: {
      exec: vi.fn(
        async (
          namespace: string,
          name: string,
          container: string,
          command: string | string[],
          stdout: Writable | null,
          stderr: Writable | null,
          stdin: NodeJS.ReadableStream | null,
          tty: boolean,
          onStatus?: (status: V1Status) => void,
        ) => {
          calls.push({ namespace, name, container, command, stderr, tty });
          stdoutStream = stdout;
          statusCallback = onStatus;
          stdin?.on('data', (chunk: Buffer) => stdinChunks.push(chunk.toString('utf8')));
          return socket;
        },
      ),
    },
  } as unknown as KubeClient;

  return {
    client,
    socket,
    calls,
    stdinChunks,
    writeStdout: (text: string) => stdoutStream?.write(Buffer.from(text)),
    finish: (status: V1Status) => statusCallback?.(status),
  };
}

const ref = { namespace: 'default', name: 'web' };

describe('createPodExecSession', () => {
  it('opens a TTY shell in the pod primary container', async () => {
    const { client, calls } = fakeClient();

    await createPodExecSession(client, ref);

    expect(calls[0]).toMatchObject({
      namespace: 'default',
      name: 'web',
      container: 'nginx',
      command: DEFAULT_EXEC_COMMAND,
      tty: true,
      // The API rejects a separate stderr stream in TTY mode; a terminal
      // multiplexes both onto stdout.
      stderr: null,
    });
  });

  it('honours an explicit command', async () => {
    const { client, calls } = fakeClient();
    await createPodExecSession(client, ref, ['/bin/bash', '-l']);
    expect(calls[0]!.command).toEqual(['/bin/bash', '-l']);
  });

  it('forwards what the host writes to the container stdin', async () => {
    const { client, stdinChunks } = fakeClient();

    const session = await createPodExecSession(client, ref);
    session.stream.write('ls -la\n');

    expect(stdinChunks).toEqual(['ls -la\n']);
  });

  it('surfaces container output as readable data', async () => {
    const { client, writeStdout } = fakeClient();
    const session = await createPodExecSession(client, ref);

    const received: string[] = [];
    session.stream.on('data', (chunk: Buffer) => received.push(chunk.toString('utf8')));
    writeStdout('total 0\n');
    await new Promise((resolve) => setImmediate(resolve));

    expect(received).toEqual(['total 0\n']);
  });

  it('ends the stream when the socket closes, which closes the terminal', async () => {
    const { client, socket } = fakeClient();
    const session = await createPodExecSession(client, ref);

    const ended = new Promise((resolve) => session.stream.on('end', resolve));
    session.stream.resume();
    socket.emit('close');

    await expect(ended).resolves.toBeUndefined();
  });

  it('reports running until the command reports its status', async () => {
    const { client, finish } = fakeClient();
    const session = await createPodExecSession(client, ref);

    expect(await session.inspect()).toEqual({ Running: true, ExitCode: 0 });

    finish({ status: 'Failure', details: { causes: [{ reason: 'ExitCode', message: '2' }] } });
    expect(await session.inspect()).toEqual({ Running: false, ExitCode: 2 });
  });

  // A distroless or scratch pod has no shell, so the session dies before
  // printing anything and the terminal would otherwise just go blank.
  it('prints the failure reason when the command could not start', async () => {
    const { client, finish } = fakeClient();
    const session = await createPodExecSession(client, ref);

    const received: string[] = [];
    session.stream.on('data', (chunk: Buffer) => received.push(chunk.toString('utf8')));
    finish({
      status: 'Failure',
      message: 'exec: "/bin/sh": stat /bin/sh: no such file or directory',
    } as V1Status);
    await new Promise((resolve) => setImmediate(resolve));

    expect(received.join('')).toContain('no such file or directory');
  });

  it('stays quiet on a clean exit', async () => {
    const { client, finish } = fakeClient();
    const session = await createPodExecSession(client, ref);

    const received: string[] = [];
    session.stream.on('data', (chunk: Buffer) => received.push(chunk.toString('utf8')));
    finish({ status: 'Success' } as V1Status);
    await new Promise((resolve) => setImmediate(resolve));

    expect(received).toEqual([]);
  });

  it('closes the socket when the host destroys the session', async () => {
    const { client, socket } = fakeClient();
    const session = await createPodExecSession(client, ref);

    session.stream.destroy();
    await new Promise((resolve) => setImmediate(resolve));

    expect(socket.close).toHaveBeenCalled();
    expect(await session.inspect()).toMatchObject({ Running: false });
  });

  it('surfaces a socket error on the stream', async () => {
    const { client, socket } = fakeClient();
    const session = await createPodExecSession(client, ref);

    const failed = new Promise<Error>((resolve) => session.stream.on('error', resolve));
    socket.emit('error', new Error('handshake failed'));

    expect((await failed).message).toBe('handshake failed');
  });
});
