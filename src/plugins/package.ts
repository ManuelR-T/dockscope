import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { createHmac, createHash, sign, verify } from 'crypto';
import path from 'path';
import { validatePluginManifest, type PluginManifest } from '../core/plugins.js';
import { validateExternalPluginManifests } from './loader.js';

export const PLUGIN_PACKAGE_FORMAT = 'dockscope-plugin-package/v1';
export const MAX_PLUGIN_PACKAGE_BYTES = 64 * 1024 * 1024;
export const MAX_PLUGIN_PACKAGE_FILES = 10_000;
export const MAX_PLUGIN_UNPACKED_BYTES = 256 * 1024 * 1024;

export interface PluginPackageFile {
  path: string;
  contentBase64: string;
  sha256: string;
}

export interface PluginPackageSignature {
  algorithm: 'hmac-sha256' | 'ed25519';
  value: string;
  keyId?: string;
}

export interface PluginPackageBundle {
  format: typeof PLUGIN_PACKAGE_FORMAT;
  manifest: PluginManifest;
  files: PluginPackageFile[];
  sha256: string;
  signature?: PluginPackageSignature;
}

export interface VerifiedPluginPackage {
  bundle: PluginPackageBundle;
  signed: boolean;
  signatureVerified: boolean;
}

const EXCLUDED_DIRS = new Set(['.git', 'node_modules']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function signPackageHash(hash: string, signingKey: string): string {
  return createHmac('sha256', signingKey).update(hash).digest('hex');
}

function signPackageHashWithPrivateKey(hash: string, privateKey: string): string {
  return sign(null, Buffer.from(hash, 'utf-8'), privateKey).toString('base64');
}

function verifyPackageHashWithPublicKey(
  hash: string,
  signature: string,
  publicKey: string,
): boolean {
  return verify(null, Buffer.from(hash, 'utf-8'), publicKey, Buffer.from(signature, 'base64'));
}

function payloadForHash(
  bundle: Pick<PluginPackageBundle, 'format' | 'manifest' | 'files'>,
): string {
  return JSON.stringify({
    format: bundle.format,
    manifest: bundle.manifest,
    files: bundle.files,
  });
}

function isSafePackagePath(filePath: string): boolean {
  return (
    filePath.length > 0 &&
    !path.isAbsolute(filePath) &&
    !filePath.includes('\\') &&
    !filePath.split(/[\\/]/).some((part) => part === '..' || part.length === 0)
  );
}

async function collectFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(path.relative(root, fullPath).split(path.sep).join('/'));
    }
  }
  return files.sort();
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

function parsePackageBundle(raw: unknown): PluginPackageBundle {
  if (!isRecord(raw)) {
    throw new Error('Plugin package must be an object');
  }
  if (raw.format !== PLUGIN_PACKAGE_FORMAT) {
    throw new Error(`Unsupported plugin package format: ${String(raw.format)}`);
  }
  if (!Array.isArray(raw.files)) {
    throw new Error('Plugin package files must be an array');
  }
  if (raw.files.length > MAX_PLUGIN_PACKAGE_FILES) {
    throw new Error(`Plugin package contains more than ${MAX_PLUGIN_PACKAGE_FILES} files`);
  }
  if (typeof raw.sha256 !== 'string') {
    throw new Error('Plugin package sha256 is required');
  }
  const filePaths = new Set<string>();
  let unpackedBytes = 0;
  const files = raw.files.map((file, index): PluginPackageFile => {
    if (!isRecord(file)) {
      throw new Error(`Plugin package file ${index} must be an object`);
    }
    if (
      typeof file.path !== 'string' ||
      typeof file.contentBase64 !== 'string' ||
      typeof file.sha256 !== 'string'
    ) {
      throw new Error(`Plugin package file ${index} is invalid`);
    }
    if (!isSafePackagePath(file.path)) {
      throw new Error(`Unsafe plugin package path: ${file.path}`);
    }
    if (filePaths.has(file.path)) {
      throw new Error(`Duplicate plugin package path: ${file.path}`);
    }
    filePaths.add(file.path);
    const contents = Buffer.from(file.contentBase64, 'base64');
    if (contents.toString('base64') !== file.contentBase64) {
      throw new Error(`Plugin package file is not canonical base64: ${file.path}`);
    }
    unpackedBytes += contents.byteLength;
    if (unpackedBytes > MAX_PLUGIN_UNPACKED_BYTES) {
      throw new Error(`Plugin package expands beyond ${MAX_PLUGIN_UNPACKED_BYTES} bytes`);
    }
    return {
      path: file.path,
      contentBase64: file.contentBase64,
      sha256: file.sha256,
    };
  });
  if (
    raw.signature !== undefined &&
    (!isRecord(raw.signature) ||
      (raw.signature.algorithm !== 'hmac-sha256' && raw.signature.algorithm !== 'ed25519') ||
      typeof raw.signature.value !== 'string' ||
      !raw.signature.value)
  ) {
    throw new Error('Plugin package signature is invalid');
  }
  const signature: PluginPackageSignature | undefined = isRecord(raw.signature)
    ? {
        algorithm: raw.signature.algorithm as PluginPackageSignature['algorithm'],
        value: raw.signature.value as string,
        keyId:
          typeof raw.signature.keyId === 'string' && raw.signature.keyId.trim()
            ? raw.signature.keyId
            : undefined,
      }
    : undefined;
  return {
    format: PLUGIN_PACKAGE_FORMAT,
    manifest: validatePluginManifest(raw.manifest),
    files,
    sha256: raw.sha256,
    signature,
  };
}

