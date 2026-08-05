import { statePath } from '../paths.js';
// Persistence for user-added plugin catalogs.
//
// Adding a catalog is a trust decision, not just a URL entry: every catalog is
// pinned to the signing key it presented when the user accepted it (trust on
// first use). If a catalog later signs with a different key, verification fails
// against the pinned key rather than silently accepting the new one, which is
// the property that makes a stolen or rotated key visible instead of invisible.

import { createHash } from 'crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'fs/promises';
import path from 'path';

export interface StoredPluginCatalog {
  /** Catalog JSON file path or HTTP(S) URL. Unique key of the record. */
  source: string;
  /** Catalog name as advertised when it was added, for display only. */
  name?: string;
  /** Signing key id the catalog presented when trusted, if it was signed. */
  keyId?: string;
  /** PEM public key pinned at trust time. Absent for catalogs trusted unsigned. */
  publicKey?: string;
  /** SHA-256 of the pinned public key, shown to the user for out-of-band checks. */
  fingerprint?: string;
  addedAt: number;
}

export interface PluginCatalogStore {
  list(): Promise<StoredPluginCatalog[]>;
  add(catalog: StoredPluginCatalog): Promise<void>;
  remove(source: string): Promise<boolean>;
}

/** SHA-256 over the normalised PEM body, rendered as spaced hex groups. */
export function publicKeyFingerprint(publicKeyPem: string): string {
  const body = publicKeyPem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const digest = createHash('sha256').update(body, 'utf-8').digest('hex');
  return (digest.match(/.{1,4}/g) ?? []).join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStored(raw: unknown): StoredPluginCatalog[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  const entries = Array.isArray(raw) ? raw : isRecord(raw) ? raw.catalogs : undefined;
  if (!Array.isArray(entries)) {
    throw new Error('Plugin catalog store must be an array');
  }
  const seen = new Set<string>();
  const catalogs: StoredPluginCatalog[] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.source !== 'string' || !entry.source.trim()) {
      throw new Error('Plugin catalog entry requires a "source"');
    }
    const source = entry.source.trim();
    if (seen.has(source)) {
      continue;
    }
    seen.add(source);
    catalogs.push({
      source,
      ...(typeof entry.name === 'string' ? { name: entry.name } : {}),
      ...(typeof entry.keyId === 'string' ? { keyId: entry.keyId } : {}),
      ...(typeof entry.publicKey === 'string' ? { publicKey: entry.publicKey } : {}),
      ...(typeof entry.fingerprint === 'string' ? { fingerprint: entry.fingerprint } : {}),
      addedAt:
        typeof entry.addedAt === 'number' && Number.isFinite(entry.addedAt) ? entry.addedAt : 0,
    });
  }
  return catalogs;
}

export class JsonPluginCatalogStore implements PluginCatalogStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<StoredPluginCatalog[]> {
    return this.readAll();
  }

  async add(catalog: StoredPluginCatalog): Promise<void> {
    await this.enqueueWrite(async () => {
      const stored = await this.readAll();
      const next = stored.filter((entry) => entry.source !== catalog.source);
      next.push(catalog);
      await this.writeAll(next);
    });
  }

  async remove(source: string): Promise<boolean> {
    let removed = false;
    await this.enqueueWrite(async () => {
      const stored = await this.readAll();
      const next = stored.filter((entry) => entry.source !== source);
      removed = next.length !== stored.length;
      if (removed) {
        await this.writeAll(next);
      }
    });
    return removed;
  }

  private async enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.catch(() => undefined);
    await next;
  }

  private async writeAll(stored: readonly StoredPluginCatalog[]): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const tempDir = await mkdtemp(path.join(directory, '.plugin-catalogs-'));
    const tempPath = path.join(tempDir, path.basename(this.filePath));
    try {
      await writeFile(tempPath, JSON.stringify(stored, null, 2), 'utf-8');
      await rename(tempPath, this.filePath);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async readAll(): Promise<StoredPluginCatalog[]> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, 'utf-8');
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return [];
      }
      throw error;
    }
    try {
      return normalizeStored(JSON.parse(contents) as unknown);
    } catch (error) {
      throw new Error(`Plugin catalog store file is invalid: ${this.filePath}`, { cause: error });
    }
  }
}

export function pluginCatalogStorePath(env: NodeJS.ProcessEnv): string {
  return env.DOCKSCOPE_PLUGIN_CATALOGS || statePath(env, 'catalogs.json');
}

export function createPluginCatalogStoreFromEnv(env: NodeJS.ProcessEnv): PluginCatalogStore {
  return new JsonPluginCatalogStore(pluginCatalogStorePath(env));
}
