import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PluginHostApi } from '../core/plugin-contract/api.js';

const queues = new Map<string, Promise<unknown>>();
const KEY_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/** A sibling of the replaceable code directory, scoped to this installation. */
export function pluginStorageDir(pluginDir: string): string {
  const resolved = path.resolve(pluginDir);
  return path.join(path.dirname(resolved), '.data', path.basename(resolved));
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function serialized<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(directory) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  queues.set(directory, next);
  try {
    return await next;
  } finally {
    if (queues.get(directory) === next) {
      queues.delete(directory);
    }
  }
}

async function atomicWrite(target: string, contents: string, overwrite = true): Promise<void> {
  const temporary = path.join(path.dirname(target), `.write-${randomUUID()}`);
  try {
    await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
    if (overwrite) {
      await rename(temporary, target);
    } else {
      // Publish complete files without overwriting data from a previous migration attempt.
      await link(temporary, target).catch((error: unknown) => {
        if (!hasCode(error, 'EEXIST')) {
          throw error;
        }
      });
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function initialize(pluginDir: string, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(path.dirname(directory))).isDirectory()) {
    throw new Error('Invalid plugin data root');
  }
  if (!(await lstat(directory)).isDirectory()) {
    throw new Error('Invalid plugin data directory');
  }
  const marker = path.join(directory, '.migrated');
  try {
    if (!(await lstat(marker)).isFile() || (await readFile(marker, 'utf8')) !== '1') {
      throw new Error('Invalid plugin storage migration marker');
    }
    return;
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) {
      throw error;
    }
  }
  const legacy = path.join(pluginDir, '.dockscope-storage');
  const files: { name: string; contents: string }[] = [];
  const legacyInfo = await lstat(legacy).catch((error: unknown) => {
    if (!hasCode(error, 'ENOENT')) {
      throw error;
    }
    return undefined;
  });
  if (legacyInfo) {
    if (!legacyInfo.isDirectory()) {
      throw new Error('Invalid legacy plugin storage');
    }
    for (const entry of await readdir(legacy, { withFileTypes: true })) {
      if (!entry.name.endsWith('.json')) {
        continue;
      }
      if (!entry.isFile() || !KEY_PATTERN.test(entry.name.slice(0, -5))) {
        throw new Error(`Invalid legacy plugin storage file: ${entry.name}`);
      }
      const contents = await readFile(path.join(legacy, entry.name), 'utf8');
      JSON.parse(contents); // Validate everything before publishing any migrated files.
      files.push({ name: entry.name, contents });
    }
  }
  for (const file of files) {
    await atomicWrite(path.join(directory, file.name), file.contents, false);
  }
  // Retain the legacy copy for recovery, but never resurrect deleted keys from it.
  await atomicWrite(marker, '1');
}

/** Also called by the installer before it replaces legacy plugin code. */
export async function migratePluginStorage(pluginDir: string): Promise<void> {
  const directory = pluginStorageDir(pluginDir);
  await serialized(directory, () => initialize(pluginDir, directory));
}

export function createPluginStorage(
  pluginDir: string,
): Pick<PluginHostApi, 'readStorage' | 'writeStorage' | 'deleteStorage'> {
  const directory = pluginStorageDir(pluginDir);
  function operation<T>(key: string, action: (target: string) => Promise<T>): Promise<T> {
    return serialized(directory, async () => {
      if (!KEY_PATTERN.test(key)) {
        throw new Error(`Invalid plugin storage key: ${key}`);
      }
      await initialize(pluginDir, directory);
      return action(path.join(directory, `${key}.json`));
    });
  }
  return {
    readStorage: (key) =>
      operation(key, async (target) => {
        try {
          return JSON.parse(await readFile(target, 'utf8')) as unknown;
        } catch (error) {
          if (hasCode(error, 'ENOENT')) {
            return undefined;
          }
          throw error;
        }
      }),
    writeStorage: (key, value) =>
      operation(key, async (target) => {
        if (value === undefined) {
          await rm(target, { force: true });
        } else {
          await atomicWrite(target, JSON.stringify(value, null, 2));
        }
      }),
    deleteStorage: (key) => operation(key, (target) => rm(target, { force: true })),
  };
}
