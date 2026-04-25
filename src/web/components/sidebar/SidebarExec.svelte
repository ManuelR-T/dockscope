<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  interface Props {
    containerId: string;
  }

  let { containerId }: Props = $props();

  let termEl: HTMLDivElement;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let ws: WebSocket | null = null;
  let connected = $state(false);
  let connecting = $state(false);

  function isSocketActive(socket: WebSocket | null): boolean {
    return socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN;
  }

  function connect() {
    if (isSocketActive(ws)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    ws = socket;
    connecting = true;

    socket.onopen = () => {
      if (ws !== socket) {
        return;
      }
      connected = true;
      connecting = false;
      socket.send(JSON.stringify({ type: 'exec_start', data: { containerId } }));
    };

    socket.onmessage = (e) => {
      if (ws !== socket) {
        return;
      }
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'exec_output' && msg.data?.text) {
          terminal?.write(msg.data.text);
        }
        if (msg.type === 'exec_exit') {
          terminal?.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n');
          connected = false;
        }
      } catch {
        // ignore non-JSON (graph/stats on the shared WS — we use a separate connection)
      }
    };

    socket.onclose = () => {
      if (ws !== socket) {
        return;
      }
      connected = false;
      connecting = false;
      ws = null;
    };

    socket.onerror = () => {
      if (ws === socket) {
        socket.close();
      }
    };
  }

  function disconnect() {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exec_stop' }));
    }
    ws?.close();
    ws = null;
    connected = false;
    connecting = false;
  }

  onMount(() => {
    terminal = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "'Fira Code', monospace",
      theme: {
        background: '#04040e',
        foreground: '#e2e8f0',
        cursor: '#00e4ff',
        selectionBackground: '#00e4ff33',
        black: '#0a0a1a',
        red: '#ff2b4e',
        green: '#00ff6a',
        yellow: '#ff8a2b',
        blue: '#00a0ff',
        magenta: '#a855f7',
        cyan: '#00e4ff',
        white: '#e2e8f0',
        brightBlack: '#3e4a5c',
        brightRed: '#ff5c7a',
        brightGreen: '#44ff8e',
        brightYellow: '#ffaa55',
        brightBlue: '#44bbff',
        brightMagenta: '#c084fc',
        brightCyan: '#44eeff',
        brightWhite: '#f8fafc',
      },
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(termEl);
    fitAddon.fit();

    // Send keyboard input to the exec stream
    terminal.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'exec_input', data: { text: data } }));
      }
    });

    // Handle resize
    const observer = new ResizeObserver(() => {
      fitAddon?.fit();
    });
    observer.observe(termEl);

    connect();

    return () => {
      observer.disconnect();
      disconnect();
      terminal?.dispose();
    };
  });

  onDestroy(() => {
    disconnect();
  });
</script>

<div class="exec-container">
  <div class="exec-header">
    <span class="exec-status" class:connected>
      <span class="exec-dot"></span>
      {connected ? 'Connected' : connecting ? 'Connecting' : 'Disconnected'}
    </span>
    {#if connected}
      <button class="exec-btn" onclick={disconnect}>Disconnect</button>
    {:else}
      <button class="exec-btn" onclick={connect} disabled={connecting}>Reconnect</button>
    {/if}
  </div>
  <div class="exec-terminal" bind:this={termEl}></div>
</div>

<style>
  .exec-container {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .exec-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .exec-status {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .exec-status.connected {
    color: var(--accent-green);
  }

  .exec-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-dim);
  }

  .exec-status.connected .exec-dot {
    background: var(--accent-green);
    box-shadow: 0 0 6px rgba(0, 255, 106, 0.3);
  }

  .exec-btn {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    padding: 3px 10px;
    border-radius: 4px;
    border: 1px solid var(--border-subtle);
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.2s;
  }

  .exec-btn:hover {
    border-color: var(--border-glow);
    color: var(--text-secondary);
  }

  .exec-terminal {
    flex: 1;
    min-height: 0;
    padding: 4px;
  }

  .exec-terminal :global(.xterm) {
    height: 100%;
  }

  .exec-terminal :global(.xterm-viewport) {
    overflow-y: auto !important;
  }
</style>
