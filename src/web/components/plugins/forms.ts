import type { PluginConfigField, PluginConfigValue } from '../../../core/plugin-contract/config';

import type { PluginCommand } from '../../../core/plugin-contract/commands';

const FIELD_DEFAULTS = new Map<string, PluginConfigValue>([
  ['string', ''],
  ['select', ''],
  ['boolean', false],
  ['number', 0],
]);

export function inputValue(event: Event): string {
  return (event.currentTarget as HTMLInputElement).value;
}

export function checkedValue(event: Event): boolean {
  return (event.currentTarget as HTMLInputElement).checked;
}

export function defaultFieldValue(field: PluginConfigField): PluginConfigValue {
  if (field.default !== undefined) {
    return field.default;
  }
  return FIELD_DEFAULTS.get(field.type) ?? '';
}

export function commandKey(command: PluginCommand): string {
  return `${command.pluginId}:${command.id}`;
}

export function commandInputDefaults(command: PluginCommand): Record<string, PluginConfigValue> {
  return Object.fromEntries(
    (command.input?.fields ?? []).map((field) => [field.key, defaultFieldValue(field)]),
  );
}
