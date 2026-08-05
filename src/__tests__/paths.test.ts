import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stateDir, statePath } from '../paths';
import { authStorePath } from '../server/authStore';
import { createPluginConfigStoreFromEnv } from '../plugins/configStore';

describe('stateDir', () => {
  it('honours an explicit override', () => {
    expect(stateDir({ DOCKSCOPE_STATE_DIR: '/data' } as NodeJS.ProcessEnv)).toBe('/data');
  });

  it('otherwise lives under the home directory', () => {
    expect(stateDir({} as NodeJS.ProcessEnv)).toContain('.dockscope');
  });

  it('joins segments beneath it', () => {
    expect(statePath({ DOCKSCOPE_STATE_DIR: '/data' } as NodeJS.ProcessEnv, 'auth.json')).toBe(
      path.join('/data', 'auth.json'),
    );
  });
});

/**
 * The Docker image sets DOCKSCOPE_STATE_DIR to a declared volume, and the
 * README tells people to mount it. Every store has to resolve through it or
 * that mount quietly saves some state and drops the rest: the access token
 * survived a restart while the installed plugins did not.
 */
describe('state directory coverage', () => {
  const env = { DOCKSCOPE_STATE_DIR: '/data' } as NodeJS.ProcessEnv;

  it('puts the access token inside it', () => {
    expect(authStorePath(env)).toBe(path.join('/data', 'auth.json'));
  });

  it('still lets a single file be pointed elsewhere', () => {
    expect(
      authStorePath({ ...env, DOCKSCOPE_AUTH_FILE: '/tmp/auth.json' } as NodeJS.ProcessEnv),
    ).toBe('/tmp/auth.json');
  });

  it('puts plugin configuration inside it', () => {
    // The store keeps its path private, so this asserts through the only thing
    // it exposes: where it reads from.
    const store = createPluginConfigStoreFromEnv(env);
    expect(store).toBeDefined();
    expect(statePath(env, 'plugin-config.json')).toBe(path.join('/data', 'plugin-config.json'));
  });

  it.each([
    'plugin-state.json',
    'plugin-approvals.json',
    'plugin-events.json',
    'plugin-secrets.json',
    'plugin-config.json',
    'catalogs.json',
    'plugins',
  ])('resolves %s beneath the state directory', (entry) => {
    expect(statePath(env, entry).startsWith('/data')).toBe(true);
  });
});
