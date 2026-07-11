import { WebSocket, WebSocketServer } from 'ws';
import type { PluginRegistry } from '../core/plugins.js';
import type { EntityRef } from '../core/operations.js';
import type { GraphData } from '../types.js';
import { parseInboundWSMessage } from './wsMessages.js';
import type { InboundWSMessage } from './wsMessages.js';
import { errorMessage } from '../utils.js';

type WSHandler<T extends InboundWSMessage = InboundWSMessage> = (
  ws: WebSocket,
  msg: T,
) => Promise<void> | void;
type WSHandlers = {
  [T in InboundWSMessage['type']]: WSHandler<Extract<InboundWSMessage, { type: T }>>;
};

interface WebSocketOptions {
  getGraph(): GraphData;
  plugins: PluginRegistry;
}

export function setupWebSocketHandlers(wss: WebSocketServer, opts: WebSocketOptions): void {
  const clientLogStreams = new Map<WebSocket, () => void>();
  const clientExecStreams = new Map<WebSocket, NodeJS.ReadWriteStream>();

  function sendError(ws: WebSocket, message: string) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', data: { message } }));
    }
  }

  function entityRef(data: { entityId: string; sourceId?: string; nodeId?: string }): EntityRef {
    return {
      entityId: data.entityId,
      ...(data.sourceId ? { sourceId: data.sourceId } : {}),
      ...(data.nodeId ? { nodeId: data.nodeId } : {}),
    };
  }

  function stopLogStream(ws: WebSocket) {
    clientLogStreams.get(ws)?.();
    clientLogStreams.delete(ws);
  }

  function stopExecStream(ws: WebSocket) {
    const execStream = clientExecStreams.get(ws);
    if (execStream) {
      const destroy = (execStream as NodeJS.ReadWriteStream & { destroy?: () => void }).destroy;
      destroy?.call(execStream);
    }
    clientExecStreams.delete(ws);
  }

  const wsHandlers: WSHandlers = {
    subscribe_logs: async (ws, msg) => {
      stopLogStream(ws);
      const stop = await opts.plugins.streamLogs(
        entityRef(msg.data),
        (text) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'log_chunk',
                data: { entityId: msg.data.entityId, containerId: msg.data.entityId, text },
              }),
            );
          }
        },
        (err) => {
          sendError(ws, `Log stream error: ${err.message}`);
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
        const { stream: execStream } = await opts.plugins.createExecSession(
          entityRef(msg.data),
          msg.data.cmd,
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

        execStream.on('error', (err: Error) => {
          sendError(ws, `Exec stream error: ${err.message}`);
          clientExecStreams.delete(ws);
        });
      } catch (err) {
        sendError(ws, `Exec failed: ${errorMessage(err)}`);
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
      } catch (err) {
        sendError(ws, errorMessage(err) || 'WebSocket command failed');
      }
    });

    ws.on('close', () => {
      stopLogStream(ws);
      stopExecStream(ws);
    });
  });
}
