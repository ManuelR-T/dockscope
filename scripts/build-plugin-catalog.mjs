#!/usr/bin/env node

import { createPublicKey, generateKeyPairSync } from 'crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

function stringOption(options, key, fallback) {
  const value = options[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

async function readOptionalText(filePath) {
  return filePath ? readFile(path.resolve(projectRoot, filePath), 'utf-8') : undefined;
}

async function readKey(options, optionName, envName) {
  return (await readOptionalText(options[optionName])) || process.env[envName]?.trim() || undefined;
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

async function readConfiguredJson(options, optionName, envName) {
  const filePath = options[optionName];
  if (typeof filePath === 'string' && filePath.trim()) {
    return JSON.parse(await readFile(path.resolve(projectRoot, filePath), 'utf-8'));
  }
  const serialized = process.env[envName]?.trim();
  return serialized ? JSON.parse(serialized) : {};
}

function buildTimestamp(options) {
  const configured = stringOption(options, 'timestamp', process.env.SOURCE_DATE_EPOCH);
  if (configured === undefined) {
    return new Date().toISOString();
  }
  if (!/^\d+$/.test(configured)) {
    throw new Error('SOURCE_DATE_EPOCH and --timestamp must be Unix timestamps in seconds');
  }
  const date = new Date(Number.parseInt(configured, 10) * 1000);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('SOURCE_DATE_EPOCH or --timestamp is outside the supported date range');
  }
  return date.toISOString();
}

function mergeTrustKeys(configuredKeys, currentKey) {
  const keys = Array.isArray(configuredKeys)
    ? configuredKeys.filter(
        (key) => key && typeof key === 'object' && key.keyId !== currentKey?.keyId,
      )
    : [];
  if (currentKey) {
    keys.push(currentKey);
  }
  return keys.sort((left, right) => String(left.keyId).localeCompare(String(right.keyId)));
}

async function discoverPluginDirs(sourceDir) {
  const directManifest = path.join(sourceDir, 'plugin.json');
  try {
    await readFile(directManifest, 'utf-8');
    return [sourceDir];
  } catch {
    const entries = await readdir(sourceDir, { withFileTypes: true });
    const dirs = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const pluginDir = path.join(sourceDir, entry.name);
      try {
        await readFile(path.join(pluginDir, 'plugin.json'), 'utf-8');
        dirs.push(pluginDir);
      } catch {
        /* ignore non-plugin directories */
      }
    }
    return dirs.sort();
  }
}

function normalizeStringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function packageUrl(baseUrl, artifactName) {
  if (!baseUrl) {
    return `./packages/${artifactName}`;
  }
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(`packages/${artifactName}`, normalized).href;
}

async function ensureDevKeys(options, outDir) {
  if (options['dev-keys'] !== true) {
    return options;
  }
  const keyDir = path.join(outDir, 'keys');
  await mkdir(keyDir, { recursive: true });
  const packageKeys = generateKeyPairSync('ed25519');
  const catalogKeys = generateKeyPairSync('ed25519');
  const next = { ...options };
  next['package-private-key'] = path.relative(
    projectRoot,
    path.join(keyDir, 'package.private.pem'),
  );
  next['package-public-key'] = path.relative(projectRoot, path.join(keyDir, 'package.public.pem'));
  next['catalog-private-key'] = path.relative(
    projectRoot,
    path.join(keyDir, 'catalog.private.pem'),
  );
  next['catalog-public-key'] = path.relative(projectRoot, path.join(keyDir, 'catalog.public.pem'));
  await writeFile(
    path.resolve(projectRoot, next['package-private-key']),
    packageKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    'utf-8',
  );
  await writeFile(
    path.resolve(projectRoot, next['package-public-key']),
    packageKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    'utf-8',
  );
  await writeFile(
    path.resolve(projectRoot, next['catalog-private-key']),
    catalogKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    'utf-8',
  );
  await writeFile(
    path.resolve(projectRoot, next['catalog-public-key']),
    catalogKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    'utf-8',
  );
  return next;
}

async function loadBuildModules() {
  try {
    const packageModule = await import(
      pathToFileURL(path.join(projectRoot, 'dist/plugins/package.js')).href
    );
    const catalogModule = await import(
      pathToFileURL(path.join(projectRoot, 'dist/plugins/catalog.js')).href
    );
    return { packageModule, catalogModule };
  } catch (error) {
    console.error('Build output is missing. Run `npm run build` before building a plugin catalog.');
    throw error;
  }
}

const initialOptions = parseArgs(process.argv.slice(2));
const outDir = path.resolve(
  projectRoot,
  stringOption(initialOptions, 'out', 'dist/plugin-catalog'),
);
await rm(outDir, { recursive: true, force: true });
const options = await ensureDevKeys(initialOptions, outDir);
const sourceDir = path.resolve(projectRoot, stringOption(options, 'source', 'plugins/official'));
const packageDir = path.join(outDir, 'packages');
const catalogPath = path.join(outDir, 'catalog.json');
const catalogName = stringOption(options, 'catalog-name', 'DockScope Official Plugins');
const baseUrl = stringOption(options, 'base-url', '');
const now = buildTimestamp(options);

const packagePrivateKey = await readKey(
  options,
  'package-private-key',
  'DOCKSCOPE_PLUGIN_PACKAGE_PRIVATE_KEY',
);
const packagePublicKey =
  (await readKey(options, 'package-public-key', 'DOCKSCOPE_PLUGIN_PACKAGE_PUBLIC_KEY')) ||
  (packagePrivateKey
    ? createPublicKey(packagePrivateKey).export({ type: 'spki', format: 'pem' }).toString()
    : undefined);
const catalogPrivateKey =
  (await readKey(options, 'catalog-private-key', 'DOCKSCOPE_PLUGIN_CATALOG_PRIVATE_KEY')) ||
  packagePrivateKey;
const catalogPublicKey =
  (await readKey(options, 'catalog-public-key', 'DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY')) ||
  (catalogPrivateKey
    ? createPublicKey(catalogPrivateKey).export({ type: 'spki', format: 'pem' }).toString()
    : undefined);
const packageKeyId = stringOption(options, 'package-key-id', 'official-package');
const catalogKeyId = stringOption(options, 'catalog-key-id', 'official-catalog');
const configuredPackageTrust = await readConfiguredJson(
  options,
  'package-trust-policy',
  'DOCKSCOPE_PLUGIN_PACKAGE_TRUST_POLICY',
);
const configuredCatalogTrust = await readConfiguredJson(
  options,
  'catalog-trust-store',
  'DOCKSCOPE_PLUGIN_CATALOG_TRUST_STORE',
);

if (options['require-signatures'] === true && (!packagePrivateKey || !catalogPrivateKey)) {
  throw new Error(
    'Signed catalog build requires package and catalog private keys. Set the key options or DOCKSCOPE_PLUGIN_PACKAGE_PRIVATE_KEY and DOCKSCOPE_PLUGIN_CATALOG_PRIVATE_KEY.',
  );
}

await mkdir(packageDir, { recursive: true });

const { packageModule, catalogModule } = await loadBuildModules();
const pluginDirs = await discoverPluginDirs(sourceDir);
if (pluginDirs.length === 0) {
  throw new Error(`No plugin manifests found under ${sourceDir}`);
}
const entries = [];

for (const pluginDir of pluginDirs) {
  const manifest = JSON.parse(await readFile(path.join(pluginDir, 'plugin.json'), 'utf-8'));
  const artifactName = `${manifest.id}-${manifest.version}.dockscope-plugin`;
  const artifactPath = path.join(packageDir, artifactName);
  const bundle = await packageModule.createPluginPackageFromPath({
    sourcePath: pluginDir,
    outFile: artifactPath,
    privateKey: packagePrivateKey,
    keyId: packagePrivateKey ? packageKeyId : undefined,
  });
  const metadata = await readOptionalJson(path.join(pluginDir, 'catalog.json'));
  const readme = await readOptionalText(
    path.relative(projectRoot, path.join(pluginDir, 'README.md')),
  );
  entries.push({
    id: bundle.manifest.id,
    name: bundle.manifest.name,
    version: bundle.manifest.version,
    description: bundle.manifest.description,
    author: bundle.manifest.author,
    homepage: bundle.manifest.homepage,
    repositoryUrl: metadata.repositoryUrl,
    readmeUrl: metadata.readmeUrl,
    readme,
    iconUrl: metadata.iconUrl,
    license: metadata.license,
    category: metadata.category,
    status: metadata.status ?? 'active',
    tags: normalizeStringList(metadata.tags),
    screenshots: normalizeStringList(metadata.screenshots),
    publishedAt: metadata.publishedAt ?? now,
    releaseNotes: metadata.releaseNotes,
    compatibility: bundle.manifest.compatibility,
    capabilities: bundle.manifest.capabilities,
    permissions: bundle.manifest.permissions,
    packageUrl: packageUrl(baseUrl, artifactName),
    packageSha256: bundle.sha256,
    signature:
      packagePublicKey && bundle.signature?.algorithm === 'ed25519'
        ? {
            algorithm: 'ed25519',
            publicKey: packagePublicKey,
            keyId: bundle.signature.keyId,
          }
        : undefined,
  });
  console.log(`packed ${bundle.manifest.id} v${bundle.manifest.version}`);
}

const catalog = {
  format: catalogModule.PLUGIN_CATALOG_FORMAT,
  name: catalogName,
  updatedAt: now,
  trust: packagePublicKey
    ? {
        packageKeys: mergeTrustKeys(configuredPackageTrust.packageKeys, {
          algorithm: 'ed25519',
          keyId: packageKeyId,
          publicKey: packagePublicKey,
          status: 'active',
        }),
        revokedPackageKeyIds: Array.isArray(configuredPackageTrust.revokedPackageKeyIds)
          ? [...configuredPackageTrust.revokedPackageKeyIds].sort()
          : [],
        revokedPackages: Array.isArray(configuredPackageTrust.revokedPackages)
          ? [...configuredPackageTrust.revokedPackages].sort((left, right) =>
              `${left.pluginId ?? ''}:${left.version ?? ''}:${left.sha256 ?? ''}`.localeCompare(
                `${right.pluginId ?? ''}:${right.version ?? ''}:${right.sha256 ?? ''}`,
              ),
            )
          : [],
      }
    : undefined,
  entries,
};
const validatedCatalog = catalogModule.validatePluginCatalog(catalog);
await mkdir(outDir, { recursive: true });
await writeFile(catalogPath, JSON.stringify(validatedCatalog, null, 2), 'utf-8');

if (catalogPrivateKey) {
  await catalogModule.signPluginCatalogFile({
    catalogPath,
    privateKey: catalogPrivateKey,
    keyId: catalogKeyId,
  });
}

if (packagePublicKey) {
  await writeFile(path.join(outDir, 'package.public.pem'), packagePublicKey, 'utf-8');
}
if (catalogPublicKey) {
  await writeFile(path.join(outDir, 'catalog.public.pem'), catalogPublicKey, 'utf-8');
  const catalogTrustStore = catalogModule.validatePluginCatalogTrustStore({
    format: catalogModule.PLUGIN_CATALOG_TRUST_STORE_FORMAT,
    keys: mergeTrustKeys(configuredCatalogTrust.keys, {
      algorithm: 'ed25519',
      keyId: catalogKeyId,
      publicKey: catalogPublicKey,
      status: 'active',
    }),
    revokedKeyIds: Array.isArray(configuredCatalogTrust.revokedKeyIds)
      ? [...configuredCatalogTrust.revokedKeyIds].sort()
      : [],
  });
  await writeFile(
    path.join(outDir, 'catalog-trust.json'),
    JSON.stringify(catalogTrustStore, null, 2),
    'utf-8',
  );
}

console.log(`catalog ${catalogPath}`);
if (catalogPublicKey) {
  console.log(`catalog public key ${path.join(outDir, 'catalog.public.pem')}`);
}
