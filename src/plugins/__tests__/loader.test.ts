import { access, mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  loadExternalPlugins,
  loadExternalPluginsFromEnv,
  validateExternalPluginManifests,
} from '../loader';

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function createPluginDir(name = 'demo'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dockscope-plugin-'));
  const pluginDir = path.join(root, name);
  await mkdir(pluginDir);
  return pluginDir;
}

async function writePlugin(
  pluginDir: string,
  manifest: Record<string, unknown>,
  moduleSource: string,
): Promise<void> {
  await writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify(manifest), 'utf-8');
  await writeFile(path.join(pluginDir, 'plugin.mjs'), moduleSource, 'utf-8');
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'external.demo',
    name: 'External Demo',
    version: '1.0.0',
    manifestVersion: '1',
    dockscopeApiVersion: '1',
    hostApiVersion: '1',
    entry: './plugin.mjs',
    capabilities: ['source.graph'],
    permissions: [],
    ...overrides,
  };
}

describe('external plugin loader', () => {
  it('loads a plugin from a direct plugin directory', async () => {
    const pluginDir = await createPluginDir();
    await writePlugin(
      pluginDir,
      manifest(),
      `
        export default function createPlugin({ manifest }) {
          return {
            manifest,
            getGraphSources() {
              return [];
            }
          };
        }
      `,
    );

    const result = await loadExternalPlugins({ paths: [pluginDir], permissions: 'all' });

    expect(result.errors).toEqual([]);
    expect(result.plugins).toHaveLength(1);
    expect(result.configs.get('external.demo')).toEqual({});
    expect(result.plugins[0].manifest).toMatchObject({
      id: 'external.demo',
      capabilities: ['source.graph'],
    });
    expect(result.plugins[0].getGraphSources?.()).toEqual([]);
  });

  it('discovers plugin directories inside a plugin root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dockscope-plugin-root-'));
    const pluginDir = path.join(root, 'external-demo');
    await mkdir(pluginDir);
    await writePlugin(
      pluginDir,
      manifest({ id: 'external.nested' }),
      `
        export function createPlugin({ manifest }) {
          return { manifest };
        }
      `,
    );

    const result = await loadExternalPlugins({ paths: [root], permissions: [] });

    expect(result.errors).toEqual([]);
    expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual(['external.nested']);
  });

  it('passes validated config into plugin factories', async () => {
    const pluginDir = await createPluginDir();
    await writePlugin(
      pluginDir,
      manifest({
        capabilities: ['source.graph', 'ui.settings'],
        config: {
          fields: [{ key: 'enabled', label: 'Enabled', type: 'boolean', default: true }],
        },
      }),
      `
        export function createPlugin({ manifest, config }) {
          return { manifest: { ...manifest, description: String(config.enabled) } };
        }
      `,
    );

    const result = await loadExternalPlugins({
      paths: [pluginDir],
      permissions: [],
      getConfig: () => ({ enabled: false }),
    });

    expect(result.errors).toEqual([]);
    expect(result.configs.get('external.demo')).toEqual({ enabled: false });
    expect(result.plugins[0].manifest.description).toBe('false');
  });

  it('exposes host APIs only when permissions allow them', async () => {
    const pluginDir = await createPluginDir();
    await writeFile(path.join(pluginDir, 'message.txt'), 'hello plugin\n', 'utf-8');
    await writePlugin(
      pluginDir,
      manifest({ permissions: ['filesystem.read'] }),
      `
        export default async function createPlugin({ manifest, host }) {
          const text = await host.readTextFile('message.txt');
          return { manifest: { ...manifest, description: text.trim() } };
        }
      `,
    );

    const result = await loadExternalPlugins({
      paths: [pluginDir],
      permissions: ['filesystem.read'],
    });

    expect(result.errors).toEqual([]);
    expect(result.plugins[0].manifest.description).toBe('hello plugin');
  });

  it('reports host API permission failures as load errors', async () => {
    const pluginDir = await createPluginDir();
    await writePlugin(
      pluginDir,
      manifest(),
      `
        export default async function createPlugin({ manifest, host }) {
          await host.readTextFile('message.txt');
          return { manifest };
        }
      `,
    );

    const result = await loadExternalPlugins({ paths: [pluginDir], permissions: [] });

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        id: 'external.demo',
        phase: 'load',
        message: 'Plugin "external.demo" requires permission "filesystem.read"',
      }),
    ]);
  });

  it('rejects plugins requiring permissions outside policy before import', async () => {
    const pluginDir = await createPluginDir();
    await writePlugin(
      pluginDir,
      manifest({ permissions: ['network.http'] }),
      `
        throw new Error('module should not be imported');
      `,
    );

    const result = await loadExternalPlugins({ paths: [pluginDir], permissions: [] });

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        id: 'external.demo',
        phase: 'permission',
        message: 'Plugin requires disallowed permissions: network.http',
      }),
    ]);
  });

  it('reports invalid manifests as manifest load errors', async () => {
    const pluginDir = await createPluginDir();
    await writePlugin(
      pluginDir,
      manifest({ capabilities: ['source.invalid'] }),
      'export default function createPlugin({ manifest }) { return { manifest }; }',
    );

    const result = await loadExternalPlugins({ paths: [pluginDir], permissions: 'all' });

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        phase: 'manifest',
        message: 'Unsupported plugin capability: source.invalid',
      }),
    ]);
  });

  it('reports legacy manifest fields as non-blocking warnings', async () => {
    const pluginDir = await createPluginDir();
    await writePlugin(
      pluginDir,
      manifest({
        manifestVersion: undefined,
        dockscopeApiVersion: undefined,
        hostApiVersion: undefined,
        execution: { commandTimeoutMs: 5000 },
      }),
      'export default function createPlugin({ manifest }) { return { manifest }; }',
    );

    const result = await validateExternalPluginManifests({
      paths: [pluginDir],
      permissions: 'all',
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'manifest-version-defaulted',
      'plugin-api-version-defaulted',
      'host-api-version-defaulted',
      'command-timeout-deprecated',
    ]);
  });

  it('reports module contract errors as load errors', async () => {
    const pluginDir = await createPluginDir();
    await writePlugin(pluginDir, manifest(), 'export const value = 1;');

    const result = await loadExternalPlugins({ paths: [pluginDir], permissions: 'all' });

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        id: 'external.demo',
        phase: 'load',
        message: 'Plugin module must export default, createPlugin, or plugin',
      }),
    ]);
  });

  it('passes declared secrets through the restricted host API', async () => {
    const pluginDir = await createPluginDir();
    await writePlugin(
      pluginDir,
      manifest({
        permissions: ['secrets.read'],
        secrets: [{ key: 'token', label: 'Token' }],
      }),
      `
        export default async function createPlugin({ manifest, host }) {
          const token = await host.readSecret('token');
          return { manifest: { ...manifest, description: token } };
        }
      `,
    );

    const result = await loadExternalPlugins({
      paths: [pluginDir],
      permissions: ['secrets.read'],
      secretStore: {
        get: async () => 'secret-token',
        has: async () => true,
        set: async () => {},
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.plugins[0].manifest.description).toBe('secret-token');
  });

  it('provides per-plugin host storage without filesystem permissions', async () => {
    const pluginDir = await createPluginDir();
    await writePlugin(
      pluginDir,
      manifest({
        capabilities: ['ui.command'],
        commands: [{ id: 'count', title: 'Count' }],
      }),
      `
        export default function createPlugin({ manifest, host }) {
          return {
            manifest,
            async runCommand() {
              const current = await host.readStorage('counter');
              const count = Number(current?.count ?? 0) + 1;
              await host.writeStorage('counter', { count });
              return { ok: true, data: { count } };
            }
          };
        }
      `,
    );

    const result = await loadExternalPlugins({ paths: [pluginDir], permissions: [] });

    expect(result.errors).toEqual([]);
    await expect(result.plugins[0].runCommand?.('count')).resolves.toEqual({
      ok: true,
      data: { count: 1 },
      message: undefined,
    });
    await expect(result.plugins[0].runCommand?.('count')).resolves.toEqual({
      ok: true,
      data: { count: 2 },
      message: undefined,
    });
  });

  it('loads process-isolated plugin code outside the main process', async () => {
    const pluginDir = await createPluginDir();
    const markerPath = path.join(pluginDir, 'imported.txt');
    const events: { pluginId: string; type: string; payload: unknown }[] = [];
    await writePlugin(
      pluginDir,
      manifest({
        capabilities: ['ui.command', 'source.events'],
        commands: [{ id: 'ping', title: 'Ping' }],
        execution: { isolation: 'process' },
      }),
      `
        import { writeFileSync } from 'fs';
        writeFileSync(${JSON.stringify(markerPath)}, String(process.pid));

        export default function createPlugin({ manifest, host }) {
          return {
            manifest,
            async runCommand(commandId, input) {
              await host.publishEvent('ping.ran', { commandId, input });
              return { ok: true, message: commandId, data: { pid: process.pid } };
            }
          };
        }
      `,
    );

    const result = await loadExternalPlugins({
      paths: [pluginDir],
      permissions: 'all',
      publishEvent: (pluginId, type, payload) => {
        events.push({ pluginId, type, payload });
        return { id: 'event-1', pluginId, type, payload, time: 1 };
      },
    });

    expect(result.errors).toEqual([]);
    expect(await exists(markerPath)).toBe(true);
    const workerPid = Number(await readFile(markerPath, 'utf-8'));
    expect(workerPid).not.toBe(process.pid);
    await expect(result.plugins[0].runCommand?.('ping', { count: 1 })).resolves.toEqual({
      ok: true,
      message: 'ping',
      data: { pid: workerPid },
    });
    expect(events).toEqual([
      {
        pluginId: 'external.demo',
        type: 'ping.ran',
        payload: { commandId: 'ping', input: { count: 1 } },
      },
    ]);
  });

  it('loads process-isolated graph source providers through worker proxies', async () => {
    const pluginDir = await createPluginDir();
    await writePlugin(
      pluginDir,
      manifest({
        capabilities: ['source.graph'],
        execution: { isolation: 'process' },
      }),
      `
        export default function createPlugin({ manifest }) {
          return {
            manifest,
            getGraphSources() {
              return [{
                describe() {
                  return {
                    id: 'isolated-source',
                    label: 'Isolated Source',
                    kind: 'plugin',
                    pluginId: manifest.id,
                    capabilities: ['source.graph'],
                    status: 'connected'
                  };
                },
                async collectGraph() {
                  return {
                    source: this.describe(),
                    collectedAt: 1,
                    graph: {
                      nodes: [],
                      links: []
                    }
                  };
                }
              }];
            }
          };
        }
      `,
    );

    const result = await loadExternalPlugins({ paths: [pluginDir], permissions: 'all' });
    const sources = result.plugins[0].getGraphSources?.() ?? [];

    expect(result.errors).toEqual([]);
    expect(sources.map((source) => source.describe().id)).toEqual(['isolated-source']);
    await expect(sources[0].collectGraph()).resolves.toMatchObject({
      source: { id: 'isolated-source', pluginId: 'external.demo' },
      graph: { nodes: [], links: [] },
    });
    await result.plugins[0].stop?.();
  });

  it('routes resource providers through the plugin process', async () => {
    const pluginDir = await createPluginDir();
    await writePlugin(
      pluginDir,
      manifest({
        capabilities: ['source.logs', 'action.lifecycle', 'action.scale'],
        execution: { isolation: 'process' },
      }),
      `
        export default function createPlugin({ manifest }) {
          return {
            manifest,
            getResourceProviders() {
              return [{
                canHandle(resourceId) {
                  return resourceId.startsWith('pod:');
                },
                async getResourceLogs(resourceId, options) {
                  return resourceId + ':tail=' + String(options?.tail ?? 0);
                },
                async runResourceAction(resourceId, action, options) {
                  if (resourceId !== 'pod:default:api' || action !== 'restart' || options?.minReplicas !== 2) {
                    throw new Error('unexpected resource action');
                  }
                }
              }];
            }
          };
        }
      `,
    );

    const result = await loadExternalPlugins({ paths: [pluginDir], permissions: 'all' });
    const provider = result.plugins[0].getResourceProviders?.()[0];

    expect(result.errors).toEqual([]);
    await expect(provider?.canHandle('pod:default:api')).resolves.toBe(true);
    await expect(provider?.getResourceLogs('pod:default:api', { tail: 25 })).resolves.toBe(
      'pod:default:api:tail=25',
    );
    await expect(
      provider?.runResourceAction('pod:default:api', 'restart', { minReplicas: 2 }),
    ).resolves.toBeUndefined();
    await result.plugins[0].stop?.();
  });

  it('serves a declared frontend bundle without importing it into the host UI', async () => {
    const pluginDir = await createPluginDir();
    await writeFile(
      path.join(pluginDir, 'frontend.mjs'),
      'export default function mount(api) { api.root.textContent = api.view; }',
      'utf-8',
    );
    await writePlugin(
      pluginDir,
      manifest({
        capabilities: ['ui.frontend', 'ui.sidebarPanel'],
        frontend: { entry: './frontend.mjs', slots: ['sidebar'] },
        ui: [
          {
            id: 'overview',
            slot: 'sidebar',
            title: 'Overview',
            frontendView: 'overview',
          },
        ],
      }),
      'export default function createPlugin({ manifest }) { return { manifest }; }',
    );

    const result = await loadExternalPlugins({ paths: [pluginDir], permissions: 'all' });

    expect(result.errors).toEqual([]);
    await expect(result.plugins[0].getFrontendBundle?.()).resolves.toContain(
      'api.root.textContent = api.view',
    );
    await result.plugins[0].stop?.();
  });

  it('recovers with a fresh process after an isolated plugin crashes', async () => {
    const pluginDir = await createPluginDir();
    const events: { type: string; payload: unknown }[] = [];
    await writePlugin(
      pluginDir,
      manifest({
        capabilities: ['ui.command'],
        commands: [
          { id: 'pid', title: 'PID' },
          { id: 'crash', title: 'Crash' },
        ],
        execution: { isolation: 'process', operationTimeoutMs: 2000 },
      }),
      `
        export default function createPlugin({ manifest }) {
          return {
            manifest,
            async runCommand(commandId) {
              if (commandId === 'crash') {
                process.exit(23);
              }
              return { ok: true, data: { pid: process.pid } };
            }
          };
        }
      `,
    );

    const result = await loadExternalPlugins({
      paths: [pluginDir],
      permissions: 'all',
      publishEvent: (_pluginId, type, payload) => {
        events.push({ type, payload });
        return { id: 'event', pluginId: 'external.demo', type, payload, time: Date.now() };
      },
    });
    const first = await result.plugins[0].runCommand?.('pid');

    await expect(result.plugins[0].runCommand?.('crash')).rejects.toThrow('Plugin process exited');
    const second = await result.plugins[0].runCommand?.('pid');

    expect(first?.data).toEqual(expect.objectContaining({ pid: expect.any(Number) }));
    expect(second?.data).toEqual(expect.objectContaining({ pid: expect.any(Number) }));
    expect((first?.data as { pid: number }).pid).not.toBe((second?.data as { pid: number }).pid);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'runtime.crashed',
        payload: expect.objectContaining({ restartCount: 1 }),
      }),
    ]);
    await result.plugins[0].stop?.();
  });

  it('loads from environment options and supports disabling external plugins', async () => {
    const pluginDir = await createPluginDir();
    await writePlugin(
      pluginDir,
      manifest(),
      'export default function createPlugin({ manifest }) { return { manifest }; }',
    );

    const loaded = await loadExternalPluginsFromEnv({
      DOCKSCOPE_PLUGIN_PATHS: pluginDir,
      DOCKSCOPE_PLUGIN_PERMISSIONS: 'all',
    });
    const disabled = await loadExternalPluginsFromEnv({
      DOCKSCOPE_DISABLE_EXTERNAL_PLUGINS: '1',
      DOCKSCOPE_PLUGIN_PATHS: pluginDir,
      DOCKSCOPE_PLUGIN_PERMISSIONS: 'all',
    });

    expect(loaded.plugins.map((plugin) => plugin.manifest.id)).toEqual(['external.demo']);
    expect(disabled.plugins).toEqual([]);
    expect(disabled.configs).toBeInstanceOf(Map);
    expect(disabled.errors).toEqual([]);
  });
});
