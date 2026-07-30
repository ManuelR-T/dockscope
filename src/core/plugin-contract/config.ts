export type PluginConfigFieldType = 'string' | 'number' | 'boolean' | 'select';
export type PluginConfigValue = string | number | boolean;
export type PluginConfig = Record<string, PluginConfigValue>;

export interface PluginConfigOption {
  label: string;
  value: string;
}

export interface PluginConfigField {
  key: string;
  label: string;
  type: PluginConfigFieldType;
  description?: string;
  required?: boolean;
  default?: PluginConfigValue;
  options?: readonly PluginConfigOption[];
}

export interface PluginConfigSchema {
  fields: readonly PluginConfigField[];
}

export interface PluginConfigValidationOptions {
  partial?: boolean;
}

const CONFIG_FIELD_TYPES = new Set<string>(['string', 'number', 'boolean', 'select']);
const CONFIG_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;

export class PluginConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginConfigError';
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
    throw new PluginConfigError(`Plugin config field "${field}" must be a non-empty string`);
  }
  return value;
}

function validateConfigValueType(
  value: unknown,
  field: Pick<PluginConfigField, 'key' | 'type' | 'options'>,
): PluginConfigValue {
  switch (field.type) {
    case 'string':
      if (typeof value === 'string') {
        return value;
      }
      break;
    case 'number':
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      break;
    case 'boolean':
      if (typeof value === 'boolean') {
        return value;
      }
      break;
    case 'select':
      if (typeof value === 'string' && field.options?.some((option) => option.value === value)) {
        return value;
      }
      break;
  }
  throw new PluginConfigError(
    `Plugin config value "${field.key}" must be ${field.type === 'select' ? 'one of its options' : `a ${field.type}`}`,
  );
}

function validateConfigOption(raw: unknown, fieldKey: string): PluginConfigOption {
  if (!isRecord(raw)) {
    throw new PluginConfigError(`Plugin config option for "${fieldKey}" must be an object`);
  }
  if (!isNonEmptyString(raw.label)) {
    throw new PluginConfigError(`Plugin config option for "${fieldKey}" requires a label`);
  }
  if (!isNonEmptyString(raw.value)) {
    throw new PluginConfigError(`Plugin config option for "${fieldKey}" requires a value`);
  }
  return { label: raw.label, value: raw.value };
}

function validateConfigField(raw: unknown): PluginConfigField {
  if (!isRecord(raw)) {
    throw new PluginConfigError('Plugin config fields must be objects');
  }
  if (!isNonEmptyString(raw.key)) {
    throw new PluginConfigError('Plugin config field "key" is required');
  }
  const key = raw.key;
  if (!CONFIG_KEY_PATTERN.test(key)) {
    throw new PluginConfigError(`Invalid plugin config key: ${key}`);
  }
  if (!isNonEmptyString(raw.label)) {
    throw new PluginConfigError(`Plugin config field "${key}" requires a label`);
  }
  const label = raw.label;
  if (typeof raw.type !== 'string' || !CONFIG_FIELD_TYPES.has(raw.type)) {
    throw new PluginConfigError(`Plugin config field "${key}" has an unsupported type`);
  }

  const type = raw.type as PluginConfigFieldType;
  const options =
    raw.options === undefined
      ? undefined
      : Array.isArray(raw.options)
        ? raw.options.map((option) => validateConfigOption(option, key))
        : undefined;
  if (raw.options !== undefined && !options) {
    throw new PluginConfigError(`Plugin config field "${key}" options must be an array`);
  }
  if (type === 'select' && (!options || options.length === 0)) {
    throw new PluginConfigError(`Plugin config field "${key}" requires select options`);
  }

  const field: PluginConfigField = {
    key,
    label,
    type,
    description: optionalString(raw.description, `${raw.key}.description`),
    required: raw.required === true,
    options,
  };
  if (raw.default !== undefined) {
    field.default = validateConfigValueType(raw.default, field);
  }
  return field;
}

export function validatePluginConfigSchema(raw: unknown): PluginConfigSchema {
  if (!isRecord(raw)) {
    throw new PluginConfigError('Plugin config schema must be an object');
  }
  if (!Array.isArray(raw.fields)) {
    throw new PluginConfigError('Plugin config schema field "fields" must be an array');
  }
  const fields = raw.fields.map(validateConfigField);
  const keys = new Set<string>();
  for (const field of fields) {
    if (keys.has(field.key)) {
      throw new PluginConfigError(`Duplicate plugin config key: ${field.key}`);
    }
    keys.add(field.key);
  }
  return { fields };
}

export function defaultPluginConfig(schema: PluginConfigSchema | undefined): PluginConfig {
  const config: PluginConfig = {};
  for (const field of schema?.fields ?? []) {
    if (field.default !== undefined) {
      config[field.key] = field.default;
    }
  }
  return config;
}

export function validatePluginConfigValues(
  raw: unknown,
  schema: PluginConfigSchema | undefined,
  options: PluginConfigValidationOptions = {},
): PluginConfig {
  const input = raw === undefined ? {} : raw;
  if (!isRecord(input)) {
    throw new PluginConfigError('Plugin config values must be an object');
  }
  if (!schema) {
    if (Object.keys(input).length > 0) {
      throw new PluginConfigError('Plugin does not expose configuration');
    }
    return {};
  }

  const fieldsByKey = new Map(schema.fields.map((field) => [field.key, field]));
  for (const key of Object.keys(input)) {
    if (!fieldsByKey.has(key)) {
      throw new PluginConfigError(`Unknown plugin config key: ${key}`);
    }
  }

  const config = defaultPluginConfig(schema);
  for (const field of schema.fields) {
    if (input[field.key] !== undefined) {
      config[field.key] = validateConfigValueType(input[field.key], field);
      continue;
    }
    if (!options.partial && field.required && config[field.key] === undefined) {
      throw new PluginConfigError(`Plugin config value "${field.key}" is required`);
    }
  }
  return config;
}
