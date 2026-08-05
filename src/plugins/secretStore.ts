import { statePath } from '../paths.js';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import path from 'path';

interface EncryptedPluginSecret {
  encrypted: true;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
}

type StoredPluginSecretValue = string | EncryptedPluginSecret;
type StoredPluginSecrets = Record<string, Record<string, StoredPluginSecretValue>>;

export interface PluginSecretStore {
  get(pluginId: string, key: string): Promise<string | undefined>;
  has(pluginId: string, key: string): Promise<boolean>;
  set(pluginId: string, key: string, value: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEncryptedPluginSecret(value: unknown): value is EncryptedPluginSecret {
  return (
    isRecord(value) &&
    value.encrypted === true &&
    value.algorithm === 'aes-256-gcm' &&
    typeof value.iv === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.data === 'string'
  );
}

function normalizeStoredSecrets(raw: unknown): StoredPluginSecrets {
  if (!isRecord(raw)) {
    return {};
  }
  const stored: StoredPluginSecrets = {};
  for (const [pluginId, secrets] of Object.entries(raw)) {
    if (!isRecord(secrets)) {
      continue;
    }
    const pluginSecrets: Record<string, StoredPluginSecretValue> = {};
    for (const [key, value] of Object.entries(secrets)) {
      if (typeof value === 'string' || isEncryptedPluginSecret(value)) {
        pluginSecrets[key] = value;
      }
    }
    stored[pluginId] = pluginSecrets;
  }
  return stored;
}

export class JsonPluginSecretStore implements PluginSecretStore {
  private readonly encryptionKey?: Buffer;

  constructor(
    private readonly filePath: string,
    encryptionSecret?: string,
  ) {
    this.encryptionKey = encryptionSecret
      ? createHash('sha256').update(encryptionSecret).digest()
      : undefined;
  }

  async get(pluginId: string, key: string): Promise<string | undefined> {
    const value = (await this.readAll())[pluginId]?.[key];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (!this.encryptionKey) {
      return undefined;
    }
    return this.decrypt(value);
  }

  async has(pluginId: string, key: string): Promise<boolean> {
    const value = await this.get(pluginId, key);
    return value !== undefined && value.length > 0;
  }

  async set(pluginId: string, key: string, value: string): Promise<void> {
    const stored = await this.readAll();
    stored[pluginId] = {
      ...(stored[pluginId] ?? {}),
      [key]: this.encryptionKey ? this.encrypt(value) : value,
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(stored, null, 2), 'utf-8');
  }

  private async readAll(): Promise<StoredPluginSecrets> {
    try {
      return normalizeStoredSecrets(JSON.parse(await readFile(this.filePath, 'utf-8')) as unknown);
    } catch {
      return {};
    }
  }

  private encrypt(value: string): EncryptedPluginSecret {
    if (!this.encryptionKey) {
      throw new Error('Plugin secret encryption key is not configured');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()]);
    return {
      encrypted: true,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    };
  }

  private decrypt(value: EncryptedPluginSecret): string {
    if (!this.encryptionKey) {
      throw new Error('Plugin secret encryption key is not configured');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(value.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(value.data, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf-8');
  }
}

export function createPluginSecretStoreFromEnv(env: NodeJS.ProcessEnv): PluginSecretStore {
  return new JsonPluginSecretStore(
    env.DOCKSCOPE_PLUGIN_SECRETS || statePath(env, 'plugin-secrets.json'),
    env.DOCKSCOPE_PLUGIN_SECRET_KEY,
  );
}
