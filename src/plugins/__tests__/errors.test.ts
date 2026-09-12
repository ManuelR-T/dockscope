import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { loadExternalPlugins } from '../loader';
import { isDockscopeError } from '../../core/errors';
import type { DockscopePlugin } from '../../core/plugin-contract/manifest';

const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function load(isolation: 'process' | 'in-process'): Promise<DockscopePlugin> {
  const root = await mkdtemp(path.join(tmpdir(), 'dockscope-plugin-errors-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const pluginDir = path.join(root, 'plugin');
  await mkdir(pluginDir);
  // A real second copy of the SDK class, like a bundled third-party plugin.
  const bundledErrors = ts.transpileModule(await readFile('src/core/errors.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  await writeFile(path.join(pluginDir, 'errors.mjs'), bundledErrors);
  await writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'test.errors',
      name: 'Errors',
      version: '1.0.0',
      dockscopeApiVersion: '1',
      entry: './plugin.mjs',
      capabilities: ['ui.command', 'source.graph', 'source.events'],
      permissions: [],
      execution: { isolation },
      commands: ['classified', 'denied', 'unknown'].map((id) => ({ id, title: id })),
    }),
  );
  await writeFile(
    path.join(pluginDir, 'plugin.mjs'),
    `
    import { DockscopeError } from './errors.mjs';
    export default function ({ manifest, host }) {
      const source = { id: 'test.errors', label: 'Errors', kind: 'plugin', status: 'connected', capabilities: ['source.graph', 'source.events'] };
      return { manifest,
        async runCommand(id) {
          if (id === 'classified') throw new DockscopeError('Enter a name', { code: 'PLUGIN_INPUT_INVALID', category: 'validation', cause: new Error('private cause') });
          if (id === 'denied') await host.readTextFile('private.txt');
          throw new Error('private backend detail');
        },
        getGraphSources: () => [{
          describe: () => source,
          collectGraph: async () => ({ source, graph: { nodes: [], links: [] }, collectedAt: Date.now() }),
          startEvents(_onEvent, onError) {
            queueMicrotask(() => onError(new DockscopeError('Event source unavailable', { code: 'PLUGIN_EVENTS_UNAVAILABLE', category: 'unavailable' })));
            return () => {};
          },
        }],
      };
    }
  `,
  );
  const loaded = await loadExternalPlugins({ paths: [pluginDir], permissions: [] });
  expect(loaded.errors).toEqual([]);
  const plugin = loaded.plugins[0];
  cleanups.push(() => plugin.stop?.());
  return plugin;
}

describe('plugin error transport', () => {
  it.each(['process', 'in-process'] as const)(
    'recognizes errors from a bundled SDK (%s)',
    async (isolation) => {
      const plugin = await load(isolation);
      const error = await Promise.resolve()
        .then(() => plugin.runCommand!('classified'))
        .catch((cause: unknown) => cause);
      expect(isDockscopeError(error)).toBe(true);
      expect(error).toMatchObject({
        message: 'Enter a name',
        code: 'PLUGIN_INPUT_INVALID',
        category: 'validation',
      });
      if (isolation === 'process') {
        expect((error as Error).cause).toBeUndefined();
      }
    },
  );

  it('preserves host permission errors across the host-to-worker-to-host round trip', async () => {
    const plugin = await load('process');
    await expect(plugin.runCommand!('denied')).rejects.toMatchObject({
      name: 'PluginPermissionError',
      code: 'PLUGIN_PERMISSION_DENIED',
      category: 'permission',
      message: 'Plugin "test.errors" requires permission "filesystem.read"',
    });
  });

  it('retains unknown worker failures as internal diagnostics', async () => {
    const plugin = await load('process');
    await expect(plugin.runCommand!('unknown')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      category: 'internal',
      message: 'private backend detail',
    });
  });

  it('preserves classifications on worker event streams', async () => {
    const plugin = await load('process');
    const error = await new Promise<Error>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No stream error received')), 3000);
      const stop = plugin.getGraphSources!()[0].startEvents!(
        () => {},
        (cause) => {
          clearTimeout(timer);
          resolve(cause);
        },
      );
      cleanups.push(stop);
    });
    expect(isDockscopeError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'PLUGIN_EVENTS_UNAVAILABLE', category: 'unavailable' });
  });
});
