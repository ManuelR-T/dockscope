import { execFile as execFileCallback } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import type { PluginCapability, PluginPermission } from '../core/plugin-contract/capabilities.js';
import type { PluginHostApi } from '../core/plugin-contract/api.js';
import type { PluginEvent } from '../core/plugin-contract/events.js';
import type { PluginSecretDeclaration } from '../core/plugin-contract/secrets.js';
import type { PluginSecretStore } from './secretStore.js';
import { createPluginStorage } from './storage.js';
import { DockscopeError } from '../core/errors.js';

const execFileAsync = promisify(execFileCallback);

export type { PluginHostApi, PluginHostExecResult } from '../core/plugin-contract/api.js';

export class PluginPermissionError extends DockscopeError {
  constructor(
    readonly permission: PluginPermission,
    pluginId: string,
    options?: ErrorOptions,
  ) {
    super(`Plugin "${pluginId}" requires permission "${permission}"`, {
      code: 'PLUGIN_PERMISSION_DENIED',
      category: 'permission',
      cause: options?.cause,
    });
    this.name = 'PluginPermissionError';
  }
}

export class PluginCapabilityError extends DockscopeError {
  constructor(
    readonly capability: PluginCapability,
    pluginId: string,
    options?: ErrorOptions,
  ) {
    super(`Plugin "${pluginId}" requires capability "${capability}"`, {
      code: 'PLUGIN_CAPABILITY_DENIED',
      category: 'permission',
      cause: options?.cause,
    });
    this.name = 'PluginCapabilityError';
  }
}

function requirePermission(
  pluginId: string,
  permissions: ReadonlySet<PluginPermission>,
  permission: PluginPermission,
): void {
  if (!permissions.has(permission)) {
    throw new PluginPermissionError(permission, pluginId);
  }
}

function requireCapability(
  pluginId: string,
  capabilities: ReadonlySet<PluginCapability>,
  capability: PluginCapability,
): void {
  if (!capabilities.has(capability)) {
    throw new PluginCapabilityError(capability, pluginId);
  }
}

function resolveInsidePluginDir(pluginDir: string, relativePath: string): string {
  const resolved = path.resolve(pluginDir, relativePath);
  const relative = path.relative(pluginDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Plugin file access must stay inside the plugin directory');
  }
  return resolved;
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local')
  );
}

function requiredNetworkPermission(url: string): PluginPermission {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Plugin fetchJson only supports http(s) URLs');
  }
  return isLocalHost(parsed.hostname) ? 'network.local' : 'network.http';
}

export function createPluginHostApi(options: {
  pluginId: string;
  pluginDir: string;
  capabilities: readonly PluginCapability[];
  permissions: readonly PluginPermission[];
  secrets?: readonly PluginSecretDeclaration[];
  secretStore?: PluginSecretStore;
  publishEvent?: (type: string, payload: unknown) => PluginEvent | Promise<PluginEvent>;
}): PluginHostApi {
  const permissions = new Set(options.permissions);
  const capabilities = new Set(options.capabilities);
  const allowedSecrets = new Set((options.secrets ?? []).map((secret) => secret.key));
  return {
    ...createPluginStorage(options.pluginDir),
    permissions: [...permissions],
    async readTextFile(relativePath) {
      requirePermission(options.pluginId, permissions, 'filesystem.read');
      return readFile(resolveInsidePluginDir(options.pluginDir, relativePath), 'utf-8');
    },
    async writeTextFile(relativePath, contents) {
      requirePermission(options.pluginId, permissions, 'filesystem.write');
      const targetPath = resolveInsidePluginDir(options.pluginDir, relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, contents, 'utf-8');
    },
    async fetchJson(url, init) {
      requirePermission(options.pluginId, permissions, requiredNetworkPermission(url));
      const response = await fetch(url, init);
      if (!response.ok) {
        throw new Error(`Plugin fetch failed with HTTP ${response.status}`);
      }
      return response.json() as Promise<unknown>;
    },
    async execFile(command, args = []) {
      requirePermission(options.pluginId, permissions, 'process.exec');
      const result = await execFileAsync(command, [...args], {
        cwd: options.pluginDir,
        timeout: 30_000,
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
    async readSecret(key) {
      requirePermission(options.pluginId, permissions, 'secrets.read');
      if (!allowedSecrets.has(key)) {
        throw new Error(`Plugin secret is not declared: ${key}`);
      }
      return options.secretStore?.get(options.pluginId, key);
    },
    async publishEvent(type, payload) {
      requireCapability(options.pluginId, capabilities, 'source.events');
      if (!options.publishEvent) {
        throw new Error('Plugin event bus is not configured');
      }
      return options.publishEvent(type, payload);
    },
  };
}
