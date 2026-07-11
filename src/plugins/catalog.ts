import { sign, verify } from 'crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { installPluginFromPath, type InstalledPlugin } from './install.js';
import { MAX_PLUGIN_PACKAGE_BYTES, verifyPluginPackage } from './package.js';
import type { PluginCapability, PluginPermission } from '../core/capabilities.js';
import { isPluginCapability, isPluginPermission } from '../core/capabilities.js';
import {
  pluginCompatibilityWarnings,
  validatePluginCompatibility,
  type PluginCompatibility,
} from '../core/plugin-compatibility.js';
import { PKG_VERSION } from '../version.js';

export const PLUGIN_CATALOG_FORMAT = 'dockscope-plugin-catalog/v1';
export const PLUGIN_CATALOG_TRUST_STORE_FORMAT = 'dockscope-plugin-catalog-trust/v1';
export const MAX_PLUGIN_CATALOG_BYTES = 4 * 1024 * 1024;
export const PLUGIN_CATALOG_FETCH_TIMEOUT_MS = 15_000;

const CATALOG_PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;

export interface PluginCatalogEntrySignature {
  algorithm: 'ed25519';
  publicKey?: string;
  keyId?: string;
}

export interface PluginCatalogSignature {
  algorithm: 'ed25519';
  value: string;
  keyId?: string;
}

export type PluginCatalogEntryStatus = 'active' | 'deprecated' | 'yanked';
export type PluginCatalogTrustKeyStatus = 'active' | 'retiring';

export interface PluginCatalogTrustKey {
  algorithm: 'ed25519';
  keyId: string;
  publicKey: string;
  status: PluginCatalogTrustKeyStatus;
  notBefore?: string;
  notAfter?: string;
}

export interface PluginCatalogPackageRevocation {
  pluginId: string;
  version?: string;
  sha256?: string;
  reason?: string;
  revokedAt?: string;
}

export interface PluginCatalogTrustPolicy {
  packageKeys: readonly PluginCatalogTrustKey[];
  revokedPackageKeyIds: readonly string[];
  revokedPackages: readonly PluginCatalogPackageRevocation[];
}

export interface PluginCatalogTrustStore {
  format: typeof PLUGIN_CATALOG_TRUST_STORE_FORMAT;
  keys: readonly PluginCatalogTrustKey[];
  revokedKeyIds: readonly string[];
}

export interface PluginCatalogLoadOptions {
  publicKey?: string;
  trustStore?: PluginCatalogTrustStore;
}

export interface PluginCatalogEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  repositoryUrl?: string;
  readmeUrl?: string;
  readme?: string;
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
  trust?: PluginCatalogTrustPolicy;
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

function optionalSha256(value: unknown, field: string): string | undefined {
  const hash = optionalString(value, field);
  if (hash !== undefined && !/^[a-f0-9]{64}$/i.test(hash)) {
    throw new PluginCatalogError(`Plugin catalog field "${field}" must be SHA-256`);
  }
  return hash?.toLowerCase();
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

function optionalTimestamp(value: unknown, field: string): string | undefined {
  const timestamp = optionalString(value, field);
  if (timestamp !== undefined && !Number.isFinite(Date.parse(timestamp))) {
    throw new PluginCatalogError(`Plugin catalog field "${field}" must be an ISO timestamp`);
  }
  return timestamp;
}

function validateTrustKey(raw: unknown, field: string): PluginCatalogTrustKey {
  if (!isRecord(raw)) {
    throw new PluginCatalogError(`Plugin catalog field "${field}" must be an object`);
  }
  if (raw.algorithm !== 'ed25519') {
    throw new PluginCatalogError(
      `Unsupported plugin catalog trust key algorithm: ${String(raw.algorithm)}`,
    );
  }
  if (!isNonEmptyString(raw.keyId)) {
    throw new PluginCatalogError(`Plugin catalog field "${field}.keyId" is required`);
  }
  if (!isNonEmptyString(raw.publicKey)) {
    throw new PluginCatalogError(`Plugin catalog field "${field}.publicKey" is required`);
  }
  if (raw.status !== undefined && raw.status !== 'active' && raw.status !== 'retiring') {
    throw new PluginCatalogError(
      `Unsupported plugin catalog trust key status: ${String(raw.status)}`,
    );
  }
  const notBefore = optionalTimestamp(raw.notBefore, `${field}.notBefore`);
  const notAfter = optionalTimestamp(raw.notAfter, `${field}.notAfter`);
  if (notBefore && notAfter && Date.parse(notAfter) <= Date.parse(notBefore)) {
    throw new PluginCatalogError(
      `Plugin catalog field "${field}.notAfter" must be later than notBefore`,
    );
  }
  return {
    algorithm: 'ed25519',
    keyId: raw.keyId,
    publicKey: raw.publicKey,
    status: raw.status ?? 'active',
    notBefore,
    notAfter,
  };
}

function validateTrustKeys(raw: unknown, field: string): PluginCatalogTrustKey[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PluginCatalogError(`Plugin catalog field "${field}" must be an array`);
  }
  const keys = raw.map((key, index) => validateTrustKey(key, `${field}.${index}`));
  const keyIds = new Set<string>();
  for (const key of keys) {
    if (keyIds.has(key.keyId)) {
      throw new PluginCatalogError(`Duplicate plugin catalog trust key: ${key.keyId}`);
    }
    keyIds.add(key.keyId);
  }
  return keys;
}

