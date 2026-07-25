import { generateKeyPairSync } from 'crypto';
import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { PluginRegistry, type PluginManifest } from '../../core/plugins';
import type { PluginPermission } from '../../core/capabilities';
import { PLUGIN_CATALOG_FORMAT, signPluginCatalogFile } from '../catalog';
import { listInstalledPlugins } from '../install';
import { createPluginRegistry, installedPermissionGrants } from '../internal';
import { createPluginMarketplaceService } from '../marketplace';
import { createPluginPackageFromPath } from '../package';
import { OFFICIAL_PLUGIN_CATALOG_NAME } from '../catalogConfig';

async function createPluginDir(
  options: {
    version?: string;
    moduleSource?: string;
    permissions?: readonly PluginPermission[];
  } = {},
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dockscope-marketplace-plugin-'));
  const pluginDir = path.join(root, 'plugin');
  await mkdir(pluginDir);
  await writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'marketplace.demo',
      name: 'Marketplace Demo',
      version: options.version ?? '1.0.0',
      dockscopeApiVersion: '1',
      entry: './plugin.mjs',
      capabilities: ['ui.command'],
      permissions: options.permissions ?? [],
      commands: [{ id: 'hello', title: 'Hello' }],
    }),
    'utf-8',
  );
  await writeFile(
    path.join(pluginDir, 'plugin.mjs'),
    options.moduleSource ??
      "export default function createPlugin({ manifest }) { return { manifest, runCommand() { return { ok: true, message: 'hi' }; } }; }",
    'utf-8',
  );
  return pluginDir;
}