export async function createPluginPackageFromPath(options: {
  sourcePath: string;
  outFile: string;
  signingKey?: string;
  privateKey?: string;
  keyId?: string;
}): Promise<PluginPackageBundle> {
  if (options.signingKey && options.privateKey) {
    throw new Error('Use either signingKey or privateKey, not both');
  }
  const sourcePath = path.resolve(options.sourcePath);
  const manifest = await validateSingleManifest(sourcePath);
  const collectedFiles = await collectFiles(sourcePath);
  if (collectedFiles.length > MAX_PLUGIN_PACKAGE_FILES) {
    throw new Error(`Plugin package contains more than ${MAX_PLUGIN_PACKAGE_FILES} files`);
  }
  const files = await Promise.all(
    collectedFiles.map(async (filePath): Promise<PluginPackageFile> => {
      const contents = await readFile(path.join(sourcePath, filePath));
      return {
        path: filePath,
        contentBase64: contents.toString('base64'),
        sha256: sha256(contents),
      };
    }),
  );
  const unpackedBytes = files.reduce(
    (total, file) => total + Buffer.from(file.contentBase64, 'base64').byteLength,
    0,
  );
  if (unpackedBytes > MAX_PLUGIN_UNPACKED_BYTES) {
    throw new Error(`Plugin package expands beyond ${MAX_PLUGIN_UNPACKED_BYTES} bytes`);
  }
  const baseBundle = {
    format: PLUGIN_PACKAGE_FORMAT,
    manifest,
    files,
  } satisfies Pick<PluginPackageBundle, 'format' | 'manifest' | 'files'>;
  const hash = sha256(payloadForHash(baseBundle));
  const bundle: PluginPackageBundle = {
    ...baseBundle,
    sha256: hash,
    signature: options.privateKey
      ? {
          algorithm: 'ed25519',
          value: signPackageHashWithPrivateKey(hash, options.privateKey),
          keyId: options.keyId,
        }
      : options.signingKey
        ? {
            algorithm: 'hmac-sha256',
            value: signPackageHash(hash, options.signingKey),
            keyId: options.keyId,
          }
        : undefined,
  };
  await mkdir(path.dirname(path.resolve(options.outFile)), { recursive: true });
  const serialized = JSON.stringify(bundle, null, 2);
  if (Buffer.byteLength(serialized) > MAX_PLUGIN_PACKAGE_BYTES) {
    throw new Error(`Plugin package exceeds ${MAX_PLUGIN_PACKAGE_BYTES} bytes`);
  }
  await writeFile(path.resolve(options.outFile), serialized, 'utf-8');
  return bundle;
}