function validatePackageRevocation(raw: unknown, index: number): PluginCatalogPackageRevocation {
  const field = `trust.revokedPackages.${index}`;
  if (!isRecord(raw)) {
    throw new PluginCatalogError(`Plugin catalog field "${field}" must be an object`);
  }
  if (!isNonEmptyString(raw.pluginId)) {
    throw new PluginCatalogError(`Plugin catalog field "${field}.pluginId" is required`);
  }
  const sha = optionalSha256(raw.sha256, `${field}.sha256`);
  return {
    pluginId: raw.pluginId,
    version: optionalString(raw.version, `${field}.version`),
    sha256: sha?.toLowerCase(),
    reason: optionalString(raw.reason, `${field}.reason`),
    revokedAt: optionalTimestamp(raw.revokedAt, `${field}.revokedAt`),
  };
}

function validateTrustPolicy(raw: unknown): PluginCatalogTrustPolicy | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new PluginCatalogError('Plugin catalog field "trust" must be an object');
  }
  if (raw.revokedPackages !== undefined && !Array.isArray(raw.revokedPackages)) {
    throw new PluginCatalogError('Plugin catalog field "trust.revokedPackages" must be an array');
  }
  const revokedPackageKeyIds = stringList(raw.revokedPackageKeyIds, 'trust.revokedPackageKeyIds');
  return {
    packageKeys: validateTrustKeys(raw.packageKeys, 'trust.packageKeys'),
    revokedPackageKeyIds: [...new Set(revokedPackageKeyIds)],
    revokedPackages: (raw.revokedPackages ?? []).map(validatePackageRevocation),
  };
}

export function validatePluginCatalogTrustStore(raw: unknown): PluginCatalogTrustStore {
  if (!isRecord(raw)) {
    throw new PluginCatalogError('Plugin catalog trust store must be an object');
  }
  if (raw.format !== PLUGIN_CATALOG_TRUST_STORE_FORMAT) {
    throw new PluginCatalogError(
      `Unsupported plugin catalog trust store format: ${String(raw.format)}`,
    );
  }
  return {
    format: PLUGIN_CATALOG_TRUST_STORE_FORMAT,
    keys: validateTrustKeys(raw.keys, 'keys'),
    revokedKeyIds: [...new Set(stringList(raw.revokedKeyIds, 'revokedKeyIds'))],
  };
}