async function writeSignedCatalog(options: {
  catalogPath: string;
  packagePath: string;
  packageSha256: string;
  version: string;
  publicKey: string;
  privateKey: string;
  compatibility?: { minDockscopeVersion?: string; maxDockscopeVersion?: string };
  permissions?: readonly PluginPermission[];
}): Promise<void> {
  await writeFile(
    options.catalogPath,
    JSON.stringify(
      {
        format: PLUGIN_CATALOG_FORMAT,
        name: 'Marketplace Catalog',
        entries: [
          {
            id: 'marketplace.demo',
            name: 'Marketplace Demo',
            version: options.version,
            license: 'MIT',
            publishedAt: '2026-07-10T19:00:00.000Z',
            releaseNotes: 'Adds marketplace command support',
            compatibility: options.compatibility ?? {
              minDockscopeVersion: '0.7.0',
            },
            capabilities: ['ui.command'],
            permissions: options.permissions ?? [],
            packageUrl: `./${path.basename(options.packagePath)}`,
            packageSha256: options.packageSha256,
            signature: {
              algorithm: 'ed25519',
              publicKey: options.publicKey,
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
  await signPluginCatalogFile({
    catalogPath: options.catalogPath,
    privateKey: options.privateKey,
    keyId: 'catalog-key',
  });
}

describe('plugin marketplace', () => {
  it('installs catalog plugins into the running registry and uninstalls them', async () => {
    const pluginDir = await createPluginDir();
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dockscope-marketplace-out-'));
    const packagePath = path.join(outputDir, 'marketplace-demo.dockscope-plugin');
    const registryDir = path.join(outputDir, 'registry');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const bundle = await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile: packagePath,
      privateKey: privateKeyPem,
      keyId: 'test-key',
    });
    const catalogPath = path.join(outputDir, 'catalog.json');
    await writeSignedCatalog({
      catalogPath,
      packagePath,
      packageSha256: bundle.sha256,
      version: '1.0.0',
      publicKey: publicKeyPem,
      privateKey: privateKeyPem,
    });
    const registry = new PluginRegistry();
    const service = createPluginMarketplaceService(
      {
        DOCKSCOPE_PLUGIN_CATALOG: catalogPath,
        DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG: '1',
        DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY: publicKeyPem,
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
      catalogSignatureVerified: true,
      entries: [
        {
          id: 'marketplace.demo',
          state: 'available',
          license: 'MIT',
          releaseNotes: 'Adds marketplace command support',
          compatibility: { minDockscopeVersion: '0.7.0' },
        },
      ],
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

  it('grants reviewed catalog permissions on install without a global permission policy', async () => {
    const pluginDir = await createPluginDir({ permissions: ['network.http', 'process.exec'] });
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dockscope-marketplace-grants-'));
    const packagePath = path.join(outputDir, 'marketplace-demo.dockscope-plugin');
    const registryDir = path.join(outputDir, 'registry');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const bundle = await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile: packagePath,
      privateKey: privateKeyPem,
      keyId: 'test-key',
    });
    const catalogPath = path.join(outputDir, 'catalog.json');
    await writeSignedCatalog({
      catalogPath,
      packagePath,
      packageSha256: bundle.sha256,
      version: '1.0.0',
      publicKey: publicKeyPem,
      privateKey: privateKeyPem,
      permissions: ['network.http', 'process.exec'],
    });
    const registry = new PluginRegistry();
    const env = {
      DOCKSCOPE_PLUGIN_CATALOG: catalogPath,
      DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG: '1',
      DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY: publicKeyPem,
      DOCKSCOPE_PLUGIN_REGISTRY: registryDir,
      DOCKSCOPE_PLUGIN_PATHS: registryDir,
      DOCKSCOPE_PLUGIN_CONFIG: path.join(outputDir, 'config.json'),
      DOCKSCOPE_PLUGIN_STATE: path.join(outputDir, 'state.json'),
      DOCKSCOPE_PLUGIN_SECRETS: path.join(outputDir, 'secrets.json'),
      DOCKSCOPE_PLUGIN_EVENTS: path.join(outputDir, 'events.json'),
      DOCKSCOPE_PLUGIN_APPROVALS: path.join(outputDir, 'approvals.json'),
    };
    const service = createPluginMarketplaceService(env, registry);

    await service.install('marketplace.demo');

    expect(registry.listPlugins()).toEqual([
      expect.objectContaining({
        manifest: expect.objectContaining({ id: 'marketplace.demo' }),
        status: 'started',
      }),
    ]);
    const installed = await listInstalledPlugins(registryDir);
    expect(installed).toMatchObject([
      { id: 'marketplace.demo', grantedPermissions: ['network.http', 'process.exec'] },
    ]);

    // A restarting server resolves the same grants from the install registry,
    // scoped to the installed directory only.
    const grants = await installedPermissionGrants(env);
    const manifest = { id: 'marketplace.demo' } as unknown as PluginManifest;
    expect(grants(manifest, path.join(installed[0].path, 'plugin.json'))).toEqual([
      'network.http',
      'process.exec',
    ]);
    expect(grants(manifest, path.join(outputDir, 'plugin.json'))).toEqual([]);
    const differentManifest = { id: 'marketplace.other' } as unknown as PluginManifest;
    expect(grants(differentManifest, path.join(installed[0].path, 'plugin.json'))).toEqual([]);

    const restartedRegistry = await createPluginRegistry(env);
    expect(restartedRegistry.listPlugins()).toContainEqual(
      expect.objectContaining({
        manifest: expect.objectContaining({
          id: 'marketplace.demo',
          permissions: ['network.http', 'process.exec'],
        }),
      }),
    );
  });

  it('refuses to install a package needing permissions the catalog did not declare', async () => {
    const pluginDir = await createPluginDir({ permissions: ['network.http', 'process.exec'] });
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dockscope-marketplace-excess-'));
    const packagePath = path.join(outputDir, 'marketplace-demo.dockscope-plugin');
    const registryDir = path.join(outputDir, 'registry');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const bundle = await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile: packagePath,
      privateKey: privateKeyPem,
      keyId: 'test-key',
    });
    const catalogPath = path.join(outputDir, 'catalog.json');
    await writeSignedCatalog({
      catalogPath,
      packagePath,
      packageSha256: bundle.sha256,
      version: '1.0.0',
      publicKey: publicKeyPem,
      privateKey: privateKeyPem,
      permissions: ['network.http'],
    });
    const registry = new PluginRegistry();
    const service = createPluginMarketplaceService(
      {
        DOCKSCOPE_PLUGIN_CATALOG: catalogPath,
        DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG: '1',
        DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY: publicKeyPem,
        DOCKSCOPE_PLUGIN_REGISTRY: registryDir,
        DOCKSCOPE_PLUGIN_CONFIG: path.join(outputDir, 'config.json'),
        DOCKSCOPE_PLUGIN_STATE: path.join(outputDir, 'state.json'),
        DOCKSCOPE_PLUGIN_SECRETS: path.join(outputDir, 'secrets.json'),
      },
      registry,
    );

    await expect(service.install('marketplace.demo')).rejects.toThrow(
      'Plugin package permissions do not match catalog: marketplace.demo',
    );
    expect(registry.listPlugins()).toEqual([]);
    await expect(listInstalledPlugins(registryDir)).resolves.toEqual([]);
  });

  it('blocks incompatible catalog plugins before install', async () => {
    const pluginDir = await createPluginDir();
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dockscope-marketplace-compat-'));
    const packagePath = path.join(outputDir, 'marketplace-demo.dockscope-plugin');
    const registryDir = path.join(outputDir, 'registry');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const bundle = await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile: packagePath,
      privateKey: privateKeyPem,
      keyId: 'test-key',
    });
    const catalogPath = path.join(outputDir, 'catalog.json');
    await writeSignedCatalog({
      catalogPath,
      packagePath,
      packageSha256: bundle.sha256,
      version: '1.0.0',
      publicKey: publicKeyPem,
      privateKey: privateKeyPem,
      compatibility: { minDockscopeVersion: '99.0.0' },
    });
    const service = createPluginMarketplaceService(
      {
        DOCKSCOPE_PLUGIN_CATALOG: catalogPath,
        DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG: '1',
        DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY: publicKeyPem,
        DOCKSCOPE_PLUGIN_REGISTRY: registryDir,
        DOCKSCOPE_PLUGIN_PERMISSIONS: 'all',
      },
      new PluginRegistry(),
    );

    await expect(service.list()).resolves.toMatchObject({
      entries: [
        {
          id: 'marketplace.demo',
          state: 'available',
          compatibilityWarnings: ['Requires DockScope 99.0.0 or newer'],
        },
      ],
    });
    await expect(service.install('marketplace.demo')).rejects.toThrow(
      'Plugin is not compatible with DockScope',
    );
    await expect(listInstalledPlugins(registryDir)).resolves.toEqual([]);
  });

  it('restores the previous installed plugin if an update cannot load', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dockscope-marketplace-rollback-'));
    const registryDir = path.join(outputDir, 'registry');
    const catalogPath = path.join(outputDir, 'catalog.json');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const stablePackagePath = path.join(outputDir, 'marketplace-demo-1.0.0.dockscope-plugin');
    const stableBundle = await createPluginPackageFromPath({
      sourcePath: await createPluginDir({ version: '1.0.0' }),
      outFile: stablePackagePath,
      privateKey: privateKeyPem,
      keyId: 'test-key',
    });
    await writeSignedCatalog({
      catalogPath,
      packagePath: stablePackagePath,
      packageSha256: stableBundle.sha256,
      version: '1.0.0',
      publicKey: publicKeyPem,
      privateKey: privateKeyPem,
    });
    const registry = new PluginRegistry();
    const service = createPluginMarketplaceService(
      {
        DOCKSCOPE_PLUGIN_CATALOG: catalogPath,
        DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG: '1',
        DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY: publicKeyPem,
        DOCKSCOPE_PLUGIN_REGISTRY: registryDir,
        DOCKSCOPE_PLUGIN_PERMISSIONS: 'all',
        DOCKSCOPE_PLUGIN_STATE: path.join(outputDir, 'state.json'),
      },
      registry,
    );

    await service.install('marketplace.demo');

    const brokenPackagePath = path.join(outputDir, 'marketplace-demo-1.1.0.dockscope-plugin');
    const brokenBundle = await createPluginPackageFromPath({
      sourcePath: await createPluginDir({
        version: '1.1.0',
        moduleSource:
          "export default function createPlugin({ manifest }) { return { manifest: { ...manifest, id: 'marketplace.broken' } }; }",
      }),
      outFile: brokenPackagePath,
      privateKey: privateKeyPem,
      keyId: 'test-key',
    });
    await writeSignedCatalog({
      catalogPath,
      packagePath: brokenPackagePath,
      packageSha256: brokenBundle.sha256,
      version: '1.1.0',
      publicKey: publicKeyPem,
      privateKey: privateKeyPem,
    });

    await expect(service.update('marketplace.demo')).rejects.toThrow(
      'Installed plugin could not be loaded',
    );
    expect(registry.listPlugins()).toEqual([
      expect.objectContaining({
        manifest: expect.objectContaining({ id: 'marketplace.demo', version: '1.0.0' }),
        status: 'started',
      }),
    ]);
    await expect(registry.runPluginCommand('marketplace.demo', 'hello')).resolves.toEqual({
      ok: true,
      message: 'hi',
    });
    await expect(listInstalledPlugins(registryDir)).resolves.toMatchObject([
      { id: 'marketplace.demo', version: '1.0.0' },
    ]);
  });

  it('keeps the marketplace available when the default catalog is offline', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dockscope-marketplace-offline-'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    try {
      const service = createPluginMarketplaceService(
        { DOCKSCOPE_PLUGIN_REGISTRY: path.join(outputDir, 'registry') },
        new PluginRegistry(),
      );

      await expect(service.list()).resolves.toMatchObject({
        configured: true,
        catalogName: OFFICIAL_PLUGIN_CATALOG_NAME,
        catalogError: expect.stringContaining('offline'),
        entries: [],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
