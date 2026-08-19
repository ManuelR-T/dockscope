import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { AccessRole } from '../core/access.js';
import type { PluginRegistry } from '../core/plugin-contract/registry.js';
import type { EntityRef } from '../core/entities/operations.js';
import type { GraphData } from '../types.js';
import { parseInboundWSMessage } from './wsMessages.js';
import type { InboundWSMessage } from './wsMessages.js';
import { errorMessage } from '../utils.js';

type WSHandler<T extends InboundWSMessage = InboundWSMessage> = (
  ws: WebSocket,
  msg: T,
  role: AccessRole,
) => Promise<void> | void;
type WSHandlers = {
  [T in InboundWSMessage['type']]: WSHandler<Extract<InboundWSMessage, { type: T }>>;
};

interface WebSocketOptions {
  getGraph(): GraphData;
  plugins: PluginRegistry;
  accessRole(request: IncomingMessage): AccessRole | undefined;
  registerRole(client: WebSocket, role: AccessRole): void;
  redact(role: AccessRole, value: unknown): unknown;
}

export function setupWebSocketHandlers(wss: WebSocketServer, opts: WebSocketOptions): void {
  const clientLogStreams = new Map<WebSocket, () => void>();
  const clientExecStreams = new Map<WebSocket, NodeJS.ReadWriteStream>();

  function sendJson(ws: WebSocket, role: AccessRole, value: unknown) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(opts.redact(role, value)));
    }
  }

  function sendError(ws: WebSocket, role: AccessRole, message: string) {
    sendJson(ws, role, { type: 'error', data: { message } });
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
    subscribe_logs: async (ws, msg, role) => {
      stopLogStream(ws);
      const stop = await opts.plugins.streamLogs(
        entityRef(msg.data),
        (text) => {
          if (ws.readyState === WebSocket.OPEN) {
            sendJson(ws, role, {
              type: 'log_chunk',
              data: { entityId: msg.data.entityId, containerId: msg.data.entityId, text },
            });
          }
        },
        (err) => {
          sendError(ws, role, `Log stream error: ${err.message}`);
        },
      );
      clientLogStreams.set(ws, stop);
    },
    unsubscribe_logs: (ws) => {
      stopLogStream(ws);
    },
    exec_start: async (ws, msg, role) => {
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
            sendJson(ws, role, {
              type: 'exec_output',
              data: { text: chunk.toString('utf-8') },
            });
          }
        });

        execStream.on('end', () => {
          if (ws.readyState === WebSocket.OPEN) {
            sendJson(ws, role, { type: 'exec_exit' });
          }
          clientExecStreams.delete(ws);
        });

        execStream.on('error', (err: Error) => {
          sendError(ws, role, `Exec stream error: ${err.message}`);
          clientExecStreams.delete(ws);
        });
      } catch (err) {
        sendError(ws, role, `Exec failed: ${errorMessage(err)}`);
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

  wss.on('connection', (ws, request) => {
    const role = opts.accessRole(request);
    if (!role) {
      ws.close(1008, 'Authentication required');
      return;
    }
    opts.registerRole(ws, role);
    sendJson(ws, role, { type: 'graph', data: opts.getGraph() });

    ws.on('message', async (raw) => {
      try {
        const msg = parseInboundWSMessage(raw.toString());
        if (!msg) {
          return;
        }
        if (role === 'reader' && msg.type.startsWith('exec_')) {
          sendError(ws, role, 'Operator access required');
          return;
        }

        await (wsHandlers[msg.type] as WSHandler)(ws, msg, role);
      } catch (err) {
        sendError(ws, role, errorMessage(err) || 'WebSocket command failed');
      }
    });

    ws.on('close', () => {
      stopLogStream(ws);
      stopExecStream(ws);
    });
  });
}
