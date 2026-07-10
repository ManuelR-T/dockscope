import { validatePluginConfigSchema, type PluginConfigSchema } from './plugin-config.js';

export interface PluginCommandDeclaration {
  id: string;
  title: string;
  description?: string;
  confirm?: boolean;
  input?: PluginConfigSchema;
}

export interface PluginCommand {
  pluginId: string;
  id: string;
  title: string;
  description?: string;
  confirm?: boolean;
  input?: PluginConfigSchema;
}

export interface PluginCommandResult {
  ok: boolean;
  message?: string;
  data?: unknown;
}

const COMMAND_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;

export class PluginCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginCommandError';
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
    throw new PluginCommandError(`Plugin command field "${field}" must be a non-empty string`);
  }
  return value;
}

function optionalInputSchema(value: unknown): PluginConfigSchema | undefined {
  return value === undefined ? undefined : validatePluginConfigSchema(value);
}

function validatePluginCommand(raw: unknown): PluginCommandDeclaration {
  if (!isRecord(raw)) {
    throw new PluginCommandError('Plugin commands must be objects');
  }
  if (!isNonEmptyString(raw.id)) {
    throw new PluginCommandError('Plugin command field "id" is required');
  }
  if (!COMMAND_ID_PATTERN.test(raw.id)) {
    throw new PluginCommandError(`Invalid plugin command id: ${raw.id}`);
  }
  if (!isNonEmptyString(raw.title)) {
    throw new PluginCommandError(`Plugin command "${raw.id}" requires a title`);
  }
  const command: PluginCommandDeclaration = {
    id: raw.id,
    title: raw.title,
    description: optionalString(raw.description, `${raw.id}.description`),
    confirm: raw.confirm === true,
  };
  const input = optionalInputSchema(raw.input);
  if (input) {
    command.input = input;
  }
  return command;
}

export function validatePluginCommands(raw: unknown): PluginCommandDeclaration[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PluginCommandError('Plugin commands must be an array');
  }
  const commands = raw.map(validatePluginCommand);
  const ids = new Set<string>();
  for (const command of commands) {
    if (ids.has(command.id)) {
      throw new PluginCommandError(`Duplicate plugin command id: ${command.id}`);
    }
    ids.add(command.id);
  }
  return commands;
}

export function validatePluginCommandResult(raw: unknown): PluginCommandResult {
  if (!isRecord(raw)) {
    throw new PluginCommandError('Plugin command result must be an object');
  }
  if (typeof raw.ok !== 'boolean') {
    throw new PluginCommandError('Plugin command result field "ok" must be a boolean');
  }
  return {
    ok: raw.ok,
    message: optionalString(raw.message, 'message'),
    data: raw.data,
  };
}

export function hydratePluginCommand(
  pluginId: string,
  declaration: PluginCommandDeclaration,
): PluginCommand {
  return {
    ...declaration,
    pluginId,
  };
}
