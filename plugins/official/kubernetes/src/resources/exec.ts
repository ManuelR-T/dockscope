import { Duplex, PassThrough, Writable } from 'stream';
import { V1Status } from '@kubernetes/client-node';
import { EntityExecSession } from 'dockscope';
import { KubeClient } from '../client';
import { PodRef, primaryContainer, readPod } from './pods';

export const DEFAULT_EXEC_COMMAND = ['/bin/sh'];

/**
 * Kubernetes reports the command's exit status through a V1Status rather than
 * a number: success carries no code, and a failure hides it among the causes.
 */
export function exitCodeOf(status: V1Status): number {
  if (status.status === 'Success') {
    return 0;
  }
  const cause = status.details?.causes?.find((entry) => entry.reason === 'ExitCode');
  const code = Number(cause?.message);
  return Number.isInteger(code) ? code : 1;
}

/**
 * Open an interactive shell in a pod's primary container.
 *
 * The host drives this as a single duplex: what it writes is stdin, what it
 * reads is terminal output. Kubernetes instead wants three separate streams,
 * so this adapts between the two. `tty` is on because the client attaches
 * xterm.js, and the API rejects a separate stderr stream in TTY mode -- the
 * terminal multiplexes both onto stdout, which is what a real shell does.
 */
export async function createPodExecSession(
  client: KubeClient,
  ref: PodRef,
  command: string[] = DEFAULT_EXEC_COMMAND,
): Promise<EntityExecSession> {
  const container = primaryContainer(await readPod(client, ref));

  const stdin = new PassThrough();
  let running = true;
  let exitCode = 0;
  // The duplex has to exist before the socket does, because opening the socket
  // needs the output stream that feeds it. This holds the socket the teardown
  // path will need once it arrives.
  const connection: { socket?: { close(): void } } = {};

  const session = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      stdin.write(chunk);
      callback();
    },
    destroy(error, callback) {
      running = false;
      try {
        connection.socket?.close();
      } catch {
        // The socket may already be closing; the session is going away anyway.
      }
      callback(error);
    },
  });

  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      session.push(chunk);
      callback();
    },
  });

  const socket = await client.exec.exec(
    ref.namespace,
    ref.name,
    container,
    command,
    stdout,
    null,
    stdin,
    true,
    (status) => {
      running = false;
      exitCode = exitCodeOf(status);
      // A pod built on a distroless or scratch base has no shell, so the
      // session dies before printing anything and the terminal would just go
      // blank. Kubernetes explains why in the status; show it.
      if (status.status === 'Failure' && status.message) {
        session.push(`${status.message}\r\n`);
      }
    },
  );
  connection.socket = socket;

  const ws = socket as unknown as {
    on(event: string, handler: (arg?: unknown) => void): void;
  };
  ws.on('close', () => {
    running = false;
    // Ends the host's stream, which is what closes the terminal tab.
    session.push(null);
  });
  ws.on('error', (error?: unknown) => {
    running = false;
    session.destroy(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    stream: session,
    inspect: async () => ({ Running: running, ExitCode: exitCode }),
  };
}
