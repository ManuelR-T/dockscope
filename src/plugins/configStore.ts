import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import {
  defaultPluginConfig,
  validatePluginConfigValues,
  type PluginConfig,
  type PluginConfigSchema,
  type PluginConfigValue,
} from '../core/plugin-contract/config.js';

type StoredPluginConfig = Record<string, Record<string, PluginConfigValue>>;

export interface PluginConfigStore {
  load(pluginId: string, schema: PluginConfigSchema | undefined): Promise<PluginConfig>;
  save(pluginId: string, config: PluginConfig): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPluginConfigValue(value: unknown): value is PluginConfigValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function normalizeStoredConfig(raw: unknown): StoredPluginConfig {
  if (!isRecord(raw)) {
    return {};
  }
  const stored: StoredPluginConfig = {};
  for (const [pluginId, config] of Object.entries(raw)) {
    if (!isRecord(config)) {
      continue;
    }
    stored[pluginId] = Object.fromEntries(
      Object.entries(config).filter((entry): entry is [string, PluginConfigValue] =>
        isPluginConfigValue(entry[1]),
      ),
    );
  }
  return stored;
}

export class JsonPluginConfigStore implements PluginConfigStore {
  constructor(private readonly filePath: string) {}

  async load(pluginId: string, schema: PluginConfigSchema | undefined): Promise<PluginConfig> {
    const stored = await this.readAll();
    const raw = stored[pluginId] ?? {};
    return validatePluginConfigValues(raw, schema, { partial: true });
  }

  async save(pluginId: string, config: PluginConfig): Promise<void> {
    const stored = await this.readAll();
    stored[pluginId] = config;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(stored, null, 2), 'utf-8');
  }

  private async readAll(): Promise<StoredPluginConfig> {
    try {
      return normalizeStoredConfig(JSON.parse(await readFile(this.filePath, 'utf-8')) as unknown);
    } catch {
      return {};
    }
  }
}

export function createPluginConfigStoreFromEnv(env: NodeJS.ProcessEnv): PluginConfigStore {
  return new JsonPluginConfigStore(
    env.DOCKSCOPE_PLUGIN_CONFIG || path.join(homedir(), '.dockscope', 'plugin-config.json'),
  );
}

export function initialPluginConfig(
  schema: PluginConfigSchema | undefined,
  config: PluginConfig | undefined,
): PluginConfig {
  return config
    ? validatePluginConfigValues(config, schema, { partial: true })
    : defaultPluginConfig(schema);
}