export function parsePluginCatalogTrustStore(value: string): PluginCatalogTrustStore {
  try {
    return validatePluginCatalogTrustStore(JSON.parse(value) as unknown);
  } catch (error) {
    if (error instanceof PluginCatalogError) {
      throw error;
    }
    throw new PluginCatalogError(
      `Invalid plugin catalog trust store JSON: ${catalogErrorMessage(error)}`,
    );
  }
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
  if (raw.publicKey !== undefined && !isNonEmptyString(raw.publicKey)) {
    throw new PluginCatalogError('Plugin catalog signature publicKey must be non-empty');
  }
  if (!isNonEmptyString(raw.publicKey) && !isNonEmptyString(raw.keyId)) {
    throw new PluginCatalogError('Plugin catalog entry signature requires a keyId or publicKey');
  }
  return {
    algorithm: 'ed25519',
    publicKey: isNonEmptyString(raw.publicKey) ? raw.publicKey : undefined,
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
  if (!CATALOG_PLUGIN_ID_PATTERN.test(raw.id)) {
    throw new PluginCatalogError(`Invalid plugin catalog entry id: ${raw.id}`);
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
    readme: optionalString(raw.readme, 'readme'),
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
    packageSha256: optionalSha256(raw.packageSha256, 'packageSha256'),
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
    trust: validateTrustPolicy(raw.trust),
    signature: validateCatalogSignature(raw.signature),
    entries,
  };
}

function catalogPayload(catalog: Omit<PluginCatalog, 'signature'>): string {
  return JSON.stringify({
    format: catalog.format,
    name: catalog.name,
    updatedAt: catalog.updatedAt,
    trust: catalog.trust,
    entries: catalog.entries,
  });
}

function verifyCatalogSignature(
  catalog: PluginCatalog,
  options: PluginCatalogLoadOptions,
): boolean | undefined {
  if (!catalog.signature) {
    return undefined;
  }
  if (
    catalog.signature.keyId &&
    options.trustStore?.revokedKeyIds.includes(catalog.signature.keyId)
  ) {
    throw new PluginCatalogError(
      `Plugin catalog signing key is revoked: ${catalog.signature.keyId}`,
    );
  }
  const now = Date.now();
  const keys = [
    ...(options.publicKey ? [{ algorithm: 'ed25519' as const, publicKey: options.publicKey }] : []),
    ...(options.trustStore?.keys.filter((key) => trustKeyIsUsable(key, now)) ?? []),
  ].filter(
    (key) =>
      !('keyId' in key) || !catalog.signature?.keyId || key.keyId === catalog.signature.keyId,
  );
  if (keys.length === 0) {
    return false;
  }
  return keys.some((key) => {
    try {
      return verify(
        null,
        Buffer.from(catalogPayload(catalog), 'utf-8'),
        key.publicKey,
        Buffer.from(catalog.signature?.value ?? '', 'base64'),
      );
    } catch {
      return false;
    }
  });
}

function trustKeyIsUsable(key: PluginCatalogTrustKey, now: number): boolean {
  return (
    (key.notBefore === undefined || Date.parse(key.notBefore) <= now) &&
    (key.notAfter === undefined || Date.parse(key.notAfter) > now)
  );
}

function packageRevocation(
  policy: PluginCatalogTrustPolicy,
  entry: PluginCatalogEntry,
): PluginCatalogPackageRevocation | undefined {
  return policy.revokedPackages.find(
    (revocation) =>
      revocation.pluginId === entry.id &&
      (revocation.version === undefined || revocation.version === entry.version) &&
      (revocation.sha256 === undefined || revocation.sha256 === entry.packageSha256?.toLowerCase()),
  );
}

function trustedPackagePublicKey(
  catalog: ResolvedPluginCatalog,
  entry: ResolvedPluginCatalogEntry,
  allowUnsigned: boolean,
): string | undefined {
  const policy = catalog.trust;
  if (!policy) {
    if (entry.signature && !entry.signature.publicKey) {
      throw new PluginCatalogError(
        `Plugin catalog entry signature requires a public key: ${entry.id}`,
      );
    }
    return entry.signature?.publicKey;
  }
  if (catalog.signatureVerified !== true && !allowUnsigned) {
    throw new PluginCatalogError(
      'Plugin catalog trust policy requires a verified catalog signature',
    );
  }
  if (!entry.packageSha256) {
    throw new PluginCatalogError(`Trusted catalog entry requires a package hash: ${entry.id}`);
  }
  const revocation = packageRevocation(policy, entry);
  if (revocation) {
    const reason = revocation.reason ? `: ${revocation.reason}` : '';
    throw new PluginCatalogError(`Plugin catalog package is revoked: ${entry.id}${reason}`);
  }
  const keyId = entry.signature?.keyId;
  if (!keyId) {
    throw new PluginCatalogError(`Trusted catalog entry requires a package key id: ${entry.id}`);
  }
  if (policy.revokedPackageKeyIds.includes(keyId)) {
    throw new PluginCatalogError(`Plugin catalog package key is revoked: ${keyId}`);
  }
  const key = policy.packageKeys.find((candidate) => candidate.keyId === keyId);
  if (!key) {
    throw new PluginCatalogError(`Plugin catalog package key is not trusted: ${keyId}`);
  }
  if (!trustKeyIsUsable(key, Date.now())) {
    throw new PluginCatalogError(
      `Plugin catalog package key is outside its validity window: ${keyId}`,
    );
  }
  return key.publicKey;
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

async function readHttpSource(
  source: string,
  maxBytes: number,
  label: 'catalog' | 'package',
): Promise<Buffer> {
  const response = await fetch(source, {
    signal: AbortSignal.timeout(PLUGIN_CATALOG_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new PluginCatalogError(`Plugin ${label} fetch failed with HTTP ${response.status}`);
  }
  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new PluginCatalogError(`Plugin ${label} exceeds ${maxBytes} bytes`);
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new PluginCatalogError(`Plugin ${label} exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, bytes);
}

async function readLocalSource(source: string, maxBytes: number, label: string): Promise<Buffer> {
  const filePath = isFileUrl(source) ? fileURLToPath(source) : path.resolve(source);
  if ((await stat(filePath)).size > maxBytes) {
    throw new PluginCatalogError(`Plugin ${label} exceeds ${maxBytes} bytes`);
  }
  return readFile(filePath);
}

async function readTextSource(source: string): Promise<string> {
  try {
    const contents = isHttpUrl(source)
      ? await readHttpSource(source, MAX_PLUGIN_CATALOG_BYTES, 'catalog')
      : await readLocalSource(source, MAX_PLUGIN_CATALOG_BYTES, 'catalog');
    return contents.toString('utf-8');
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
    return isHttpUrl(source)
      ? readHttpSource(source, MAX_PLUGIN_PACKAGE_BYTES, 'package')
      : readLocalSource(source, MAX_PLUGIN_PACKAGE_BYTES, 'package');
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
  options: PluginCatalogLoadOptions = {},
): Promise<ResolvedPluginCatalog> {
  const text = await readTextSource(source);
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw new PluginCatalogError(`Invalid plugin catalog JSON: ${catalogErrorMessage(error)}`);
  }
  const catalog = validatePluginCatalog(raw);
  const signatureVerified = verifyCatalogSignature(catalog, options);
  const verificationConfigured = Boolean(options.publicKey || options.trustStore);
  if (verificationConfigured && catalog.signature && !signatureVerified) {
    throw new PluginCatalogError('Plugin catalog signature mismatch');
  }
  if (verificationConfigured && !catalog.signature) {
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
  catalogTrustStore?: PluginCatalogTrustStore;
  allowUnsigned?: boolean;
  dockscopeVersion?: string;
}): Promise<InstalledPlugin> {
  const catalog = await loadPluginCatalog(options.catalogSource, {
    publicKey: options.catalogPublicKey,
    trustStore: options.catalogTrustStore,
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
  const packagePublicKey = trustedPackagePublicKey(catalog, entry, options.allowUnsigned === true);
  const packageContents = await readPackageSource(entry.resolvedPackageUrl);
  const tempDir = await mkdtemp(path.join(tmpdir(), 'dockscope-catalog-package-'));
  const packagePath = path.join(tempDir, 'plugin.dockscope-plugin');
  try {
    await writeFile(packagePath, packageContents);
    const verifiedPackage = await verifyPluginPackage(packagePath, {
      publicKey: packagePublicKey,
      keyId: entry.signature?.keyId,
    });
    if (entry.packageSha256 && verifiedPackage.bundle.sha256 !== entry.packageSha256) {
      throw new PluginCatalogError(`Plugin catalog package hash mismatch: ${entry.id}`);
    }
    if (
      entry.signature?.keyId &&
      verifiedPackage.bundle.signature?.keyId !== entry.signature.keyId
    ) {
      throw new PluginCatalogError(`Plugin catalog package key id mismatch: ${entry.id}`);
    }
    const installed = await installPluginFromPath({
      sourcePath: packagePath,
      source: entry.resolvedPackageUrl,
      registryDir: options.registryDir,
      publicKey: packagePublicKey,
    });
    if (installed.id !== entry.id || installed.version !== entry.version) {
      throw new PluginCatalogError(
        `Installed package ${installed.id}@${installed.version} does not match catalog ${entry.id}@${entry.version}`,
      );
    }
    return installed;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
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
    trust: catalog.trust,
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
