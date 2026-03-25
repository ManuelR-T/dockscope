#!/usr/bin/env node

import { Command } from 'commander';
import { startServer } from './server/index.js';
import { buildGraph, checkConnection } from './docker/client.js';

const program = new Command();

program
  .name('dockscope')
  .description('Visual, interactive Docker infrastructure debugger')
  .version('0.1.0');

program
  .command('up')
  .description('Start the DockScope dashboard')
  .option('-p, --port <port>', 'Server port', '4681')
  .option('-f, --file <path>', 'Docker Compose file path', 'docker-compose.yml')
  .option('--no-open', "Don't open browser automatically")
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);

    console.log(`
  ____             _    ____
 |  _ \\  ___   ___| | _/ ___|  ___ ___  _ __   ___
 | | | |/ _ \\ / __| |/ \\___ \\ / __/ _ \\| '_ \\ / _ \\
 | |_| | (_) | (__|   < ___) | (_| (_) | |_) |  __/
 |____/ \\___/ \\___|_|\\_\\____/ \\___\\___/| .__/ \\___|
                                       |_|  v0.1.0
`);

    await startServer({ port, composeFile: opts.file, open: opts.open !== false });

    const url = `http://localhost:${port}`;
    console.log(`  Dashboard: ${url}`);
    console.log(`  API:       ${url}/api/graph`);
    console.log(`  WebSocket: ws://localhost:${port}/ws\n`);
    console.log('');
    console.log('  Press Ctrl+C to stop\n');

    if (opts.open !== false) {
      const open = (await import('open')).default;
      await open(url);
    }
  });

program
  .command('scan')
  .description('Scan Docker environment and output graph data as JSON')
  .option('-f, --file <path>', 'Docker Compose file path', 'docker-compose.yml')
  .action(async (opts) => {
    const connected = await checkConnection();
    if (!connected) {
      console.error('Cannot connect to Docker daemon. Is Docker running?');
      process.exit(1);
    }

    const graph = await buildGraph(opts.file);
    console.log(JSON.stringify(graph, null, 2));
  });

program.parse();
