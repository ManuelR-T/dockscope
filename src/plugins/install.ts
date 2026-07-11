import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import { validateExternalPluginManifests } from './loader.js';
import { extractPluginPackage, isPluginPackageFile, verifyPluginPackage } from './package.js';
import type { PluginManifest } from '../core/plugins.js';

const INSTALL_INDEX = 'installed.json';

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  dockscopeApiVersion: string;
  installedAt: number;
  updatedAt: number;
  source: string;
  sourceType: 'directory' | 'package';
  packageSha256?: string;
  signatureAlgorithm?: string;
  signatureVerified?: boolean;
  path: string;
}

type InstalledPluginIndex = Record<string, InstalledPlugin>;
const INSTALLED_PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;
const registryQueues = new Map<string, Promise<void>>();

export interface InstallPluginOptions {
  sourcePath: string;
  source?: string;
  registryDir?: string;
  signingKey?: string;
  publicKey?: string;
}

async function withRegistryTransaction<T>(
  registryDir: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(registryDir);
  const previous = registryQueues.get(key) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  registryQueues.set(key, tail);
  try {
    return await run;
  } finally {
    if (registryQueues.get(key) === tail) {
      registryQueues.delete(key);
    }
  }
}

export function defaultPluginRegistryDir(): string {
  return path.join(homedir(), '.dockscope', 'plugins');
}

