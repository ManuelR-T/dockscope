import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AuthConfig, StoredToken, hashToken } from './auth.js';
import { statePath } from '../paths.js';

/**
 * On-disk half of the access token.
 *
 * A token set through the first-run screen has to survive a restart, so it
 * lives beside the other DockScope state. Only the scrypt hash is written: the
 * file is enough to check a token, never to learn it.
 */
export interface StoredAuth {
  version: 1;
  token?: StoredToken;
  /** The operator chose to keep this instance open; do not ask again. */
  declined?: boolean;
  configuredAt?: number;
}

function isStoredToken(value: unknown): value is StoredToken {
  const candidate = value as StoredToken | undefined;
  return (
    typeof candidate?.salt === 'string' &&
    candidate.salt.length > 0 &&
    typeof candidate.hash === 'string' &&
    candidate.hash.length > 0
  );
}

function normalize(value: unknown): StoredAuth {
  const raw = (value ?? {}) as Partial<StoredAuth>;
  const out: StoredAuth = { version: 1 };
  if (isStoredToken(raw.token)) {
    out.token = raw.token;
  }
  if (raw.declined === true) {
    out.declined = true;
  }
  if (typeof raw.configuredAt === 'number') {
    out.configuredAt = raw.configuredAt;
  }
  return out;
}

export class AuthStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<StoredAuth> {
    try {
      return normalize(JSON.parse(await readFile(this.filePath, 'utf-8')) as unknown);
    } catch {
      return { version: 1 };
    }
  }

  private async write(state: StoredAuth): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    // The hash is not a secret in the way the token is, but there is no reason
    // for anyone but the owner to read it.
    await writeFile(this.filePath, JSON.stringify(state, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }

  async setToken(token: string): Promise<StoredToken> {
    const stored = hashToken(token);
    const state = await this.read();
    await this.write({ ...state, token: stored, declined: false, configuredAt: Date.now() });
    return stored;
  }

  async clearToken(): Promise<void> {
    const state = await this.read();
    delete state.token;
    delete state.configuredAt;
    await this.write(state);
  }

  /** Reversible: `false` puts the setup screen back on offer. */
  async setDeclined(declined: boolean): Promise<void> {
    const state = await this.read();
    if (declined) {
      await this.write({ ...state, declined: true });
      return;
    }
    delete state.declined;
    await this.write(state);
  }
}

export function authStorePath(env: NodeJS.ProcessEnv): string {
  return env.DOCKSCOPE_AUTH_FILE || statePath(env, 'auth.json');
}

/**
 * Merge the environment and the stored file into one config.
 *
 * `DOCKSCOPE_TOKEN` wins: an operator who pins the token in the environment
 * should not have it silently overridden by whatever is on disk, and it is how
 * an immutable deployment configures itself.
 */
export function resolveAuthConfig(env: NodeJS.ProcessEnv, stored: StoredAuth): AuthConfig {
  const envToken = (env.DOCKSCOPE_TOKEN ?? '').trim();
  if (envToken) {
    return { enabled: true, token: envToken, source: 'env' };
  }
  if (stored.token) {
    return { enabled: true, token: '', stored: stored.token, source: 'file' };
  }
  return { enabled: false, token: '', source: 'none' };
}
