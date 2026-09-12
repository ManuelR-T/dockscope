import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginFactory } from '../../core/plugin-contract/api';
import { validatePluginManifest } from '../../core/plugin-contract/manifest';
import { PKG_VERSION } from '../../version';
import { writePluginScaffold } from '../scaffold';
import { createPluginHostApi } from '../hostApi';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('plugin scaffolding', () => {
  it.each(['command', 'graph'])(
    'writes a runnable %s plugin and its editor configuration',
    async (template) => {
      const root = await mkdtemp(path.join(tmpdir(), 'dockscope-scaffold-test-'));
      roots.push(root);
      const dir = path.join(root, 'nested', 'plugin');
      await writePluginScaffold({ dir, id: 'test.scaffold', name: 'Scaffold', template });
      expect((await readdir(dir)).sort()).toEqual([
        'README.md',
        'jsconfig.json',
        'package.json',
        'plugin.json',
        'plugin.mjs',
      ]);
      const manifest = validatePluginManifest(
        JSON.parse(await readFile(path.join(dir, 'plugin.json'), 'utf8')),
      );
      const factory = (
        await import(/* @vite-ignore */ pathToFileURL(path.join(dir, 'plugin.mjs')).href)
      ).default as PluginFactory;
      const publishEvent = vi.fn();
      const plugin = await factory({
        manifest,
        pluginDir: dir,
        config: {},
        logger: console,
        host: createPluginHostApi({
          pluginId: manifest.id,
          pluginDir: dir,
          capabilities: manifest.capabilities,
          permissions: [],
          publishEvent,
        }),
      });
      expect(plugin.manifest.id).toBe('test.scaffold');
      expect(
        await plugin.runCommand?.(template === 'graph' ? 'refresh' : 'hello', { name: 'Manuel' }),
      ).toMatchObject({ ok: true });
      expect(publishEvent).toHaveBeenCalled();
      const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
      expect(pkg.peerDependencies.dockscope).toBe(`>=${PKG_VERSION}`);
      const config = JSON.parse(await readFile(path.join(dir, 'jsconfig.json'), 'utf8'));
      expect(config.compilerOptions.checkJs).toBe(true);
      expect(await readFile(path.join(dir, 'README.md'), 'utf8')).toContain('test.scaffold');
    },
  );
});
