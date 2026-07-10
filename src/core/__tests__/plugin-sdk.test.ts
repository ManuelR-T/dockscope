import { readFile } from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  DOCKSCOPE_PLUGIN_API_VERSION,
  DOCKSCOPE_PLUGIN_HOST_API_VERSION,
  DOCKSCOPE_PLUGIN_MANIFEST_VERSION,
  PLUGIN_CAPABILITIES,
  PLUGIN_API_V1,
  PLUGIN_PERMISSIONS,
  definePluginFactory,
  definePluginManifest,
  validatePluginManifestWithWarnings,
} from '../../plugin-sdk-v1';

const manifest = definePluginManifest({
  id: 'sdk.contract',
  name: 'SDK Contract',
  version: '1.0.0',
  manifestVersion: '1',
  dockscopeApiVersion: '1',
  hostApiVersion: '1',
  entry: './plugin.mjs',
  capabilities: ['ui.command'],
  permissions: [],
  commands: [{ id: 'ping', title: 'Ping' }],
  execution: { isolation: 'process', operationTimeoutMs: 5000, memoryLimitMb: 128 },
});

describe('versioned plugin SDK', () => {
  it('exposes explicit v1 contract versions and typed helpers', async () => {
    expect(DOCKSCOPE_PLUGIN_MANIFEST_VERSION).toBe('1');
    expect(DOCKSCOPE_PLUGIN_API_VERSION).toBe('1');
    expect(DOCKSCOPE_PLUGIN_HOST_API_VERSION).toBe('1');
    expect(PLUGIN_API_V1).toMatchObject({
      pluginApiVersion: '1',
      hostApiVersion: '1',
      manifestVersion: '1',
    });

    const factory = definePluginFactory(async ({ manifest: validatedManifest }) => ({
      manifest: validatedManifest,
      runCommand: async () => ({ ok: true }),
    }));

    await expect(
      factory({
        manifest,
        pluginDir: '/tmp/sdk-contract',
        config: {},
        host: {
          permissions: [],
          readTextFile: async () => '',
          writeTextFile: async () => {},
          fetchJson: async () => ({}),
          execFile: async () => ({ stdout: '', stderr: '' }),
          readSecret: async () => undefined,
          readStorage: async () => undefined,
          writeStorage: async () => {},
          deleteStorage: async () => {},
          publishEvent: async (type, payload) => ({
            id: 'event',
            pluginId: manifest.id,
            type,
            payload,
            time: 1,
          }),
        },
        logger: console,
      }),
    ).resolves.toMatchObject({ manifest: { id: 'sdk.contract' } });
  });

  it('normalizes legacy manifests and returns actionable deprecation warnings', () => {
    const result = validatePluginManifestWithWarnings({
      id: 'sdk.legacy',
      name: 'Legacy SDK',
      version: '1.0.0',
      capabilities: [],
      permissions: [],
      execution: { commandTimeoutMs: 4000 },
    });

    expect(result.manifest).toMatchObject({
      manifestVersion: '1',
      dockscopeApiVersion: '1',
      hostApiVersion: '1',
      execution: { operationTimeoutMs: 4000 },
    });
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'manifest-version-defaulted',
      'plugin-api-version-defaulted',
      'host-api-version-defaulted',
      'command-timeout-deprecated',
    ]);
  });

  it('keeps the published JSON Schema enums aligned with the SDK', async () => {
    const schemaPath = path.resolve(process.cwd(), 'schemas/plugin-manifest.schema.json');
    const schema = JSON.parse(await readFile(schemaPath, 'utf-8')) as {
      properties: {
        capabilities: { items: { enum: string[] } };
        permissions: { items: { enum: string[] } };
      };
    };

    expect(schema.properties.capabilities.items.enum).toEqual(PLUGIN_CAPABILITIES);
    expect(schema.properties.permissions.items.enum).toEqual(PLUGIN_PERMISSIONS);
  });
});
