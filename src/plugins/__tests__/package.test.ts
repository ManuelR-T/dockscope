import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { createHash, generateKeyPairSync } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createPluginPackageFromPath, extractPluginPackage, verifyPluginPackage } from '../package';

async function createPluginDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dockscope-package-'));
  const pluginDir = path.join(root, 'plugin');
  await mkdir(pluginDir);
  await writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'package.demo',
      name: 'Package Demo',
      version: '1.0.0',
      dockscopeApiVersion: '1',
      entry: './plugin.mjs',
      capabilities: ['source.graph'],
      permissions: [],
    }),
    'utf-8',
  );
  await writeFile(
    path.join(pluginDir, 'plugin.mjs'),
    'export default function createPlugin({ manifest }) { return { manifest }; }',
    'utf-8',
  );
  return pluginDir;
}

describe('plugin packages', () => {
  it('creates, verifies, signs, and extracts plugin packages', async () => {
    const pluginDir = await createPluginDir();
    const outFile = path.join(
      await mkdtemp(path.join(tmpdir(), 'dockscope-package-out-')),
      'p.json',
    );
    const targetDir = path.join(
      await mkdtemp(path.join(tmpdir(), 'dockscope-package-target-')),
      'plugin',
    );

    const bundle = await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile,
      signingKey: 'local-key',
    });
    const verified = await verifyPluginPackage(outFile, { signingKey: 'local-key' });
    await extractPluginPackage(verified, targetDir);

    expect(bundle.signature?.algorithm).toBe('hmac-sha256');
    expect(verified.signatureVerified).toBe(true);
    await expect(readFile(path.join(targetDir, 'plugin.mjs'), 'utf-8')).resolves.toContain(
      'createPlugin',
    );
  });

  it('rejects packages with the wrong signing key', async () => {
    const pluginDir = await createPluginDir();
    const outFile = path.join(
      await mkdtemp(path.join(tmpdir(), 'dockscope-package-out-')),
      'p.json',
    );

    await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile,
      signingKey: 'local-key',
    });

    await expect(verifyPluginPackage(outFile, { signingKey: 'wrong-key' })).rejects.toThrow(
      'Plugin package signature mismatch',
    );
  });

  it('creates and verifies Ed25519 signed plugin packages', async () => {
    const pluginDir = await createPluginDir();
    const outFile = path.join(
      await mkdtemp(path.join(tmpdir(), 'dockscope-package-out-')),
      'p.json',
    );
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');

    const bundle = await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile,
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      keyId: 'test-key',
    });
    const verified = await verifyPluginPackage(outFile, {
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });

    expect(bundle.signature).toMatchObject({ algorithm: 'ed25519', keyId: 'test-key' });
    expect(verified.signatureVerified).toBe(true);
  });

  it('creates reproducible package artifacts from identical inputs', async () => {
    const pluginDir = await createPluginDir();
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dockscope-package-reproducible-'));
    const firstPath = path.join(outputDir, 'first.dockscope-plugin');
    const secondPath = path.join(outputDir, 'second.dockscope-plugin');
    const { privateKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

    await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile: firstPath,
      privateKey: privateKeyPem,
      keyId: 'reproducible-key',
    });
    await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile: secondPath,
      privateKey: privateKeyPem,
      keyId: 'reproducible-key',
    });

    expect(await readFile(secondPath)).toEqual(await readFile(firstPath));
  });

  it('rejects duplicate paths and manifests that differ from plugin.json', async () => {
    const pluginDir = await createPluginDir();
    const outputDir = await mkdtemp(path.join(tmpdir(), 'dockscope-package-hardening-'));
    const packagePath = path.join(outputDir, 'plugin.dockscope-plugin');
    const bundle = await createPluginPackageFromPath({
      sourcePath: pluginDir,
      outFile: packagePath,
    });

    await writeFile(
      packagePath,
      JSON.stringify({ ...bundle, files: [...bundle.files, bundle.files[0]] }),
      'utf-8',
    );
    await expect(verifyPluginPackage(packagePath)).rejects.toThrow('Duplicate plugin package path');

    const files = bundle.files.map((file) => ({ ...file }));
    const manifestFile = files.find((file) => file.path === 'plugin.json');
    if (!manifestFile) {
      throw new Error('Test package did not contain plugin.json');
    }
    const changedManifest = JSON.parse(
      Buffer.from(manifestFile.contentBase64, 'base64').toString('utf-8'),
    ) as Record<string, unknown>;
    changedManifest.version = '2.0.0';
    const changedContents = Buffer.from(JSON.stringify(changedManifest), 'utf-8');
    manifestFile.contentBase64 = changedContents.toString('base64');
    manifestFile.sha256 = createHash('sha256').update(changedContents).digest('hex');
    const changedBundle = {
      format: bundle.format,
      manifest: bundle.manifest,
      files,
      sha256: createHash('sha256')
        .update(JSON.stringify({ format: bundle.format, manifest: bundle.manifest, files }))
        .digest('hex'),
    };
    await writeFile(packagePath, JSON.stringify(changedBundle), 'utf-8');

    await expect(verifyPluginPackage(packagePath)).rejects.toThrow(
      'Plugin package manifest does not match plugin.json',
    );
  });
});
