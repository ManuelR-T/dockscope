import { generateKeyPairSync } from 'crypto';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  PLUGIN_CATALOG_FORMAT,
  PLUGIN_CATALOG_TRUST_STORE_FORMAT,
  signPluginCatalogFile,
} from '../catalog';
import { previewPluginCatalog } from '../catalogPreview';

interface Keys {
  privateKeyPem: string;
  publicKeyPem: string;
}

function keys(): Keys {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function catalogBody() {
  return {
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
  };
}

async function scenario(options: {
  signed?: boolean;
  siblingKey?: 'correct' | 'wrong' | 'none' | 'trust-store';
}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dockscope-preview-'));
  const { privateKeyPem, publicKeyPem } = keys();
  const catalogPath = path.join(dir, 'catalog.json');

  await writeFile(catalogPath, JSON.stringify(catalogBody(), null, 2), 'utf-8');
  if (options.signed !== false) {
    // Sign through the production signer so the payload canonicalisation and
    // entry normalisation match exactly what verification will recompute.
    await signPluginCatalogFile({
      catalogPath,
      privateKey: privateKeyPem,
      keyId: 'acme-cat-v1',
    });
  }

  if (options.siblingKey === 'correct') {
    await writeFile(path.join(dir, 'catalog.public.pem'), publicKeyPem, 'utf-8');
  } else if (options.siblingKey === 'wrong') {
    await writeFile(path.join(dir, 'catalog.public.pem'), keys().publicKeyPem, 'utf-8');
  } else if (options.siblingKey === 'trust-store') {
    await writeFile(
      path.join(dir, 'catalog-trust.json'),
      JSON.stringify({
        format: PLUGIN_CATALOG_TRUST_STORE_FORMAT,
        keys: [
          { algorithm: 'ed25519', keyId: 'acme-cat-v1', publicKey: publicKeyPem, status: 'active' },
        ],
        revokedKeyIds: [],
      }),
      'utf-8',
    );
  }
  return catalogPath;
}

describe('plugin catalog preview', () => {
  it('verifies a catalog against the key published beside it', async () => {
    const source = await scenario({ siblingKey: 'correct' });
    const preview = await previewPluginCatalog(source);

    expect(preview.signed).toBe(true);
    expect(preview.signatureVerified).toBe(true);
    expect(preview.name).toBe('Acme Plugins');
    expect(preview.entryCount).toBe(1);
    expect(preview.keyId).toBe('acme-cat-v1');
    expect(preview.fingerprint).toMatch(/^[0-9a-f]{4} /);
    expect(preview.keySource).toMatch(/catalog\.public\.pem$/);
    expect(preview.problem).toBeUndefined();
  });

  it('also discovers the key from a sibling trust store', async () => {
    const source = await scenario({ siblingKey: 'trust-store' });
    const preview = await previewPluginCatalog(source);

    expect(preview.signatureVerified).toBe(true);
    expect(preview.keySource).toMatch(/catalog-trust\.json$/);
  });

  it('refuses a catalog whose published key does not match its signature', async () => {
    const source = await scenario({ siblingKey: 'wrong' });
    const preview = await previewPluginCatalog(source);

    expect(preview.signed).toBe(true);
    expect(preview.signatureVerified).toBe(false);
    expect(preview.publicKey).toBeUndefined();
    expect(preview.problem).toMatch(/does not match its signature/i);
  });

  it('refuses a signed catalog that publishes no key at all', async () => {
    const source = await scenario({ siblingKey: 'none' });
    const preview = await previewPluginCatalog(source);

    expect(preview.signatureVerified).toBe(false);
    expect(preview.problem).toMatch(/no signing key was published/i);
  });

  it('refuses an unsigned catalog', async () => {
    const source = await scenario({ signed: false, siblingKey: 'correct' });
    const preview = await previewPluginCatalog(source);

    expect(preview.signed).toBe(false);
    expect(preview.signatureVerified).toBe(false);
    expect(preview.problem).toMatch(/not signed/i);
  });

  it('reports a read failure instead of throwing', async () => {
    const preview = await previewPluginCatalog('/does/not/exist/catalog.json');

    expect(preview.signatureVerified).toBe(false);
    expect(preview.entryCount).toBe(0);
    expect(preview.problem).toBeTruthy();
  });

  it('rejects a blank source', async () => {
    await expect(previewPluginCatalog('   ')).resolves.toMatchObject({
      signatureVerified: false,
      problem: 'Catalog source is required',
    });
  });
});
