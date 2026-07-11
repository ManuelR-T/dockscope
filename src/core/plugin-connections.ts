import {
  validatePluginConfigSchema,
  type PluginConfig,
  type PluginConfigSchema,
} from './plugin-config.js';

export type PluginConnectionStatus = 'connected' | 'disconnected' | 'unknown';

export interface PluginConnectionProviderDeclaration {
  id: string;
  label: string;
  description?: string;
  input: PluginConfigSchema;
}

export interface PluginConnectionProviderDescriptor extends PluginConnectionProviderDeclaration {
  pluginId: string;
}

export interface PluginConnectionDeclaration {
  id: string;
  label: string;
  status: PluginConnectionStatus;
  endpoint?: string;
  removable?: boolean;
  metadata?: Record<string, string | number | boolean>;
}

export interface PluginConnection extends PluginConnectionDeclaration {
  pluginId: string;
  providerId: string;
}

export interface PluginConnectionProvider {
  describe(): PluginConnectionProviderDeclaration;
  listConnections():
    | readonly PluginConnectionDeclaration[]
    | Promise<readonly PluginConnectionDeclaration[]>;
  addConnection(input: PluginConfig): Promise<void>;
  removeConnection(connectionId: string): Promise<void>;
  refreshConnections?(): Promise<void>;
}

const CONNECTION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;

export class PluginConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginConnectionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !CONNECTION_ID_PATTERN.test(value)) {
    throw new PluginConnectionError(`Connection field "${field}" has an invalid id`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PluginConnectionError(`Connection field "${field}" must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, field);
}

function scalarMetadata(
  value: unknown,
  field: string,
): Record<string, string | number | boolean> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !isRecord(value) ||
    Object.values(value).some(
      (item) => typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean',
    )
  ) {
    throw new PluginConnectionError(`Connection field "${field}" must contain scalar values`);
  }
  return { ...value } as Record<string, string | number | boolean>;
}

export function validatePluginConnectionProvider(
  raw: unknown,
): PluginConnectionProviderDeclaration {
  if (!isRecord(raw)) {
    throw new PluginConnectionError('Connection provider descriptor must be an object');
  }
  return {
    id: requiredId(raw.id, 'id'),
    label: requiredString(raw.label, 'label'),
    description: optionalString(raw.description, 'description'),
    input: validatePluginConfigSchema(raw.input),
  };
}

export function validatePluginConnections(raw: unknown): PluginConnectionDeclaration[] {
  if (!Array.isArray(raw)) {
    throw new PluginConnectionError('Plugin connections must be an array');
  }
  return raw.map((item, index) => {
    if (!isRecord(item)) {
      throw new PluginConnectionError(`Plugin connection ${index} must be an object`);
    }
    if (
      item.status !== 'connected' &&
      item.status !== 'disconnected' &&
      item.status !== 'unknown'
    ) {
      throw new PluginConnectionError(`Plugin connection ${index} has an invalid status`);
    }
    return {
      id: requiredId(item.id, `${index}.id`),
      label: requiredString(item.label, `${index}.label`),
      status: item.status,
      endpoint: optionalString(item.endpoint, `${index}.endpoint`),
      removable: item.removable === true,
      metadata: scalarMetadata(item.metadata, `${index}.metadata`),
    };
  });
}