function indexPath(registryDir: string): string {
  return path.join(registryDir, INSTALL_INDEX);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseInstalledPluginIndex(raw: unknown, registryDir: string): InstalledPluginIndex {
  if (!isRecord(raw)) {
    throw new Error('Plugin install index must be an object');
  }
  const index: InstalledPluginIndex = {};
  for (const [pluginId, value] of Object.entries(raw)) {
    if (!INSTALLED_PLUGIN_ID_PATTERN.test(pluginId) || !isRecord(value) || value.id !== pluginId) {
      throw new Error(`Plugin install index entry is invalid: ${pluginId}`);
    }
    if (
      typeof value.name !== 'string' ||
      value.name.length === 0 ||
      typeof value.version !== 'string' ||
      value.version.length === 0 ||
      typeof value.dockscopeApiVersion !== 'string' ||
      value.dockscopeApiVersion.length === 0 ||
      typeof value.installedAt !== 'number' ||
      !Number.isFinite(value.installedAt) ||
      typeof value.updatedAt !== 'number' ||
      !Number.isFinite(value.updatedAt) ||
      typeof value.source !== 'string' ||
      value.source.length === 0
    ) {
      throw new Error(`Plugin install index entry is invalid: ${pluginId}`);
    }
    if (
      value.sourceType !== undefined &&
      value.sourceType !== 'directory' &&
      value.sourceType !== 'package'
    ) {
      throw new Error(`Plugin install index source type is invalid: ${pluginId}`);
    }
    const packageSha256 = optionalString(value.packageSha256);
    if (packageSha256 && !/^[a-f0-9]{64}$/i.test(packageSha256)) {
      throw new Error(`Plugin install index package hash is invalid: ${pluginId}`);
    }
    index[pluginId] = {
      id: pluginId,
      name: value.name,
      version: value.version,
      dockscopeApiVersion: value.dockscopeApiVersion,
      installedAt: value.installedAt,
      updatedAt: value.updatedAt,
      source: value.source,
      sourceType: value.sourceType ?? (packageSha256 !== undefined ? 'package' : 'directory'),
      packageSha256: packageSha256?.toLowerCase(),
      signatureAlgorithm: optionalString(value.signatureAlgorithm),
      signatureVerified:
        typeof value.signatureVerified === 'boolean' ? value.signatureVerified : undefined,
      path: installDir(registryDir, pluginId),
    };
  }
  return index;
}

async function readIndex(registryDir: string): Promise<InstalledPluginIndex> {
  let contents: string;
  try {
    contents = await readFile(indexPath(registryDir), 'utf-8');
  } catch (error) {
    if (isMissingPathError(error)) {
      return {};
    }
    throw error;
  }
  try {
    return parseInstalledPluginIndex(JSON.parse(contents) as unknown, registryDir);
  } catch (error) {
    throw new Error(`Plugin install index is invalid: ${indexPath(registryDir)}`, {
      cause: error,
    });
  }
}

async function writeIndex(registryDir: string, index: InstalledPluginIndex): Promise<void> {
  await mkdir(registryDir, { recursive: true });
  const tempDir = await mkdtemp(path.join(registryDir, '.index-'));
  const tempPath = path.join(tempDir, INSTALL_INDEX);
  try {
    await writeFile(tempPath, JSON.stringify(index, null, 2), 'utf-8');
    await rename(tempPath, indexPath(registryDir));
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function installDir(registryDir: string, pluginId: string): string {
  return path.join(registryDir, pluginId);
}

async function validateSingleManifest(sourcePath: string): Promise<PluginManifest> {
  const result = await validateExternalPluginManifests({
    paths: [sourcePath],
    permissions: 'all',
  });
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => error.message).join('; '));
  }
  if (result.manifests.length !== 1) {
    throw new Error(`Expected exactly one plugin manifest in ${sourcePath}`);
  }
  return result.manifests[0];
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

async function restorePreviousInstall(options: {
  targetDir: string;
  backupDir: string;
  targetActivated: boolean;
  previousMoved: boolean;
}): Promise<void> {
  if (options.targetActivated) {
    await rm(options.targetDir, { recursive: true, force: true });
  }
  if (options.previousMoved) {
    await rename(options.backupDir, options.targetDir);
  }
}

export async function installPluginFromPath(
  options: InstallPluginOptions,
): Promise<InstalledPlugin> {
  const registryDir = options.registryDir ?? defaultPluginRegistryDir();
  return withRegistryTransaction(registryDir, () =>
    installPluginFromPathUnlocked(options, registryDir),
  );
}

async function installPluginFromPathUnlocked(
  options: InstallPluginOptions,
  registryDir: string,
): Promise<InstalledPlugin> {
  const sourcePath = path.resolve(options.sourcePath);
  const packageFile = await isPluginPackageFile(sourcePath);
  const verifiedPackage = packageFile
    ? await verifyPluginPackage(sourcePath, {
        signingKey: options.signingKey,
        publicKey: options.publicKey,
      })
    : undefined;
  const manifest = verifiedPackage?.bundle.manifest ?? (await validateSingleManifest(sourcePath));
  const targetDir = installDir(registryDir, manifest.id);
  const index = await readIndex(registryDir);
  const now = Date.now();
  const installed: InstalledPlugin = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    dockscopeApiVersion: manifest.dockscopeApiVersion,
    installedAt: index[manifest.id]?.installedAt ?? now,
    updatedAt: now,
    source: options.source ?? sourcePath,
    sourceType: verifiedPackage ? 'package' : 'directory',
    packageSha256: verifiedPackage?.bundle.sha256,
    signatureAlgorithm: verifiedPackage?.bundle.signature?.algorithm,
    signatureVerified: verifiedPackage?.signatureVerified,
    path: targetDir,
  };
  await mkdir(registryDir, { recursive: true });
  const stagingRoot = await mkdtemp(path.join(registryDir, '.install-'));
  const stagedDir = path.join(stagingRoot, 'plugin');
  const backupDir = path.join(stagingRoot, 'previous');
  let previousMoved = false;
  let targetActivated = false;

  try {
    if (verifiedPackage) {
      await extractPluginPackage(verifiedPackage, stagedDir);
    } else {
      await cp(sourcePath, stagedDir, { recursive: true });
    }
    const stagedManifest = await validateSingleManifest(stagedDir);
    if (stagedManifest.id !== manifest.id || stagedManifest.version !== manifest.version) {
      throw new Error(
        `Staged plugin ${stagedManifest.id}@${stagedManifest.version} does not match ${manifest.id}@${manifest.version}`,
      );
    }

    try {
      await rename(targetDir, backupDir);
      previousMoved = true;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
    await rename(stagedDir, targetDir);
    targetActivated = true;
    index[manifest.id] = installed;
    await writeIndex(registryDir, index);
    return installed;
  } catch (error) {
    try {
      await restorePreviousInstall({ targetDir, backupDir, targetActivated, previousMoved });
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Plugin install failed and rollback was incomplete: ${manifest.id}`,
        { cause: rollbackError },
      );
    }
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function listInstalledPlugins(
  registryDir = defaultPluginRegistryDir(),
): Promise<InstalledPlugin[]> {
  return withRegistryTransaction(registryDir, async () =>
    Object.values(await readIndex(registryDir)).sort((a, b) => a.id.localeCompare(b.id)),
  );
}

export async function saveInstalledPluginRecord(
  installed: InstalledPlugin,
  registryDir = defaultPluginRegistryDir(),
): Promise<void> {
  await withRegistryTransaction(registryDir, async () => {
    const index = await readIndex(registryDir);
    index[installed.id] = installed;
    await writeIndex(registryDir, index);
  });
}

export async function removeInstalledPluginRecord(
  pluginId: string,
  registryDir = defaultPluginRegistryDir(),
): Promise<void> {
  await withRegistryTransaction(registryDir, async () => {
    const index = await readIndex(registryDir);
    delete index[pluginId];
    await writeIndex(registryDir, index);
  });
}

export async function uninstallPlugin(
  pluginId: string,
  registryDir = defaultPluginRegistryDir(),
): Promise<boolean> {
  return withRegistryTransaction(registryDir, async () => {
    const index = await readIndex(registryDir);
    const installed = index[pluginId];
    if (!installed) {
      return false;
    }
    await mkdir(registryDir, { recursive: true });
    const stagingRoot = await mkdtemp(path.join(registryDir, '.uninstall-'));
    const backupDir = path.join(stagingRoot, 'plugin');
    let pluginMoved = false;
    try {
      try {
        await rename(installed.path, backupDir);
        pluginMoved = true;
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }
      delete index[pluginId];
      await writeIndex(registryDir, index);
      return true;
    } catch (error) {
      if (pluginMoved) {
        await rename(backupDir, installed.path).catch((rollbackError: unknown) => {
          throw new AggregateError(
            [error, rollbackError],
            `Plugin uninstall failed and rollback was incomplete: ${pluginId}`,
            { cause: rollbackError },
          );
        });
      }
      throw error;
    } finally {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}

export async function updateInstalledPlugin(
  pluginId: string,
  registryDir = defaultPluginRegistryDir(),
  signingKey?: string,
  publicKey?: string,
): Promise<InstalledPlugin> {
  return withRegistryTransaction(registryDir, async () => {
    const index = await readIndex(registryDir);
    const installed = index[pluginId];
    if (!installed) {
      throw new Error(`Plugin is not installed: ${pluginId}`);
    }
    return installPluginFromPathUnlocked(
      {
        sourcePath: installed.source,
        registryDir,
        signingKey,
        publicKey,
      },
      registryDir,
    );
  });
}
