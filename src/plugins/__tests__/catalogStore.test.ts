import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  JsonPluginCatalogStore,
  pluginCatalogStorePath,
  publicKeyFingerprint,
} from '../catalogStore';

async function store(): Promise<{ store: JsonPluginCatalogStore; file: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dockscope-catalog-store-'));
  const file = path.join(dir, 'catalogs.json');
  return { store: new JsonPluginCatalogStore(file), file };
}

const SAMPLE_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAYB0Ydod72LLaaXPOsGEFeRrrdlE9dSX9uy9Sz8n0RZk=
-----END PUBLIC KEY-----
`;

describe('publicKeyFingerprint', () => {
  it('is stable and independent of PEM whitespace and armour', () => {
    const spaced = SAMPLE_KEY.replace(/\n/g, '\r\n');
    expect(publicKeyFingerprint(SAMPLE_KEY)).toBe(publicKeyFingerprint(spaced));
    expect(publicKeyFingerprint(SAMPLE_KEY)).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4})+$/);
  });

  it('differs for different keys', () => {
    const other = SAMPLE_KEY.replace('YB0Y', 'ZB0Z');
    expect(publicKeyFingerprint(other)).not.toBe(publicKeyFingerprint(SAMPLE_KEY));
  });
});

describe('plugin catalog store', () => {
  it('returns an empty list when the file does not exist', async () => {
    const { store: subject } = await store();
    await expect(subject.list()).resolves.toEqual([]);
  });

  it('adds, lists, and removes catalogs', async () => {
    const { store: subject } = await store();
    await subject.add({
      source: 'https://acme.test/catalog.json',
      name: 'Acme',
      keyId: 'acme-catalog-v1',
      publicKey: SAMPLE_KEY,
      fingerprint: publicKeyFingerprint(SAMPLE_KEY),
      addedAt: 111,
    });

    const listed = await subject.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      source: 'https://acme.test/catalog.json',
      keyId: 'acme-catalog-v1',
      addedAt: 111,
    });

    await expect(subject.remove('https://acme.test/catalog.json')).resolves.toBe(true);
    await expect(subject.list()).resolves.toEqual([]);
    await expect(subject.remove('https://acme.test/catalog.json')).resolves.toBe(false);
  });

  it('replaces an existing record rather than duplicating the source', async () => {
    const { store: subject } = await store();
    const base = { source: 'https://acme.test/catalog.json', addedAt: 1 };
    await subject.add({ ...base, keyId: 'old' });
    await subject.add({ ...base, keyId: 'new', addedAt: 2 });

    const listed = await subject.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ keyId: 'new', addedAt: 2 });
  });

  it('writes atomically, leaving valid JSON on disk', async () => {
    const { store: subject, file } = await store();
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        subject.add({ source: `https://acme.test/${index}.json`, addedAt: index }),
      ),
    );
    const parsed = JSON.parse(await readFile(file, 'utf-8')) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    await expect(subject.list()).resolves.toHaveLength(5);
  });

  it('rejects a corrupt store file instead of silently dropping catalogs', async () => {
    const { store: subject, file } = await store();
    await writeFile(file, '{"not":"an array"}', 'utf-8');
    await expect(subject.list()).rejects.toThrow(/invalid/i);
  });

  it('honours DOCKSCOPE_PLUGIN_CATALOGS for the store path', () => {
    expect(pluginCatalogStorePath({ DOCKSCOPE_PLUGIN_CATALOGS: '/tmp/x.json' })).toBe(
      '/tmp/x.json',
    );
    expect(pluginCatalogStorePath({})).toMatch(/\.dockscope[/\\]catalogs\.json$/);
  });
});
