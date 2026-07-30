import { generateKeyPairSync } from 'crypto';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../../core/plugins';
import { PLUGIN_CATALOG_FORMAT, signPluginCatalogFile } from '../catalog';
import { OFFICIAL_PLUGIN_CATALOG_URL } from '../catalogConfig';
import { createPluginMarketplaceService } from '../marketplace';

/** A signed catalog plus the public key published beside it. */
async function signedCatalog(options: { publishKey?: 'correct' | 'wrong' } = {}): Promise<{
  dir: string;
  source: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dockscope-catalog-add-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const source = path.join(dir, 'catalog.json');

  await writeFile(
    source,
    JSON.stringify({
      format: PLUGIN_CATALOG_FORMAT,
      name: 'Acme Plugins',
      updatedAt: '2026-07-29T00:00:00.000Z',
      entries: [
        {
          id: 'acme.hello',
          name: 'Acme Hello',
          version: '1.0.0',
          capabilities: ['ui.command'],
          permissions: [],
          packageUrl: './acme.hello.dockscope-plugin',
          packageSha256: 'a'.repeat(64),
        },
      ],
    }),
    'utf-8',
  );
  await signPluginCatalogFile({
    catalogPath: source,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    keyId: 'acme-cat-v1',
  });

  const published =
    options.publishKey === 'wrong'
      ? generateKeyPairSync('ed25519').publicKey
      : (publicKey as ReturnType<typeof generateKeyPairSync>['publicKey']);
  await writeFile(
    path.join(dir, 'catalog.public.pem'),
    published.export({ type: 'spki', format: 'pem' }).toString(),
    'utf-8',
  );
  return { dir, source };
}

function service(dir: string, extra: NodeJS.ProcessEnv = {}) {
  return createPluginMarketplaceService(
    {
      DOCKSCOPE_PLUGIN_CATALOGS: path.join(dir, 'catalogs.json'),
      DOCKSCOPE_PLUGIN_REGISTRY: path.join(dir, 'registry'),
      DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG: '1',
      DOCKSCOPE_DISABLE_EXTERNAL_PLUGINS: '1',
      ...extra,
    },
    new PluginRegistry(),
  );
}

describe('adding catalogs through the marketplace', () => {
  it('trusts a verified catalog and pins its key', async () => {
    const { dir, source } = await signedCatalog();
    const subject = service(dir);

    const snapshot = await subject.addCatalog(source);

    expect(snapshot.catalogs).toHaveLength(1);
    expect(snapshot.catalogs[0]).toMatchObject({
      name: 'Acme Plugins',
      userAdded: true,
      signatureVerified: true,
    });
    expect(snapshot.entries.map((entry) => entry.id)).toEqual(['acme.hello']);

    const stored = await subject.listCatalogs();
    expect(stored[0]).toMatchObject({ source, keyId: 'acme-cat-v1' });
    expect(stored[0]?.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(stored[0]?.fingerprint).toMatch(/^[0-9a-f]{4} /);
  });

  it('refuses a catalog whose published key does not match its signature', async () => {
    const { dir, source } = await signedCatalog({ publishKey: 'wrong' });
    const subject = service(dir);

    await expect(subject.addCatalog(source)).rejects.toThrow(/does not match its signature/i);
    await expect(subject.listCatalogs()).resolves.toEqual([]);
  });

  it('refuses a source that is already an active catalog', async () => {
    // Storing a record for an already-active catalog would mark it user-added
    // and give it a Remove control that could not actually remove it.
    const { dir } = await signedCatalog();
    const subject = service(dir, { DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG: '' });

    await expect(subject.addCatalog(OFFICIAL_PLUGIN_CATALOG_URL)).rejects.toThrow(
      /already configured/i,
    );
    await expect(subject.listCatalogs()).resolves.toEqual([]);
  });

  it('refuses adding the same catalog twice', async () => {
    const { dir, source } = await signedCatalog();
    const subject = service(dir);

    await subject.addCatalog(source);
    await expect(subject.addCatalog(source)).rejects.toThrow(/already configured/i);
    await expect(subject.listCatalogs()).resolves.toHaveLength(1);
  });

  it('rejects a blank source', async () => {
    const { dir } = await signedCatalog();
    await expect(service(dir).addCatalog('  ')).rejects.toThrow(/required/i);
  });

  it('removes a user-added catalog and reports an unknown one', async () => {
    const { dir, source } = await signedCatalog();
    const subject = service(dir);

    await subject.addCatalog(source);
    const snapshot = await subject.removeCatalog(source);
    expect(snapshot.catalogs).toHaveLength(0);
    expect(snapshot.entries).toHaveLength(0);

    await expect(subject.removeCatalog(source)).rejects.toThrow(/not added/i);
  });
});
