import type { PluginRuntimeInfo } from '../../../core/plugin-contract/manifest';

import type { PluginUiExtension } from '../../../core/plugin-contract/ui';

import type { PluginEvent } from '../../../core/plugin-contract/events';

import type { PluginMarketplaceEntry } from '../../../plugins/marketplace';

type MarketplaceAction = 'install' | 'update' | 'uninstall';

export function extensionContentPreview(extension: PluginUiExtension): string {
  const content = extension.content;
  if (!content) {
    return '';
  }
  if (content.type === 'text' || content.type === 'markdown') {
    return content.body;
  }
  if (content.type === 'metrics' || content.type === 'keyValue') {
    return content.items.map((item) => `${item.label}: ${item.value}`).join('\n');
  }
  return '';
}

export function eventPayload(event: PluginEvent): string {
  try {
    return JSON.stringify(event.payload, null, 2);
  } catch {
    return String(event.payload);
  }
}

export function statusClass(status: PluginRuntimeInfo['status']): string {
  return status === 'started'
    ? 'ok'
    : status === 'failed' || status === 'quarantined'
      ? 'bad'
      : 'idle';
}

export function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KiB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

export function listText(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

export function shortFingerprint(value: string): string {
  return value.slice(0, 12);
}

export function riskTone(level: string): 'success' | 'warn' | 'danger' {
  if (level === 'low') {
    return 'success';
  }
  return level === 'high' ? 'danger' : 'warn';
}

export function marketplaceStateTone(
  entry: PluginMarketplaceEntry,
): 'accent' | 'success' | 'warn' | 'info' {
  if (entry.state === 'installed') {
    return 'success';
  }
  if (entry.state === 'update_available') {
    return 'warn';
  }
  if (entry.state === 'local') {
    return 'info';
  }
  return 'accent';
}

export function marketplaceLabel(entry: PluginMarketplaceEntry): string {
  if (entry.state === 'update_available') {
    return 'update';
  }
  if (entry.state === 'local') {
    return 'local';
  }
  return entry.state;
}

export function marketplaceActionLabel(entry: PluginMarketplaceEntry): string {
  if (entry.state === 'available') {
    return 'Install';
  }
  if (entry.state === 'update_available') {
    return 'Update';
  }
  return 'Uninstall';
}

export function marketplaceActionType(entry: PluginMarketplaceEntry): MarketplaceAction {
  if (entry.state === 'available') {
    return 'install';
  }
  if (entry.state === 'update_available') {
    return 'update';
  }
  return 'uninstall';
}

export function marketplaceActionKey(entry: PluginMarketplaceEntry): string {
  return `${entry.id}:${marketplaceActionType(entry)}`;
}

export function marketplaceTrust(entry: PluginMarketplaceEntry): string {
  if (entry.signature) {
    return entry.signature.keyId
      ? `${entry.signature.algorithm}:${entry.signature.keyId}`
      : entry.signature.algorithm;
  }
  return entry.installed?.signatureAlgorithm ?? 'unsigned';
}

export function formatDate(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function marketplaceVersionLine(entry: PluginMarketplaceEntry): string {
  if (!entry.installed) {
    return `new install v${entry.version}`;
  }
  if (entry.installed.version === entry.version) {
    return `installed v${entry.installed.version}`;
  }
  return `installed v${entry.installed.version} -> catalog v${entry.version}`;
}

export function marketplaceCompatibility(entry: PluginMarketplaceEntry): string {
  const parts = [];
  if (entry.compatibility?.minDockscopeVersion) {
    parts.push(`min ${entry.compatibility.minDockscopeVersion}`);
  }
  if (entry.compatibility?.maxDockscopeVersion) {
    parts.push(`max ${entry.compatibility.maxDockscopeVersion}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'not declared';
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
