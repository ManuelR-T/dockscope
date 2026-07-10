import { generateKeyPairSync } from 'crypto';
import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createPluginPackageFromPath } from '../package';
import {
  installPluginFromCatalog,
  loadPluginCatalog,
  PLUGIN_CATALOG_FORMAT,
  signPluginCatalogFile,
} from '../catalog';

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
              license: 'MIT',
              publishedAt: '2026-07-10T19:00:00.000Z',
              releaseNotes: 'Initial catalog release',
              compatibility: {
                minDockscopeVersion: '0.7.0',
              },
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
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await signPluginCatalogFile({
      catalogPath,
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      keyId: 'catalog-key',
    });

    const catalog = await loadPluginCatalog(catalogPath, { publicKey: publicKeyPem });
    const installed = await installPluginFromCatalog({
      catalogSource: catalogPath,
      pluginId: 'catalog.demo',
      registryDir,
      catalogPublicKey: publicKeyPem,
    });

    expect(catalog.signatureVerified).toBe(true);
    expect(catalog.entries[0]).toMatchObject({
      id: 'catalog.demo',
      resolvedPackageUrl: packagePath,
      license: 'MIT',
      releaseNotes: 'Initial catalog release',
      compatibility: {
        minDockscopeVersion: '0.7.0',
      },
    });
    expect(installed).toMatchObject({
      id: 'catalog.demo',
      version: '1.0.0',
      signatureVerified: true,
    });
  });

  it('rejects unsigned and yanked catalog entries before installing', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dockscope-catalog-policy-'));
    const catalogPath = path.join(outputDir, 'catalog.json');
    await writeFile(
      catalogPath,
      JSON.stringify(
        {
          format: PLUGIN_CATALOG_FORMAT,
          name: 'Policy Catalog',
          entries: [
            {
              id: 'catalog.unsigned',
              name: 'Unsigned',
              version: '1.0.0',
              capabilities: ['ui.command'],
              permissions: [],
              packageUrl: './missing.dockscope-plugin',
            },
            {
              id: 'catalog.yanked',
              name: 'Yanked',
              version: '1.0.0',
              status: 'yanked',
              capabilities: ['ui.command'],
              permissions: [],
              packageUrl: './missing.dockscope-plugin',
            },
            {
              id: 'catalog.incompatible',
              name: 'Incompatible',
              version: '1.0.0',
              compatibility: {
                minDockscopeVersion: '99.0.0',
              },
              capabilities: ['ui.command'],
              permissions: [],
              packageUrl: './missing.dockscope-plugin',
              signature: {
                algorithm: 'ed25519',
                publicKey: '-----BEGIN PUBLIC KEY-----\\nplaceholder\\n-----END PUBLIC KEY-----',
              },
            },
          ],
        },
        null,
        2,
      ),
      'utf-8',
    );

    await expect(
      installPluginFromCatalog({ catalogSource: catalogPath, pluginId: 'catalog.unsigned' }),
    ).rejects.toThrow('Plugin catalog entry is unsigned: catalog.unsigned');
    await expect(
      installPluginFromCatalog({ catalogSource: catalogPath, pluginId: 'catalog.yanked' }),
    ).rejects.toThrow('Plugin catalog entry is yanked: catalog.yanked');
    await expect(
      installPluginFromCatalog({ catalogSource: catalogPath, pluginId: 'catalog.incompatible' }),
    ).rejects.toThrow('Plugin catalog entry is incompatible');
  });

  it('requires matching catalog signatures when a catalog public key is configured', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dockscope-catalog-signature-'));
    const catalogPath = path.join(outputDir, 'catalog.json');
    const catalogKeys = generateKeyPairSync('ed25519');
    const otherKeys = generateKeyPairSync('ed25519');
    await writeFile(
      catalogPath,
      JSON.stringify(
        {
          format: PLUGIN_CATALOG_FORMAT,
          name: 'Signed Catalog',
          entries: [
            {
              id: 'catalog.demo',
              name: 'Catalog Demo',
              version: '1.0.0',
              capabilities: ['ui.command'],
              permissions: [],
              packageUrl: './missing.dockscope-plugin',
            },
          ],
        },
        null,
        2,
      ),
      'utf-8',
    );

    await expect(
      loadPluginCatalog(catalogPath, {
        publicKey: otherKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      }),
    ).rejects.toThrow('Plugin catalog is not signed');

    await signPluginCatalogFile({
      catalogPath,
      privateKey: catalogKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });

    await expect(
      loadPluginCatalog(catalogPath, {
        publicKey: otherKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      }),
    ).rejects.toThrow('Plugin catalog signature mismatch');
  });
});
