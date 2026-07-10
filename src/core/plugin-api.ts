import type { PluginCapability, PluginPermission } from './capabilities.js';
import type { PluginEvent } from './plugin-events.js';
import type { DockscopePlugin, PluginManifest } from './plugins.js';
import type { PluginConfig } from './plugin-config.js';

export interface PluginHostExecResult {
  stdout: string;
  stderr: string;
}

export interface PluginHostApi {
  readonly permissions: readonly PluginPermission[];
  readTextFile(relativePath: string): Promise<string>;
  writeTextFile(relativePath: string, contents: string): Promise<void>;
  fetchJson(url: string, init?: RequestInit): Promise<unknown>;
  execFile(command: string, args?: readonly string[]): Promise<PluginHostExecResult>;
  readSecret(key: string): Promise<string | undefined>;
  readStorage(key: string): Promise<unknown>;
  writeStorage(key: string, value: unknown): Promise<void>;
  deleteStorage(key: string): Promise<void>;
  publishEvent(type: string, payload?: unknown): Promise<PluginEvent>;
}

export type PluginLogger = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

export interface PluginFactoryContext {
  manifest: PluginManifest;
  pluginDir: string;
  config: PluginConfig;
  host: PluginHostApi;
  logger: PluginLogger;
}

export type PluginFactory = (
  context: PluginFactoryContext,
) => DockscopePlugin | Promise<DockscopePlugin>;

export interface PluginApiDescriptor {
  pluginApiVersion: string;
  hostApiVersion: string;
  manifestVersion: string;
  capabilities: readonly PluginCapability[];
  permissions: readonly PluginPermission[];
}
