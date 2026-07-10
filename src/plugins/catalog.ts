import { sign, verify } from 'crypto';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { installPluginFromPath, type InstalledPlugin } from './install.js';
import { verifyPluginPackage } from './package.js';
import type { PluginCapability, PluginPermission } from '../core/capabilities.js';
import { isPluginCapability, isPluginPermission } from '../core/capabilities.js';
import {
  pluginCompatibilityWarnings,
  validatePluginCompatibility,
  type PluginCompatibility,
} from '../core/plugin-compatibility.js';
import { PKG_VERSION } from '../version.js';

export const PLUGIN_CATALOG_FORMAT = 'dockscope-plugin-catalog/v1';

export interface PluginCatalogEntrySignature {
  algorithm: 'ed25519';
  publicKey: string;
  keyId?: string;
}

export interface PluginCatalogSignature {
  algorithm: 'ed25519';
  value: string;
  keyId?: string;
}

export type PluginCatalogEntryStatus = 'active' | 'deprecated' | 'yanked';

export interface PluginCatalogEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  repositoryUrl?: string;
  readmeUrl?: string;
  iconUrl?: string;
  license?: string;
  category?: string;
  status: PluginCatalogEntryStatus;
  tags: readonly string[];
  screenshots: readonly string[];
  publishedAt?: string;
  releaseNotes?: string;
  compatibility?: PluginCompatibility;
  capabilities: readonly PluginCapability[];
  permissions: readonly PluginPermission[];
  packageUrl: string;
  packageSha256?: string;
  signature?: PluginCatalogEntrySignature;
}

export interface PluginCatalog {
  format: typeof PLUGIN_CATALOG_FORMAT;
  name: string;
  updatedAt?: string;
  signature?: PluginCatalogSignature;
  entries: readonly PluginCatalogEntry[];
}

export interface ResolvedPluginCatalogEntry extends PluginCatalogEntry {
  resolvedPackageUrl: string;
}

export interface ResolvedPluginCatalog extends Omit<PluginCatalog, 'entries'> {
  signatureVerified?: boolean;
  entries: readonly ResolvedPluginCatalogEntry[];
}

export class PluginCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginCatalogError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isNonEmptyString(value)) {
    throw new PluginCatalogError(`Plugin catalog field "${field}" must be a non-empty string`);
  }
  return value;
}

function stringList(raw: unknown, field: string): string[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PluginCatalogError(`Plugin catalog field "${field}" must be an array`);
  }
  return raw.map((item, index) => {
    if (!isNonEmptyString(item)) {
      throw new PluginCatalogError(
        `Plugin catalog field "${field}.${index}" must be a non-empty string`,
      );
    }
    return item;
  });
}

function capabilityList(raw: unknown): PluginCapability[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PluginCatalogError('Plugin catalog field "capabilities" must be an array');
  }
  return raw.map((item) => {
    if (!isPluginCapability(item)) {
      throw new PluginCatalogError(`Unsupported plugin catalog capability: ${String(item)}`);
    }
    return item;
  });
}

function permissionList(raw: unknown): PluginPermission[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PluginCatalogError('Plugin catalog field "permissions" must be an array');
  }
  return raw.map((item) => {
    if (!isPluginPermission(item)) {
      throw new PluginCatalogError(`Unsupported plugin catalog permission: ${String(item)}`);
    }
    return item;
  });
}

function validateSignature(raw: unknown): PluginCatalogEntrySignature | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new PluginCatalogError('Plugin catalog signature must be an object');
  }
  if (raw.algorithm !== 'ed25519') {
    throw new PluginCatalogError(`Unsupported plugin catalog signature: ${String(raw.algorithm)}`);
  }
  if (!isNonEmptyString(raw.publicKey)) {
    throw new PluginCatalogError('Plugin catalog signature requires a publicKey');
  }
  return {
    algorithm: 'ed25519',
    publicKey: raw.publicKey,
    keyId: optionalString(raw.keyId, 'signature.keyId'),
  };
}

function validateCatalogSignature(raw: unknown): PluginCatalogSignature | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new PluginCatalogError('Plugin catalog signature must be an object');
  }
  if (raw.algorithm !== 'ed25519') {
    throw new PluginCatalogError(`Unsupported plugin catalog signature: ${String(raw.algorithm)}`);
  }
  if (!isNonEmptyString(raw.value)) {
    throw new PluginCatalogError('Plugin catalog signature requires a value');
  }
  return {
    algorithm: 'ed25519',
    value: raw.value,
    keyId: optionalString(raw.keyId, 'signature.keyId'),
  };
}

function validateEntryStatus(raw: unknown): PluginCatalogEntryStatus {
  if (raw === undefined) {
    return 'active';
  }
  if (raw === 'active' || raw === 'deprecated' || raw === 'yanked') {
    return raw;
  }
  throw new PluginCatalogError(`Unsupported plugin catalog entry status: ${String(raw)}`);
}

