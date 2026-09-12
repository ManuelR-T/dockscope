import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPluginHostApi } from '../hostApi';
import { migratePluginStorage, pluginStorageDir } from '../storage';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'dockscope-storage-'));
  roots.push(root);
  const pluginDir = path.join(root, 'demo');
  const legacy = path.join(pluginDir, '.dockscope-storage');
  await mkdir(legacy, { recursive: true });
  const host = () =>
    createPluginHostApi({ pluginId: 'demo', pluginDir, capabilities: [], permissions: [] });
  return { pluginDir, legacy, host };
}

describe('persistent plugin storage', () => {
  it('migrates legacy data and survives replacement of the code directory', async () => {
    const { pluginDir, legacy, host } = await fixture();
    await writeFile(path.join(legacy, 'endpoints.json'), JSON.stringify([{ id: 'home' }]));
    await expect(host().readStorage('endpoints')).resolves.toEqual([{ id: 'home' }]);
    await rm(pluginDir, { recursive: true });
    await mkdir(pluginDir);
    await expect(host().readStorage('endpoints')).resolves.toEqual([{ id: 'home' }]);
    await host().writeStorage('endpoints', [{ id: 'new' }]);
    await expect(host().readStorage('endpoints')).resolves.toEqual([{ id: 'new' }]);
  });

  it('retries migration without overwriting newer data or resurrecting deleted keys', async () => {
    const { pluginDir, legacy, host } = await fixture();
    await writeFile(path.join(legacy, 'endpoints.json'), '["old"]');
    await writeFile(path.join(legacy, 'other.json'), '42');
    const directory = pluginStorageDir(pluginDir);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'endpoints.json'), '["new"]');
    await migratePluginStorage(pluginDir);
    await expect(host().readStorage('endpoints')).resolves.toEqual(['new']);
    await expect(host().readStorage('other')).resolves.toBe(42);
    await host().deleteStorage('endpoints');
    await migratePluginStorage(pluginDir);
    await expect(host().readStorage('endpoints')).resolves.toBeUndefined();
    await host().writeStorage('other', undefined);
    await expect(host().readStorage('other')).resolves.toBeUndefined();
    await expect(readFile(path.join(legacy, 'endpoints.json'), 'utf8')).resolves.toBe('["old"]');
  });

  it('fails safely on malformed legacy data and can retry after repair', async () => {
    const { pluginDir, legacy, host } = await fixture();
    await writeFile(path.join(legacy, 'bad.json'), '{invalid');
    await expect(migratePluginStorage(pluginDir)).rejects.toThrow();
    expect(await readdir(pluginStorageDir(pluginDir))).toEqual([]);
    await writeFile(path.join(legacy, 'bad.json'), 'true');
    await expect(host().readStorage('bad')).resolves.toBe(true);
  });

  it('serializes concurrent writes, publishes valid JSON, and leaves no temporary files', async () => {
    const { pluginDir, host } = await fixture();
    await Promise.all(
      Array.from({ length: 20 }, (_, value) => host().writeStorage('value', { value })),
    );
    await expect(host().readStorage('value')).resolves.toEqual({ value: 19 });
    expect(await readdir(pluginStorageDir(pluginDir))).toEqual(['.migrated', 'value.json']);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(host().writeStorage('value', circular)).rejects.toThrow();
    await expect(host().readStorage('value')).resolves.toEqual({ value: 19 });
  });

  it('isolates installations and rejects traversal keys and legacy symlinks', async () => {
    const first = await fixture();
    const second = await fixture();
    await first.host().writeStorage('value', 1);
    await expect(second.host().readStorage('value')).resolves.toBeUndefined();
    await expect(first.host().writeStorage('../escape', 1)).rejects.toThrow(
      'Invalid plugin storage key',
    );
    const third = await fixture();
    await symlink(
      path.join(pluginStorageDir(first.pluginDir), 'value.json'),
      path.join(third.legacy, 'value.json'),
    );
    await expect(third.host().readStorage('value')).rejects.toThrow('Invalid legacy');
  });
});
