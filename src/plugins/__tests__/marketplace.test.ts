import { generateKeyPairSync } from 'crypto';
import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../../core/plugins';
import { PLUGIN_CATALOG_FORMAT } from '../catalog';
import { createPluginMarketplaceService } from '../marketplace';
import { createPluginPackageFromPath } from '../package';

async function createPluginDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dockscope-marketplace-plugin-'));
  const pluginDir = path.join(root, 'plugin');
  await mkdir(pluginDir);
  await writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'marketplace.demo',
      name: 'Marketplace Demo',
      version: '1.0.0',
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
    "export default function createPlugin({ manifest }) { return { manifest, runCommand() { return { ok: true, message: 'hi' }; } }; }",
    'utf-8',
  );
  return pluginDir;
}

describe('plugin marketplace', () => {
  it('installs catalog plugins into the running registry and uninstalls them', async () => {
    const pluginDir = await createPluginDir();
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dockscope-marketplace-out-'));
    const packagePath = path.join(outputDir, 'marketplace-demo.dockscope-plugin');
    const registryDir = path.join(outputDir, 'registry');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const bundle = await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile: packagePath,
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      keyId: 'test-key',
    });
    const catalogPath = path.join(outputDir, 'catalog.json');
    await writeFile(
      catalogPath,
      JSON.stringify(
        {
          format: PLUGIN_CATALOG_FORMAT,
          name: 'Marketplace Catalog',
          entries: [
            {
              id: 'marketplace.demo',
              name: 'Marketplace Demo',
              version: '1.0.0',
              capabilities: ['ui.command'],
              permissions: [],
              packageUrl: './marketplace-demo.dockscope-plugin',
              packageSha256: bundle.sha256,
              signature: {
                algorithm: 'ed25519',
                publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
                keyId: 'test-key',
              },
            },
          ],
        },
        null,
        2,
      ),
      'utf-8',
    );
    const registry = new PluginRegistry();
    const service = createPluginMarketplaceService(
      {
        DOCKSCOPE_PLUGIN_CATALOG: catalogPath,
        DOCKSCOPE_PLUGIN_REGISTRY: registryDir,
        DOCKSCOPE_PLUGIN_PERMISSIONS: 'all',
        DOCKSCOPE_PLUGIN_CONFIG: path.join(outputDir, 'config.json'),
        DOCKSCOPE_PLUGIN_STATE: path.join(outputDir, 'state.json'),
        DOCKSCOPE_PLUGIN_SECRETS: path.join(outputDir, 'secrets.json'),
      },
      registry,
    );

    await expect(service.list()).resolves.toMatchObject({
      configured: true,
      entries: [{ id: 'marketplace.demo', state: 'available' }],
    });

    await expect(service.install('marketplace.demo')).resolves.toMatchObject({
      entries: [{ id: 'marketplace.demo', state: 'installed' }],
    });
    expect(registry.listPlugins()).toEqual([
      expect.objectContaining({
        manifest: expect.objectContaining({ id: 'marketplace.demo' }),
        status: 'started',
      }),
    ]);
    await expect(registry.runPluginCommand('marketplace.demo', 'hello')).resolves.toEqual({
      ok: true,
      message: 'hi',
    });

    await expect(service.uninstall('marketplace.demo')).resolves.toMatchObject({
      entries: [{ id: 'marketplace.demo', state: 'available' }],
    });
    expect(registry.listPlugins()).toEqual([]);
  });
});