export async function verifyPluginPackage(
  packagePath: string,
  options: { signingKey?: string; publicKey?: string; keyId?: string } = {},
): Promise<VerifiedPluginPackage> {
  if (options.signingKey && options.publicKey) {
    throw new Error('Use either signingKey or publicKey, not both');
  }
  const resolvedPackagePath = path.resolve(packagePath);
  if ((await stat(resolvedPackagePath)).size > MAX_PLUGIN_PACKAGE_BYTES) {
    throw new Error(`Plugin package exceeds ${MAX_PLUGIN_PACKAGE_BYTES} bytes`);
  }
  const bundle = parsePackageBundle(
    JSON.parse(await readFile(resolvedPackagePath, 'utf-8')) as unknown,
  );
  for (const file of bundle.files) {
    const contents = Buffer.from(file.contentBase64, 'base64');
    const actualHash = sha256(contents);
    if (actualHash !== file.sha256) {
      throw new Error(`Plugin package file hash mismatch: ${file.path}`);
    }
  }
  const actualPackageHash = sha256(
    payloadForHash({
      format: bundle.format,
      manifest: bundle.manifest,
      files: bundle.files,
    }),
  );
  if (actualPackageHash !== bundle.sha256) {
    throw new Error('Plugin package hash mismatch');
  }
  const manifestFile = bundle.files.find((file) => file.path === 'plugin.json');
  if (!manifestFile) {
    throw new Error('Plugin package does not contain plugin.json');
  }
  let packagedManifest: PluginManifest;
  try {
    packagedManifest = validatePluginManifest(
      JSON.parse(Buffer.from(manifestFile.contentBase64, 'base64').toString('utf-8')) as unknown,
    );
  } catch (error) {
    throw new Error(
      `Plugin package plugin.json is invalid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (JSON.stringify(packagedManifest) !== JSON.stringify(bundle.manifest)) {
    throw new Error('Plugin package manifest does not match plugin.json');
  }
  if (options.keyId && bundle.signature?.keyId !== options.keyId) {
    throw new Error(`Plugin package signing key id is ${bundle.signature?.keyId ?? 'missing'}`);
  }
  let signatureVerified = false;
  if (bundle.signature?.algorithm === 'hmac-sha256' && options.signingKey) {
    signatureVerified =
      signPackageHash(bundle.sha256, options.signingKey) === bundle.signature.value;
  }
  if (bundle.signature?.algorithm === 'ed25519' && options.publicKey) {
    signatureVerified = verifyPackageHashWithPublicKey(
      bundle.sha256,
      bundle.signature.value,
      options.publicKey,
    );
  }
  if ((options.signingKey || options.publicKey) && bundle.signature && !signatureVerified) {
    throw new Error('Plugin package signature mismatch');
  }
  if ((options.signingKey || options.publicKey) && !bundle.signature) {
    throw new Error('Plugin package is not signed');
  }
  if (options.signingKey && bundle.signature?.algorithm !== 'hmac-sha256') {
    throw new Error(`Plugin package signature algorithm is ${bundle.signature?.algorithm}`);
  }
  if (options.publicKey && bundle.signature?.algorithm !== 'ed25519') {
    throw new Error(`Plugin package signature algorithm is ${bundle.signature?.algorithm}`);
  }
  return {
    bundle,
    signed: Boolean(bundle.signature),
    signatureVerified,
  };
}

export async function extractPluginPackage(
  verified: VerifiedPluginPackage,
  targetDir: string,
): Promise<void> {
  const resolvedTarget = path.resolve(targetDir);
  await rm(resolvedTarget, { recursive: true, force: true });
  for (const file of verified.bundle.files) {
    const targetPath = path.resolve(resolvedTarget, file.path);
    const relative = path.relative(resolvedTarget, targetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Unsafe plugin package path: ${file.path}`);
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, Buffer.from(file.contentBase64, 'base64'));
  }
}

export async function isPluginPackageFile(sourcePath: string): Promise<boolean> {
  try {
    return (await stat(sourcePath)).isFile();
  } catch {
    return false;
  }
}
