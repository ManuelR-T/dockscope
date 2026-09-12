import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { PKG_VERSION } from '../version.js';

export async function writePluginScaffold(options: {
  dir: string;
  id: string;
  name: string;
  template?: string;
}): Promise<void> {
  const pluginDir = path.resolve(options.dir);
  await mkdir(pluginDir, { recursive: true });
  const template = options.template === 'graph' ? 'graph' : 'command';
  const manifest = {
    $schema:
      'https://raw.githubusercontent.com/ManuelR-T/dockscope/main/schemas/plugin-manifest.schema.json',
    id: options.id,
    name: options.name,
    version: '0.1.0',
    manifestVersion: '1',
    dockscopeApiVersion: '1',
    hostApiVersion: '1',
    entry: './plugin.mjs',
    execution: {
      isolation: 'process',
      operationTimeoutMs: 30_000,
      maxStderrBytes: 64_000,
      memoryLimitMb: 128,
    },
    capabilities:
      template === 'graph'
        ? ['source.graph', 'ui.command', 'source.events']
        : ['ui.command', 'source.events'],
    permissions: [],
    commands: [
      {
        id: template === 'graph' ? 'refresh' : 'hello',
        title: template === 'graph' ? 'Refresh graph sample' : 'Say hello',
        description: template === 'graph' ? 'Emit a refresh event' : 'Emit a sample plugin event',
        input:
          template === 'command'
            ? {
                fields: [
                  {
                    key: 'name',
                    label: 'Name',
                    type: 'string',
                    default: 'DockScope',
                  },
                ],
              }
            : undefined,
      },
    ],
  };
  await writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  await writeFile(
    path.join(pluginDir, 'plugin.mjs'),
    template === 'graph'
      ? `// @ts-check

/** @type {import('dockscope/plugin-sdk/v1').DataSourceDescriptor} */
const source = {
  id: 'sample',
  label: 'Sample Graph',
  kind: 'plugin',
  pluginId: '',
  capabilities: ['source.graph'],
  status: 'connected',
};

/** @type {import('dockscope/plugin-sdk/v1').PluginFactory} */
const createPlugin = ({ manifest, host }) => {
  return {
    manifest,
    getGraphSources() {
      return [
        {
          describe() {
            return { ...source, pluginId: manifest.id };
          },
          async collectGraph() {
            return {
              source: { ...source, pluginId: manifest.id },
              collectedAt: Date.now(),
              graph: {
                nodes: [
                  {
                    id: 'sample-node',
                    name: 'sample-node',
                    fullName: 'sample/sample-node',
                    project: 'sample',
                    host: 'sample',
                    containerId: 'sample-node',
                    image: 'Sample',
                    status: 'running',
                    health: 'healthy',
                    ports: [],
                    networks: ['sample'],
                    volumeCount: 0,
                    cpu: 0,
                    memory: 0,
                    memoryLimit: 0,
                    networkRx: 0,
                    networkTx: 0,
                    networkRxRate: 0,
                    networkTxRate: 0,
                  },
                ],
                links: [],
              },
            };
          },
        },
      ];
    },
    async runCommand(commandId) {
      if (commandId !== 'refresh') {
        return { ok: false, message: \`Unknown command: \${commandId}\` };
      }
      await host.publishEvent('sample.refresh', { time: Date.now() });
      return { ok: true, message: 'Refresh event emitted' };
    },
  };
};

export default createPlugin;
`
      : `// @ts-check

/** @type {import('dockscope/plugin-sdk/v1').PluginFactory} */
const createPlugin = ({ manifest, host }) => {
  return {
    manifest,
    async runCommand(commandId, input) {
      if (commandId !== 'hello') {
        return { ok: false, message: \`Unknown command: \${commandId}\` };
      }
      const values = typeof input === 'object' && input !== null ? input : {};
      const name = 'name' in values && typeof values.name === 'string' && values.name.trim()
        ? values.name
        : 'DockScope';
      await host.publishEvent('hello.ran', { name, time: Date.now() });
      return { ok: true, message: \`Hello, \${name}\` };
    },
  };
};

export default createPlugin;
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
          dockscope: `>=${PKG_VERSION}`,
        },
      },
      null,
      2,
    ),
    'utf-8',
  );
  await writeFile(
    path.join(pluginDir, 'jsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          allowJs: true,
          checkJs: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          strict: true,
          // Without these, `checkJs` reports errors from third-party JavaScript
          // inside node_modules and buries the plugin's own diagnostics.
          skipLibCheck: true,
          maxNodeModuleJsDepth: 0,
        },
        include: ['plugin.mjs'],
        exclude: ['node_modules'],
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

## Setup

Install the SDK types so editors can type-check \`plugin.mjs\` against \`dockscope/plugin-sdk/v1\`:

\`\`\`bash
npm install
\`\`\`

## Development

\`\`\`bash
dockscope plugin:validate --plugins . --plugin-permissions all
dockscope plugin:test --plugins . --plugin-permissions all
dockscope plugin:dev --plugins . --plugin-permissions all
\`\`\`

## Packaging

\`\`\`bash
dockscope plugin:pack --source . --out ./dist/${options.id}.dockscope-plugin
\`\`\`
`,
    'utf-8',
  );
}
