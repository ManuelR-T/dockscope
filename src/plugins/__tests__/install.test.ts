import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { installPluginFromPath, listInstalledPlugins, uninstallPlugin } from '../install';

async function createPluginDir(version: string, id = 'install.demo'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dockscope-install-source-'));
  const pluginDir = path.join(root, 'plugin');
  await mkdir(pluginDir);
  await writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id,
      name: `Install ${id}`,
      version,
      dockscopeApiVersion: '1',
      entry: './plugin.mjs',
      capabilities: ['ui.command'],
      permissions: [],
      commands: [{ id: 'hello', title: 'Hello' }],
    }),
    'utf-8',
  );
  await writeFile(
    path.join(pluginDir, 'plugin.mjs'),
    `export default function createPlugin({ manifest }) { return { manifest, version: '${version}' }; }`,
    'utf-8',
  );
  return pluginDir;
}

describe('plugin installation', () => {
  it('atomically replaces installed plugin contents and index records', async () => {
    const registryDir = await mkdtemp(path.join(tmpdir(), 'dockscope-install-registry-'));
    await installPluginFromPath({
      sourcePath: await createPluginDir('1.0.0'),
      registryDir,
    });
    await installPluginFromPath({
      sourcePath: await createPluginDir('1.1.0'),
      registryDir,
    });

    await expect(listInstalledPlugins(registryDir)).resolves.toMatchObject([
      { id: 'install.demo', version: '1.1.0' },
    ]);
    await expect(
      readFile(path.join(registryDir, 'install.demo', 'plugin.json'), 'utf-8'),
    ).resolves.toContain('1.1.0');
    expect((await readdir(registryDir)).some((entry) => entry.startsWith('.install-'))).toBe(false);
  });

  it('serializes concurrent registry updates without losing index entries', async () => {
    const registryDir = await mkdtemp(path.join(tmpdir(), 'dockscope-install-concurrent-'));
    await Promise.all([
      installPluginFromPath({
        sourcePath: await createPluginDir('1.0.0', 'install.first'),
        registryDir,
      }),
      installPluginFromPath({
        sourcePath: await createPluginDir('1.0.0', 'install.second'),
        registryDir,
      }),
    ]);

    await expect(listInstalledPlugins(registryDir)).resolves.toMatchObject([
      { id: 'install.first' },
      { id: 'install.second' },
    ]);
  });

  it('does not touch the previous plugin when the registry index is inaccessible', async () => {
    const registryDir = await mkdtemp(path.join(tmpdir(), 'dockscope-install-rollback-'));
    await installPluginFromPath({
      sourcePath: await createPluginDir('1.0.0'),
      registryDir,
    });
    const indexPath = path.join(registryDir, 'installed.json');
    await rm(indexPath);
    await mkdir(indexPath);

    await expect(
      installPluginFromPath({
        sourcePath: await createPluginDir('2.0.0'),
        registryDir,
      }),
    ).rejects.toThrow();

    await expect(
      readFile(path.join(registryDir, 'install.demo', 'plugin.json'), 'utf-8'),
    ).resolves.toContain('1.0.0');
    expect((await readdir(registryDir)).some((entry) => entry.startsWith('.install-'))).toBe(false);
  });

  it('fails closed on a corrupt index without replacing installed contents', async () => {
    const registryDir = await mkdtemp(path.join(tmpdir(), 'dockscope-install-corrupt-'));
    await installPluginFromPath({
      sourcePath: await createPluginDir('1.0.0'),
      registryDir,
    });
    await writeFile(path.join(registryDir, 'installed.json'), '{invalid', 'utf-8');

    await expect(
      installPluginFromPath({
        sourcePath: await createPluginDir('2.0.0'),
        registryDir,
      }),
    ).rejects.toThrow('Plugin install index is invalid');
    await expect(
      readFile(path.join(registryDir, 'install.demo', 'plugin.json'), 'utf-8'),
    ).resolves.toContain('1.0.0');
  });

  it('derives uninstall paths from the registry instead of stored index data', async () => {
    const registryDir = await mkdtemp(path.join(tmpdir(), 'dockscope-uninstall-path-'));
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'dockscope-uninstall-outside-'));
    const sentinelPath = path.join(outsideDir, 'sentinel.txt');
    await writeFile(sentinelPath, 'keep', 'utf-8');
    await installPluginFromPath({
      sourcePath: await createPluginDir('1.0.0'),
      registryDir,
    });
    const indexPath = path.join(registryDir, 'installed.json');
    const index = JSON.parse(await readFile(indexPath, 'utf-8')) as Record<
      string,
      Record<string, unknown>
    >;
    index['install.demo'].path = outsideDir;
    await writeFile(indexPath, JSON.stringify(index), 'utf-8');

    await expect(uninstallPlugin('install.demo', registryDir)).resolves.toBe(true);
    await expect(readFile(sentinelPath, 'utf-8')).resolves.toBe('keep');
  });
});
