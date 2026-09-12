import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { installPluginFromPath, listInstalledPlugins, uninstallPlugin } from '../install';
import { createPluginHostApi } from '../hostApi';
import { pluginStorageDir } from '../storage';
import { createPluginPackageFromPath } from '../package';
import { generateKeyPairSync } from 'crypto';

async function createPluginDir(
  version: string,
  id = 'install.demo',
  permissions: string[] = [],
): Promise<string> {
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
      permissions,
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
  it('preserves legacy and current endpoint data across signed package upgrades and reinstall', async () => {
    const registryDir = await mkdtemp(path.join(tmpdir(), 'dockscope-install-storage-'));
    const pluginDir = path.join(registryDir, 'install.demo');
    await installPluginFromPath({ sourcePath: await createPluginDir('1.0.0'), registryDir });
    // Reproduce an installation written by an older host, before persistent storage existed.
    await rm(pluginStorageDir(pluginDir), { recursive: true });
    const legacy = path.join(pluginDir, '.dockscope-storage');
    await mkdir(legacy);
    const endpoints = [{ id: 'home', url: 'http://home.local' }];
    await writeFile(path.join(legacy, 'endpoints.json'), JSON.stringify(endpoints));
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const outFile = path.join(registryDir, 'upgrade.dockscope-plugin');
    await createPluginPackageFromPath({
      sourcePath: await createPluginDir('2.0.0'),
      outFile,
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    const upgrade = () =>
      installPluginFromPath({
        sourcePath: outFile,
        registryDir,
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      });
    await upgrade();
    const host = () =>
      createPluginHostApi({
        pluginId: 'install.demo',
        pluginDir,
        capabilities: [],
        permissions: [],
      });
    await expect(host().readStorage('endpoints')).resolves.toEqual(endpoints);
    await host().writeStorage('endpoints', [...endpoints, { id: 'other' }]);
    await upgrade();
    await expect(host().readStorage('endpoints')).resolves.toHaveLength(2);
    await uninstallPlugin('install.demo', registryDir);
    await upgrade();
    await expect(host().readStorage('endpoints')).resolves.toHaveLength(2);
  });

  it('does not replace legacy code or data when migration fails', async () => {
    const registryDir = await mkdtemp(path.join(tmpdir(), 'dockscope-install-migration-'));
    const installed = await installPluginFromPath({
      sourcePath: await createPluginDir('1.0.0'),
      registryDir,
    });
    await rm(pluginStorageDir(installed.path), { recursive: true });
    const legacy = path.join(installed.path, '.dockscope-storage');
    await mkdir(legacy);
    await writeFile(path.join(legacy, 'endpoints.json'), '{invalid');
    await expect(
      installPluginFromPath({ sourcePath: await createPluginDir('2.0.0'), registryDir }),
    ).rejects.toThrow();
    await expect(listInstalledPlugins(registryDir)).resolves.toMatchObject([{ version: '1.0.0' }]);
    await expect(readFile(path.join(legacy, 'endpoints.json'), 'utf8')).resolves.toBe('{invalid');
  });

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

  it('records granted permissions at install time and honors explicit grants', async () => {
    const registryDir = await mkdtemp(path.join(tmpdir(), 'dockscope-install-grants-'));
    await installPluginFromPath({
      sourcePath: await createPluginDir('1.0.0', 'install.demo', ['network.http', 'process.exec']),
      registryDir,
    });

    await expect(listInstalledPlugins(registryDir)).resolves.toMatchObject([
      { id: 'install.demo', grantedPermissions: ['network.http', 'process.exec'] },
    ]);

    await installPluginFromPath({
      sourcePath: await createPluginDir('1.1.0', 'install.demo', ['network.http', 'process.exec']),
      registryDir,
      grantedPermissions: ['network.http'],
    });

    await expect(listInstalledPlugins(registryDir)).resolves.toMatchObject([
      { id: 'install.demo', version: '1.1.0', grantedPermissions: ['network.http'] },
    ]);
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