function validateEntry(raw: unknown): PluginCatalogEntry {
  if (!isRecord(raw)) {
    throw new PluginCatalogError('Plugin catalog entries must be objects');
  }
  if (!isNonEmptyString(raw.id)) {
    throw new PluginCatalogError('Plugin catalog entry field "id" is required');
  }
  if (!isNonEmptyString(raw.name)) {
    throw new PluginCatalogError(`Plugin catalog entry "${raw.id}" requires a name`);
  }
  if (!isNonEmptyString(raw.version)) {
    throw new PluginCatalogError(`Plugin catalog entry "${raw.id}" requires a version`);
  }
  if (!isNonEmptyString(raw.packageUrl)) {
    throw new PluginCatalogError(`Plugin catalog entry "${raw.id}" requires a packageUrl`);
  }
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    description: optionalString(raw.description, 'description'),
    author: optionalString(raw.author, 'author'),
    homepage: optionalString(raw.homepage, 'homepage'),
    repositoryUrl: optionalString(raw.repositoryUrl, 'repositoryUrl'),
    readmeUrl: optionalString(raw.readmeUrl, 'readmeUrl'),
    iconUrl: optionalString(raw.iconUrl, 'iconUrl'),
    license: optionalString(raw.license, 'license'),
    category: optionalString(raw.category, 'category'),
    status: validateEntryStatus(raw.status),
    tags: stringList(raw.tags, 'tags'),
    screenshots: stringList(raw.screenshots, 'screenshots'),
    publishedAt: optionalString(raw.publishedAt, 'publishedAt'),
    releaseNotes: optionalString(raw.releaseNotes, 'releaseNotes'),
    compatibility: validatePluginCompatibility(raw.compatibility),
    capabilities: capabilityList(raw.capabilities),
    permissions: permissionList(raw.permissions),
    packageUrl: raw.packageUrl,
    packageSha256: optionalString(raw.packageSha256, 'packageSha256'),
    signature: validateSignature(raw.signature),
  };
}

export function validatePluginCatalog(raw: unknown): PluginCatalog {
  if (!isRecord(raw)) {
    throw new PluginCatalogError('Plugin catalog must be an object');
  }
  if (raw.format !== PLUGIN_CATALOG_FORMAT) {
    throw new PluginCatalogError(`Unsupported plugin catalog format: ${String(raw.format)}`);
  }
  if (!isNonEmptyString(raw.name)) {
    throw new PluginCatalogError('Plugin catalog field "name" is required');
  }
  if (!Array.isArray(raw.entries)) {
    throw new PluginCatalogError('Plugin catalog field "entries" must be an array');
  }
  const entries = raw.entries.map(validateEntry);
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new PluginCatalogError(`Duplicate plugin catalog entry: ${entry.id}`);
    }
    ids.add(entry.id);
  }
  return {
    format: PLUGIN_CATALOG_FORMAT,
    name: raw.name,
    updatedAt: optionalString(raw.updatedAt, 'updatedAt'),
    signature: validateCatalogSignature(raw.signature),
    entries,
  };
}

function catalogPayload(catalog: Omit<PluginCatalog, 'signature'>): string {
  return JSON.stringify({
    format: catalog.format,
    name: catalog.name,
    updatedAt: catalog.updatedAt,
    entries: catalog.entries,
  });
}

function verifyCatalogSignature(
  catalog: PluginCatalog,
  publicKey: string | undefined,
): boolean | undefined {
  if (!catalog.signature) {
    return undefined;
  }
  if (!publicKey) {
    return false;
  }
  return verify(
    null,
    Buffer.from(catalogPayload(catalog), 'utf-8'),
    publicKey,
    Buffer.from(catalog.signature.value, 'base64'),
  );
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function isFileUrl(value: string): boolean {
  return value.startsWith('file://');
}

function sourceBase(source: string): string {
  if (isHttpUrl(source)) {
    return new URL('.', source).href;
  }
  if (isFileUrl(source)) {
    return path.dirname(fileURLToPath(source));
  }
  return path.dirname(path.resolve(source));
}

function resolveCatalogUrl(source: string, packageUrl: string): string {
  if (isHttpUrl(packageUrl) || isFileUrl(packageUrl) || path.isAbsolute(packageUrl)) {
    return packageUrl;
  }
  const base = sourceBase(source);
  if (isHttpUrl(base)) {
    return new URL(packageUrl, base).href;
  }
  return path.resolve(base, packageUrl);
}

function catalogErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readTextSource(source: string): Promise<string> {
  try {
    if (isHttpUrl(source)) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new PluginCatalogError(`Plugin catalog fetch failed with HTTP ${response.status}`);
      }
      return response.text();
    }
    return readFile(isFileUrl(source) ? fileURLToPath(source) : path.resolve(source), 'utf-8');
  } catch (error) {
    if (error instanceof PluginCatalogError) {
      throw error;
    }
    throw new PluginCatalogError(
      `Failed to read plugin catalog "${source}": ${catalogErrorMessage(error)}`,
    );
  }
}

