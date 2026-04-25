import { WebSocket, WebSocketServer } from 'ws';
import { createExecSession, streamContainerLogs } from '../docker/client.js';
import type { GraphData } from '../types.js';
import { parseInboundWSMessage } from './wsMessages.js';
import type { InboundWSMessage } from './wsMessages.js';

type WSHandler<T extends InboundWSMessage = InboundWSMessage> = (
  ws: WebSocket,
  msg: T,
) => Promise<void> | void;
type WSHandlers = {
  [T in InboundWSMessage['type']]: WSHandler<Extract<InboundWSMessage, { type: T }>>;
};

interface WebSocketOptions {
  getGraph(): GraphData;
}

export function setupWebSocketHandlers(wss: WebSocketServer, opts: WebSocketOptions): void {
  const clientLogStreams = new Map<WebSocket, () => void>();
  const clientExecStreams = new Map<WebSocket, NodeJS.ReadWriteStream>();

  function stopLogStream(ws: WebSocket) {
    clientLogStreams.get(ws)?.();
    clientLogStreams.delete(ws);
  }

  function stopExecStream(ws: WebSocket) {
    const execStream = clientExecStreams.get(ws);
    if (execStream) {
      (execStream as any).destroy?.();
    }
    clientExecStreams.delete(ws);
  }

  const wsHandlers: WSHandlers = {
    subscribe_logs: (ws, msg) => {
      stopLogStream(ws);
      const stop = streamContainerLogs(
        msg.data.containerId,
        (text) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'log_chunk',
                data: { containerId: msg.data.containerId, text },
              }),
            );
          }
        },
        (err) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'error',
                data: { message: `Log stream error: ${err.message}` },
              }),
            );
          }
        },
      );
      clientLogStreams.set(ws, stop);
    },
    unsubscribe_logs: (ws) => {
      stopLogStream(ws);
    },
    exec_start: async (ws, msg) => {
      stopExecStream(ws);

      try {
        const { stream: execStream } = await createExecSession(
          msg.data.containerId,
          msg.data.cmd || ['/bin/sh'],
        );
        clientExecStreams.set(ws, execStream);

        // Pipe exec stdout → WS
        execStream.on('data', (chunk: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({ type: 'exec_output', data: { text: chunk.toString('utf-8') } }),
            );
          }
        });

        execStream.on('end', () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'exec_exit' }));
          }
          clientExecStreams.delete(ws);
        });
      } catch (err: any) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({ type: 'error', data: { message: `Exec failed: ${err.message}` } }),
          );
        }
      }
    },
    exec_input: (ws, msg) => {
      const execStream = clientExecStreams.get(ws);
      if (execStream) {
        execStream.write(msg.data.text);
      }
    },
    exec_resize: () => {
      // Resize is handled at the TTY level — not directly supported via dockerode exec stream
      // but the terminal will still work, just without dynamic resize.
    },
    exec_stop: (ws) => {
      stopExecStream(ws);
    },
  };

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'graph', data: opts.getGraph() }));

    ws.on('message', async (raw) => {
      try {
        const msg = parseInboundWSMessage(raw.toString());
        if (!msg) {
          return;
        }

        await (wsHandlers[msg.type] as WSHandler)(ws, msg);
      } catch {
        /* ignore */
      }
    });

    ws.on('close', () => {
      stopLogStream(ws);
      stopExecStream(ws);
    });
  });
}
