#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { generateKeyPairSync } from 'crypto';
import { createConnection } from 'net';
import path from 'path';
import { startServer } from './server/index.js';
import { buildGraph, checkConnection, initDockerClient } from './docker/client.js';
import { PKG_VERSION, fetchLatestVersion } from './version.js';
import {
  loadExternalPlugins,
  parsePluginPaths,
  parsePluginPermissionList,
  validateExternalPluginManifests,
} from './plugins/loader.js';
import {
  installPluginFromPath,
  listInstalledPlugins,
  uninstallPlugin,
  updateInstalledPlugin,
} from './plugins/install.js';
import { createPluginPackageFromPath, verifyPluginPackage } from './plugins/package.js';
import { installPluginFromCatalog, loadPluginCatalog } from './plugins/catalog.js';

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

function defaultBindAddress(): string {
  if (process.env.DOCKSCOPE_BIND) {
    return process.env.DOCKSCOPE_BIND;
  }
  // Container: bind all interfaces and let `docker run -p` control exposure.
  if (existsSync('/.dockerenv') || existsSync('/run/.containerenv')) {
    return '0.0.0.0';
  }
  return '127.0.0.1';
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

const VERSION = PKG_VERSION;

async function checkForUpdate(): Promise<string | null> {
  const latest = await fetchLatestVersion();
  return latest && latest !== VERSION ? latest : null;
}

async function writePluginScaffold(options: {
  dir: string;
  id: string;
  name: string;
}): Promise<void> {
  const pluginDir = path.resolve(options.dir);
  await mkdir(pluginDir, { recursive: true });
  const manifest = {
    id: options.id,
    name: options.name,
    version: '0.1.0',
    dockscopeApiVersion: '1',
    entry: './plugin.mjs',
    capabilities: ['ui.command', 'source.events'],
    permissions: [],
    commands: [
      {
        id: 'hello',
        title: 'Say hello',
        description: 'Emit a sample plugin event',
      },
    ],
  };
  await writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  await writeFile(
    path.join(pluginDir, 'plugin.mjs'),
    `export default function createPlugin({ manifest, host }) {
  return {
    manifest,
    async runCommand(commandId) {
      if (commandId !== 'hello') {
        return { ok: false, message: \`Unknown command: \${commandId}\` };
      }
      await host.publishEvent('hello.ran', { time: Date.now() });
      return { ok: true, message: 'Hello from your DockScope plugin' };
    },
  };
}
`,
    'utf-8',
  );
  await writeFile(
    path.join(pluginDir, 'package.json'),
    JSON.stringify(
      {
        name: options.id,
        version: '0.1.0',
        type: 'module',
        private: true,
        scripts: {
          validate: 'dockscope plugin:validate --plugins . --plugin-permissions all',
          test: 'dockscope plugin:test --plugins . --plugin-permissions all',
          pack: `dockscope plugin:pack --source . --out ./dist/${options.id}.dockscope-plugin`,
        },
        peerDependencies: {
          dockscope: `>=${VERSION}`,
        },
      },
      null,
      2,
    ),
    'utf-8',
  );
  await writeFile(
    path.join(pluginDir, 'README.md'),
    `# ${options.name}

DockScope plugin id: \`${options.id}\`

## Development

\`\`\`bash
dockscope plugin:validate --plugins . --plugin-permissions all
dockscope plugin:test --plugins . --plugin-permissions all
dockscope up --plugins . --plugin-permissions all
\`\`\`

## Packaging

\`\`\`bash
dockscope plugin:pack --source . --out ./dist/${options.id}.dockscope-plugin
\`\`\`
`,
    'utf-8',
  );
}

async function validatePluginPaths(opts: {
  plugins: string;
  pluginPermissions?: string;
}): Promise<boolean> {
  const result = await validateExternalPluginManifests({
    paths: parsePluginPaths(opts.plugins),
    permissions: parsePluginPermissionList(opts.pluginPermissions),
  });

  for (const manifest of result.manifests) {
    console.log(`  ok ${manifest.id} v${manifest.version} (api ${manifest.dockscopeApiVersion})`);
  }
  for (const error of result.errors) {
    console.error(
      `  error ${error.id ?? error.path ?? 'unknown'} [${error.phase}]: ${error.message}`,
    );
  }
  if (result.manifests.length === 0 && result.errors.length === 0) {
    console.error('  No plugin manifests found');
    return false;
  }
  return result.errors.length === 0;
}

async function readOptionalTextFile(filePath: string | undefined): Promise<string | undefined> {
  return filePath ? readFile(path.resolve(filePath), 'utf-8') : undefined;
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
  .option(
    '-b, --bind <address>',
    'Address to listen on (default: 127.0.0.1, or 0.0.0.0 inside a container)',
  )
  .option('--no-open', "Don't open browser automatically")
  .option('--no-port-check', 'Skip port conflict detection')
  .option(
    '--plugins <paths>',
    'External plugin path list (use the system path delimiter to load multiple roots)',
  )
  .option(
    '--plugin-permissions <permissions>',
    'Allowed plugin permissions: all or comma-separated',
  )
  .option('--plugin-config <file>', 'Plugin configuration JSON file')
  .option('--plugin-state <file>', 'Plugin enabled/disabled state JSON file')
  .option('--plugin-secrets <file>', 'Plugin secrets JSON file')
  .option('--plugin-secret-key <key>', 'Encrypt plugin secrets with this local key')
  .option('--plugin-events <file>', 'Plugin event history JSON file')
  .option('--plugin-approvals <file>', 'Plugin approval JSON file')
  .option('--plugin-catalog <source>', 'Plugin catalog file or URL')
  .option('--no-external-plugins', 'Disable external plugin loading')
  .action(async (opts) => {
    const requestedPort = parseInt(opts.port, 10);
    const port = opts.portCheck === false ? requestedPort : await findAvailablePort(requestedPort);
    const host: string | undefined = opts.host || process.env.DOCKER_HOST || undefined;
    const bind: string = opts.bind || defaultBindAddress();

    console.log(`
  ____             _    ____
 |  _ \\  ___   ___| | _/ ___|  ___ ___  _ __   ___
 | | | |/ _ \\ / __| |/ \\___ \\ / __/ _ \\| '_ \\ / _ \\
 | |_| | (_) | (__|   < ___) | (_| (_) | |_) |  __/
 |____/ \\___/ \\___|_|\\_\\____/ \\___\\___/| .__/ \\___|
                                       |_|  v${VERSION}
`);

    await startServer({
      port,
      open: opts.open !== false,
      host,
      bind,
      pluginPaths: opts.plugins,
      pluginPermissions: opts.pluginPermissions,
      pluginConfig: opts.pluginConfig,
      pluginState: opts.pluginState,
      pluginSecrets: opts.pluginSecrets,
      pluginSecretKey: opts.pluginSecretKey,
      pluginEvents: opts.pluginEvents,
      pluginApprovals: opts.pluginApprovals,
      pluginCatalog: opts.pluginCatalog,
      disableExternalPlugins: opts.externalPlugins === false,
    });

    const url = `http://localhost:${port}`;
    if (host) {
      console.log(`  Docker host: ${host}`);
    }
    if (bind !== '127.0.0.1') {
      console.log(`  Listening on: ${bind}:${port}`);
    }
    console.log(`  Dashboard: ${url}`);
    console.log(`  API:       ${url}/api/graph`);
    console.log(`  WebSocket: ws://localhost:${port}/ws\n`);
    console.log('  Star DockScope if it helps: https://github.com/ManuelR-T/dockscope\n');
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
  .command('plugin:validate')
  .description('Validate external plugin manifests without importing plugin code')
  .requiredOption('--plugins <paths>', 'Plugin path list')
  .option(
    '--plugin-permissions <permissions>',
    'Allowed plugin permissions: all or comma-separated',
  )
  .action(async (opts) => {
    if (!(await validatePluginPaths(opts))) {
      process.exit(1);
    }
  });

program
  .command('plugin:init')
  .description('Create a minimal external plugin scaffold')
  .requiredOption('--dir <path>', 'Plugin directory to create')
  .requiredOption('--id <id>', 'Plugin id')
  .requiredOption('--name <name>', 'Plugin display name')
  .action(async (opts) => {
    await writePluginScaffold({ dir: opts.dir, id: opts.id, name: opts.name });
    console.log(`  created ${opts.id} in ${path.resolve(opts.dir)}`);
  });

program
  .command('plugin:keys')
  .description('Generate Ed25519 key files for plugin package signing')
  .requiredOption('--out-dir <path>', 'Directory for generated key files')
  .option('--name <name>', 'Key file prefix', 'dockscope-plugin')
  .action(async (opts) => {
    const outDir = path.resolve(opts.outDir);
    await mkdir(outDir, { recursive: true });
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privatePath = path.join(outDir, `${opts.name}.private.pem`);
    const publicPath = path.join(outDir, `${opts.name}.public.pem`);
    await writeFile(
      privatePath,
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      'utf-8',
    );
    await writeFile(
      publicPath,
      publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      'utf-8',
    );
    console.log(`  private ${privatePath}`);
    console.log(`  public  ${publicPath}`);
  });

program
  .command('plugin:test')
  .description('Validate and import external plugins')
  .requiredOption('--plugins <paths>', 'Plugin path list')
  .option(
    '--plugin-permissions <permissions>',
    'Allowed plugin permissions: all or comma-separated',
  )
  .action(async (opts) => {
    const result = await loadExternalPlugins({
      paths: parsePluginPaths(opts.plugins),
      permissions: parsePluginPermissionList(opts.pluginPermissions),
    });
    for (const plugin of result.plugins) {
      console.log(`  loaded ${plugin.manifest.id} v${plugin.manifest.version}`);
    }
    for (const error of result.errors) {
      console.error(
        `  error ${error.id ?? error.path ?? 'unknown'} [${error.phase}]: ${error.message}`,
      );
    }
    if (result.plugins.length === 0 && result.errors.length === 0) {
      console.error('  No plugin manifests found');
      process.exit(1);
    }
    if (result.errors.length > 0) {
      process.exit(1);
    }
  });

program
  .command('plugin:watch')
  .description('Continuously validate external plugin manifests')
  .requiredOption('--plugins <paths>', 'Plugin path list')
  .option(
    '--plugin-permissions <permissions>',
    'Allowed plugin permissions: all or comma-separated',
  )
  .option('--interval <ms>', 'Validation interval', '2000')
  .action(async (opts) => {
    const interval = Math.max(500, Number.parseInt(opts.interval, 10) || 2000);
    const run = async () => {
      console.log(`\n  validating ${new Date().toISOString()}`);
      await validatePluginPaths(opts);
    };
    await run();
    setInterval(() => {
      void run();
    }, interval);
  });

program
  .command('plugin:pack')
  .description('Create a DockScope plugin package from a plugin directory')
  .requiredOption('--source <path>', 'Plugin directory to package')
  .requiredOption('--out <file>', 'Output package file')
  .option('--signing-key <key>', 'Optional HMAC signing key')
  .option('--private-key <file>', 'Ed25519 private key PEM file')
  .option('--key-id <id>', 'Optional signature key id')
  .action(async (opts) => {
    const bundle = await createPluginPackageFromPath({
      sourcePath: opts.source,
      outFile: opts.out,
      signingKey: opts.signingKey,
      privateKey: await readOptionalTextFile(opts.privateKey),
      keyId: opts.keyId,
    });
    console.log(`  packed ${bundle.manifest.id} v${bundle.manifest.version}`);
    console.log(`  sha256 ${bundle.sha256}`);
    if (bundle.signature) {
      console.log(`  signature ${bundle.signature.algorithm}`);
    }
  });

program
  .command('plugin:verify')
  .description('Verify a DockScope plugin package')
  .requiredOption('--package <file>', 'Package file')
  .option('--signing-key <key>', 'HMAC signing key required for signature verification')
  .option('--public-key <file>', 'Ed25519 public key PEM file required for public-key verification')
  .action(async (opts) => {
    const verified = await verifyPluginPackage(opts.package, {
      signingKey: opts.signingKey,
      publicKey: await readOptionalTextFile(opts.publicKey),
    });
    console.log(`  verified ${verified.bundle.manifest.id} v${verified.bundle.manifest.version}`);
    console.log(`  sha256 ${verified.bundle.sha256}`);
    console.log(`  signed ${verified.signed ? 'yes' : 'no'}`);
    if (verified.signed) {
      console.log(`  signature ${verified.signatureVerified ? 'verified' : 'present'}`);
    }
  });

program
  .command('plugin:install')
  .description('Install an external plugin into the local DockScope plugin registry')
  .requiredOption('--source <path>', 'Plugin directory or package to install')
  .option('--registry-dir <path>', 'Local plugin registry directory')
  .option('--signing-key <key>', 'HMAC signing key required to verify signed packages')
  .option('--public-key <file>', 'Ed25519 public key PEM file required to verify signed packages')
  .action(async (opts) => {
    const installed = await installPluginFromPath({
      sourcePath: opts.source,
      registryDir: opts.registryDir,
      signingKey: opts.signingKey,
      publicKey: await readOptionalTextFile(opts.publicKey),
    });
    console.log(`  installed ${installed.id} v${installed.version}`);
    if (installed.packageSha256) {
      console.log(`  package ${installed.packageSha256}`);
    }
    console.log(`  path ${installed.path}`);
  });

program
  .command('plugin:catalog')
  .description('List plugins from a DockScope plugin catalog')
  .requiredOption('--catalog <source>', 'Catalog JSON file or URL')
  .action(async (opts) => {
    const catalog = await loadPluginCatalog(opts.catalog);
    console.log(`  ${catalog.name}`);
    for (const entry of catalog.entries) {
      console.log(`  ${entry.id} v${entry.version}`);
      if (entry.description) {
        console.log(`    ${entry.description}`);
      }
      console.log(`    package ${entry.resolvedPackageUrl}`);
    }
  });

program
  .command('plugin:catalog:install')
  .description('Install a plugin package from a DockScope plugin catalog')
  .argument('<pluginId>', 'Plugin id')
  .requiredOption('--catalog <source>', 'Catalog JSON file or URL')
  .option('--registry-dir <path>', 'Local plugin registry directory')
  .action(async (pluginId: string, opts) => {
    const installed = await installPluginFromCatalog({
      catalogSource: opts.catalog,
      pluginId,
      registryDir: opts.registryDir,
    });
    console.log(`  installed ${installed.id} v${installed.version}`);
    if (installed.packageSha256) {
      console.log(`  package ${installed.packageSha256}`);
    }
    console.log(`  path ${installed.path}`);
  });

program
  .command('plugin:list')
  .description('List locally installed DockScope plugins')
  .option('--registry-dir <path>', 'Local plugin registry directory')
  .action(async (opts) => {
    const installed = await listInstalledPlugins(opts.registryDir);
    if (installed.length === 0) {
      console.log('  No plugins installed');
      return;
    }
    for (const plugin of installed) {
      console.log(
        `  ${plugin.id} v${plugin.version} api ${plugin.dockscopeApiVersion} (${plugin.sourceType ?? 'directory'})`,
      );
      if (plugin.packageSha256) {
        console.log(`    package ${plugin.packageSha256}`);
      }
      console.log(`    ${plugin.path}`);
    }
  });

program
  .command('plugin:update')
  .description('Update a locally installed DockScope plugin from its recorded source path')
  .argument('<pluginId>', 'Plugin id')
  .option('--registry-dir <path>', 'Local plugin registry directory')
  .option('--signing-key <key>', 'HMAC signing key required to verify signed packages')
  .option('--public-key <file>', 'Ed25519 public key PEM file required to verify signed packages')
  .action(async (pluginId: string, opts) => {
    const updated = await updateInstalledPlugin(
      pluginId,
      opts.registryDir,
      opts.signingKey,
      await readOptionalTextFile(opts.publicKey),
    );
    console.log(`  updated ${updated.id} v${updated.version}`);
  });

program
  .command('plugin:uninstall')
  .description('Remove a locally installed DockScope plugin')
  .argument('<pluginId>', 'Plugin id')
  .option('--registry-dir <path>', 'Local plugin registry directory')
  .action(async (pluginId: string, opts) => {
    const removed = await uninstallPlugin(pluginId, opts.registryDir);
    if (!removed) {
      console.error(`  Plugin is not installed: ${pluginId}`);
      process.exit(1);
    }
    console.log(`  uninstalled ${pluginId}`);
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
