#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { createConnection } from 'net';
import { startServer } from './server/index.js';
import { buildGraph, checkConnection, initDockerClient } from './docker/client.js';

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const conn = createConnection({ port, host: '127.0.0.1' });
    const timeout = setTimeout(() => {
      conn.destroy();
      resolve(false);
    }, 500);
    conn.on('connect', () => {
      clearTimeout(timeout);
      conn.destroy();
      resolve(true);
    });
    conn.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function findAvailablePort(start: number): Promise<number> {
  let port = start;
  while (await isPortInUse(port)) {
    console.log(`  Port ${port} is in use, trying ${port + 1}...`);
    port++;
    if (port > start + 20) {
      console.error(`  No available port found in range ${start}-${port}`);
      process.exit(1);
    }
  }
  return port;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const VERSION = pkg.version;

async function checkForUpdate(): Promise<string | null> {
  try {
    const res = await fetch('https://registry.npmjs.org/dockscope/latest', {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { version?: string };
    const latest = data.version;
    if (latest && latest !== VERSION) {
      return latest;
    }
    return null;
  } catch {
    return null;
  }
}

const program = new Command();

program
  .name('dockscope')
  .description('Visual, interactive Docker infrastructure debugger')
  .version(VERSION);

program
  .command('up', { isDefault: true })
  .description('Start the DockScope dashboard')
  .option('-p, --port <port>', 'Server port', '4681')
  .option('-H, --host <url>', 'Docker host URL (e.g. ssh://user@remote, tcp://host:2375)')
  .option('--no-open', "Don't open browser automatically")
  .option('--no-port-check', 'Skip port conflict detection')
  .action(async (opts) => {
    const requestedPort = parseInt(opts.port, 10);
    const port = opts.portCheck === false ? requestedPort : await findAvailablePort(requestedPort);
    const host: string | undefined = opts.host || process.env.DOCKER_HOST || undefined;

    console.log(`
  ____             _    ____
 |  _ \\  ___   ___| | _/ ___|  ___ ___  _ __   ___
 | | | |/ _ \\ / __| |/ \\___ \\ / __/ _ \\| '_ \\ / _ \\
 | |_| | (_) | (__|   < ___) | (_| (_) | |_) |  __/
 |____/ \\___/ \\___|_|\\_\\____/ \\___\\___/| .__/ \\___|
                                       |_|  v${VERSION}
`);

    await startServer({ port, open: opts.open !== false, host });

    const url = `http://localhost:${port}`;
    if (host) {
      console.log(`  Docker host: ${host}`);
    }
    console.log(`  Dashboard: ${url}`);
    console.log(`  API:       ${url}/api/graph`);
    console.log(`  WebSocket: ws://localhost:${port}/ws\n`);
    console.log('');
    console.log('  Press Ctrl+C to stop\n');

    // Non-blocking update check
    checkForUpdate().then((latest) => {
      if (latest) {
        console.log(`  \x1b[33mUpdate available: v${VERSION} → v${latest}\x1b[0m`);
        console.log(`  Run \x1b[36mnpm i -g dockscope\x1b[0m to update\n`);
      }
    });

    if (opts.open !== false) {
      const open = (await import('open')).default;
      await open(url);
    }
  });

program
  .command('scan')
  .description('Scan Docker environment and output graph data as JSON')
  .option('-H, --host <url>', 'Docker host URL')
  .action(async (opts) => {
    const scanHost: string | undefined = opts.host || process.env.DOCKER_HOST || undefined;
    if (scanHost) {
      initDockerClient(scanHost);
    }
    const connected = await checkConnection();
    if (!connected) {
      console.error('Cannot connect to Docker daemon. Is Docker running?');
      process.exit(1);
    }

    const graph = await buildGraph();
    console.log(JSON.stringify(graph, null, 2));
  });

program.parse();
