import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tokenMatchesStored } from '../auth';
import { AuthStore, authStorePath, resolveAuthConfig } from '../authStore';

const TOKEN = 'a-sufficiently-long-token';

describe('AuthStore', () => {
  let dir = '';
  let file = '';
  let store: AuthStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dockscope-auth-'));
    file = path.join(dir, 'nested', 'auth.json');
    store = new AuthStore(file);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('starts empty when nothing has been written', async () => {
    expect(await store.read()).toEqual({ version: 1 });
  });

  it('creates the directory on first write', async () => {
    await store.setToken(TOKEN);
    expect((await store.read()).token).toBeDefined();
  });

  // The file is enough to check a token, never to learn it.
  it('writes only a salted hash, never the token', async () => {
    await store.setToken(TOKEN);
    const raw = await readFile(file, 'utf-8');
    expect(raw).not.toContain(TOKEN);

    const stored = (await store.read()).token!;
    expect(tokenMatchesStored(TOKEN, stored)).toBe(true);
    expect(tokenMatchesStored('wrong', stored)).toBe(false);
  });

  it('survives being read back after a restart', async () => {
    await store.setToken(TOKEN);
    const reopened = new AuthStore(file);
    expect(tokenMatchesStored(TOKEN, (await reopened.read()).token!)).toBe(true);
  });

  it('replaces the token when it is set again', async () => {
    await store.setToken(TOKEN);
    await store.setToken('a-different-long-token');
    const stored = (await store.read()).token!;
    expect(tokenMatchesStored('a-different-long-token', stored)).toBe(true);
    expect(tokenMatchesStored(TOKEN, stored)).toBe(false);
  });

  it('records that the reminder was declined', async () => {
    await store.setDeclined(true);
    expect((await store.read()).declined).toBe(true);
  });

  // Declining is reversible without touching the file by hand.
  it('takes the decline back again', async () => {
    await store.setDeclined(true);
    await store.setDeclined(false);
    expect((await store.read()).declined).not.toBe(true);
  });

  // Absent and false mean the same thing, so this asserts the state rather
  // than the exact representation.
  it('clears the declined flag when a token is set later', async () => {
    await store.setDeclined(true);
    await store.setToken(TOKEN);
    expect((await store.read()).declined).not.toBe(true);
  });

  it('drops the token again on clear', async () => {
    await store.setToken(TOKEN);
    await store.clearToken();
    expect((await store.read()).token).toBeUndefined();
  });

  it('falls back to empty on unreadable or malformed contents', async () => {
    const broken = new AuthStore(path.join(dir, 'broken.json'));
    await writeFile(path.join(dir, 'broken.json'), 'not json', 'utf-8');
    expect(await broken.read()).toEqual({ version: 1 });
  });

  it.each([
    ['{"version":1,"token":{"salt":"a"}}', 'a hash-less token'],
    ['{"version":1,"token":"plain"}', 'a token that is not an object'],
    ['{"version":1,"token":{"salt":"","hash":""}}', 'empty fields'],
  ])('ignores %s (%s)', async (contents) => {
    const broken = new AuthStore(path.join(dir, 'partial.json'));
    await writeFile(path.join(dir, 'partial.json'), contents, 'utf-8');
    expect((await broken.read()).token).toBeUndefined();
  });
});

describe('authStorePath', () => {
  it('honours an explicit override', () => {
    expect(authStorePath({ DOCKSCOPE_AUTH_FILE: '/tmp/x.json' } as NodeJS.ProcessEnv)).toBe(
      '/tmp/x.json',
    );
  });

  it('otherwise sits with the rest of the DockScope state', () => {
    expect(authStorePath({} as NodeJS.ProcessEnv)).toContain(path.join('.dockscope', 'auth.json'));
  });
});

describe('resolveAuthConfig', () => {
  it('is disabled when neither source has a token', () => {
    expect(resolveAuthConfig({} as NodeJS.ProcessEnv, { version: 1 })).toMatchObject({
      enabled: false,
      source: 'none',
    });
  });

  it('uses the stored token when the environment has none', () => {
    const stored = { salt: 'a', hash: 'b' };
    expect(resolveAuthConfig({} as NodeJS.ProcessEnv, { version: 1, token: stored })).toMatchObject(
      { enabled: true, source: 'file', stored },
    );
  });

  // An operator who pins the token in the environment should not have it
  // quietly overridden by whatever a previous setup wrote to disk.
  it('lets the environment win over the stored token', () => {
    expect(
      resolveAuthConfig({ DOCKSCOPE_TOKEN: TOKEN } as NodeJS.ProcessEnv, {
        version: 1,
        token: { salt: 'a', hash: 'b' },
      }),
    ).toMatchObject({ enabled: true, source: 'env', token: TOKEN });
  });
});
