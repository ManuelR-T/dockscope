import { generateKeyPairSync } from 'crypto';
import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createPluginPackageFromPath } from '../package';
import { installPluginFromCatalog, loadPluginCatalog, PLUGIN_CATALOG_FORMAT } from '../catalog';

async function createPluginDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dockscope-catalog-plugin-'));
  const pluginDir = path.join(root, 'plugin');
  await mkdir(pluginDir);
  await writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'catalog.demo',
      name: 'Catalog Demo',
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
    'export default function createPlugin({ manifest }) { return { manifest, runCommand() { return { ok: true }; } }; }',
    'utf-8',
  );
  return pluginDir;
}

describe('plugin catalog', () => {
  it('loads catalog entries and installs signed packages', async () => {
    const pluginDir = await createPluginDir();
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dockscope-catalog-out-'));
    const packagePath = path.join(outputDir, 'catalog-demo.dockscope-plugin');
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
          name: 'Test Catalog',
          entries: [
            {
              id: 'catalog.demo',
              name: 'Catalog Demo',
              version: '1.0.0',
              description: 'Demo plugin',
              capabilities: ['ui.command'],
              permissions: [],
              packageUrl: './catalog-demo.dockscope-plugin',
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

    const catalog = await loadPluginCatalog(catalogPath);
    const installed = await installPluginFromCatalog({
      catalogSource: catalogPath,
      pluginId: 'catalog.demo',
      registryDir,
    });

    expect(catalog.entries[0]).toMatchObject({
      id: 'catalog.demo',
      resolvedPackageUrl: packagePath,
    });
    expect(installed).toMatchObject({
      id: 'catalog.demo',
      version: '1.0.0',
      signatureVerified: true,
    });
  });
});