async function readPackageSource(source: string): Promise<Buffer> {
  try {
    if (isHttpUrl(source)) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new PluginCatalogError(`Plugin package fetch failed with HTTP ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    }
    return readFile(isFileUrl(source) ? fileURLToPath(source) : path.resolve(source));
  } catch (error) {
    if (error instanceof PluginCatalogError) {
      throw error;
    }
    throw new PluginCatalogError(
      `Failed to read plugin package "${source}": ${catalogErrorMessage(error)}`,
    );
  }
}

export async function loadPluginCatalog(
  source: string,
  options: { publicKey?: string } = {},
): Promise<ResolvedPluginCatalog> {
  const text = await readTextSource(source);
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw new PluginCatalogError(`Invalid plugin catalog JSON: ${catalogErrorMessage(error)}`);
  }
  const catalog = validatePluginCatalog(raw);
  const signatureVerified = verifyCatalogSignature(catalog, options.publicKey);
  if (options.publicKey && catalog.signature && !signatureVerified) {
    throw new PluginCatalogError('Plugin catalog signature mismatch');
  }
  if (options.publicKey && !catalog.signature) {
    throw new PluginCatalogError('Plugin catalog is not signed');
  }
  return {
    ...catalog,
    signatureVerified,
    entries: catalog.entries.map((entry) => ({
      ...entry,
      resolvedPackageUrl: resolveCatalogUrl(source, entry.packageUrl),
    })),
  };
}

export async function installPluginFromCatalog(options: {
  catalogSource: string;
  pluginId: string;
  registryDir?: string;
  catalogPublicKey?: string;
  allowUnsigned?: boolean;
  dockscopeVersion?: string;
}): Promise<InstalledPlugin> {
  const catalog = await loadPluginCatalog(options.catalogSource, {
    publicKey: options.catalogPublicKey,
  });
  const entry = catalog.entries.find((candidate) => candidate.id === options.pluginId);
  if (!entry) {
    throw new PluginCatalogError(`Plugin catalog entry not found: ${options.pluginId}`);
  }
  if (entry.status === 'yanked') {
    throw new PluginCatalogError(`Plugin catalog entry is yanked: ${options.pluginId}`);
  }
  if (!entry.signature && !options.allowUnsigned) {
    throw new PluginCatalogError(`Plugin catalog entry is unsigned: ${options.pluginId}`);
  }
  const compatibilityWarnings = pluginCompatibilityWarnings(
    entry.compatibility,
    options.dockscopeVersion ?? PKG_VERSION,
  );
  if (compatibilityWarnings.length > 0) {
    throw new PluginCatalogError(
      `Plugin catalog entry is incompatible: ${compatibilityWarnings.join('; ')}`,
    );
  }
  const packageContents = await readPackageSource(entry.resolvedPackageUrl);
  const tempDir = await mkdtemp(path.join(tmpdir(), 'dockscope-catalog-package-'));
  const packagePath = path.join(tempDir, `${entry.id}.dockscope-plugin`);
  await writeFile(packagePath, packageContents);
  const verifiedPackage = await verifyPluginPackage(packagePath, {
    publicKey: entry.signature?.publicKey,
  });
  if (entry.packageSha256 && verifiedPackage.bundle.sha256 !== entry.packageSha256) {
    throw new PluginCatalogError(`Plugin catalog package hash mismatch: ${entry.id}`);
  }
  const installed = await installPluginFromPath({
    sourcePath: packagePath,
    registryDir: options.registryDir,
    publicKey: entry.signature?.publicKey,
  });
  if (installed.id !== entry.id || installed.version !== entry.version) {
    throw new PluginCatalogError(
      `Installed package ${installed.id}@${installed.version} does not match catalog ${entry.id}@${entry.version}`,
    );
  }
  return installed;
}

export async function signPluginCatalogFile(options: {
  catalogPath: string;
  privateKey: string;
  keyId?: string;
}): Promise<PluginCatalog> {
  const raw = JSON.parse(await readFile(path.resolve(options.catalogPath), 'utf-8')) as unknown;
  const catalog = validatePluginCatalog(raw);
  const unsigned: Omit<PluginCatalog, 'signature'> = {
    format: catalog.format,
    name: catalog.name,
    updatedAt: catalog.updatedAt,
    entries: catalog.entries,
  };
  const signed: PluginCatalog = {
    ...unsigned,
    signature: {
      algorithm: 'ed25519',
      value: sign(
        null,
        Buffer.from(catalogPayload(unsigned), 'utf-8'),
        options.privateKey,
      ).toString('base64'),
      keyId: options.keyId,
    },
  };
  await writeFile(path.resolve(options.catalogPath), JSON.stringify(signed, null, 2), 'utf-8');
  return signed;
}
