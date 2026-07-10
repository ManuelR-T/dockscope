import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises';
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

export function defaultPluginRegistryDir(): string {
  return path.join(homedir(), '.dockscope', 'plugins');
}

function indexPath(registryDir: string): string {
  return path.join(registryDir, INSTALL_INDEX);
}

async function readIndex(registryDir: string): Promise<InstalledPluginIndex> {
  try {
    return JSON.parse(await readFile(indexPath(registryDir), 'utf-8')) as InstalledPluginIndex;
  } catch {
    return {};
  }
}

async function writeIndex(registryDir: string, index: InstalledPluginIndex): Promise<void> {
  await mkdir(registryDir, { recursive: true });
  await writeFile(indexPath(registryDir), JSON.stringify(index, null, 2), 'utf-8');
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

export async function installPluginFromPath(options: {
  sourcePath: string;
  registryDir?: string;
  signingKey?: string;
  publicKey?: string;
}): Promise<InstalledPlugin> {
  const registryDir = options.registryDir ?? defaultPluginRegistryDir();
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

  if (verifiedPackage) {
    await extractPluginPackage(verifiedPackage, targetDir);
  } else {
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(path.dirname(targetDir), { recursive: true });
    await cp(sourcePath, targetDir, { recursive: true });
  }

  const installed: InstalledPlugin = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    dockscopeApiVersion: manifest.dockscopeApiVersion,
    installedAt: index[manifest.id]?.installedAt ?? now,
    updatedAt: now,
    source: sourcePath,
    sourceType: verifiedPackage ? 'package' : 'directory',
    packageSha256: verifiedPackage?.bundle.sha256,
    signatureAlgorithm: verifiedPackage?.bundle.signature?.algorithm,
    signatureVerified: verifiedPackage?.signatureVerified,
    path: targetDir,
  };
  index[manifest.id] = installed;
  await writeIndex(registryDir, index);
  return installed;
}

export async function listInstalledPlugins(
  registryDir = defaultPluginRegistryDir(),
): Promise<InstalledPlugin[]> {
  return Object.values(await readIndex(registryDir)).sort((a, b) => a.id.localeCompare(b.id));
}

export async function saveInstalledPluginRecord(
  installed: InstalledPlugin,
  registryDir = defaultPluginRegistryDir(),
): Promise<void> {
  const index = await readIndex(registryDir);
  index[installed.id] = installed;
  await writeIndex(registryDir, index);
}

export async function removeInstalledPluginRecord(
  pluginId: string,
  registryDir = defaultPluginRegistryDir(),
): Promise<void> {
  const index = await readIndex(registryDir);
  delete index[pluginId];
  await writeIndex(registryDir, index);
}

export async function uninstallPlugin(
  pluginId: string,
  registryDir = defaultPluginRegistryDir(),
): Promise<boolean> {
  const index = await readIndex(registryDir);
  const installed = index[pluginId];
  if (!installed) {
    return false;
  }
  await rm(installed.path, { recursive: true, force: true });
  delete index[pluginId];
  await writeIndex(registryDir, index);
  return true;
}

export async function updateInstalledPlugin(
  pluginId: string,
  registryDir = defaultPluginRegistryDir(),
  signingKey?: string,
  publicKey?: string,
): Promise<InstalledPlugin> {
  const index = await readIndex(registryDir);
  const installed = index[pluginId];
  if (!installed) {
    throw new Error(`Plugin is not installed: ${pluginId}`);
  }
  return installPluginFromPath({
    sourcePath: installed.source,
    registryDir,
    signingKey,
    publicKey,
  });
}
