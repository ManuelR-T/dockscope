export interface PluginSecretDeclaration {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface PluginSecretStatus extends PluginSecretDeclaration {
  configured: boolean;
}

export interface PluginSecretSnapshot {
  pluginId: string;
  secrets: PluginSecretStatus[];
}

const SECRET_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;

export class PluginSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginSecretError';
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
    throw new PluginSecretError(`Plugin secret field "${field}" must be a non-empty string`);
  }
  return value;
}

function validatePluginSecretDeclaration(raw: unknown): PluginSecretDeclaration {
  if (!isRecord(raw)) {
    throw new PluginSecretError('Plugin secret declarations must be objects');
  }
  if (!isNonEmptyString(raw.key)) {
    throw new PluginSecretError('Plugin secret field "key" is required');
  }
  if (!SECRET_KEY_PATTERN.test(raw.key)) {
    throw new PluginSecretError(`Invalid plugin secret key: ${raw.key}`);
  }
  if (!isNonEmptyString(raw.label)) {
    throw new PluginSecretError(`Plugin secret "${raw.key}" requires a label`);
  }
  return {
    key: raw.key,
    label: raw.label,
    description: optionalString(raw.description, `${raw.key}.description`),
    required: raw.required === true,
  };
}

export function validatePluginSecrets(raw: unknown): PluginSecretDeclaration[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PluginSecretError('Plugin secrets must be an array');
  }
  const secrets = raw.map(validatePluginSecretDeclaration);
  const keys = new Set<string>();
  for (const secret of secrets) {
    if (keys.has(secret.key)) {
      throw new PluginSecretError(`Duplicate plugin secret key: ${secret.key}`);
    }
    keys.add(secret.key);
  }
  return secrets;
}
