import { apiErrorMessage, requestJson } from '../../lib/api';
import { addToast } from '../../stores/toast.svelte';
import type {
  PluginConfigSnapshot,
  PluginReviewReport,
  PluginRuntimeInfo,
} from '../../../core/plugin-contract/manifest';
import type { PluginRuntimeHealth } from '../../../core/plugin-contract/runtime';
import type { PluginConfigField, PluginConfigValue } from '../../../core/plugin-contract/config';
import type { PluginSecretSnapshot } from '../../../core/plugin-contract/secrets';
import type { PluginUiExtension } from '../../../core/plugin-contract/ui';
import {
  allowsUiIntent,
  pluginUiActionAllowed,
  pluginUiExtensionAllowed,
  type AccessRole,
} from '../../../core/access';
import type { PluginCommand, PluginCommandResult } from '../../../core/plugin-contract/commands';

import type { PluginCompatibilityReport } from '../../../core/plugin-contract/compatibility';

import { clearPluginFrontendCache, invokePluginUiAction } from '../../lib/pluginUi';

import { defaultFieldValue, commandKey } from './forms';
import { pluralize } from './presentation';
import type { PluginManagerData } from './data.svelte';

/** Installed-plugin interactions survive tab changes; shared refreshes live in data. */
export class InstalledPluginsModel {
  constructor(
    readonly data: PluginManagerData,
    private readonly getRole: () => AccessRole | null,
  ) {}
  get role() {
    return this.getRole();
  }
  get canOperate() {
    return allowsUiIntent(this.role, 'mutation');
  }

  expanded = $state<string | null>(null);
  saving = $state<string | null>(null);
  toggling = $state<string | null>(null);
  reloading = $state<string | null>(null);
  runningCommand = $state<string | null>(null);

  reviewFor(pluginId: string): PluginReviewReport | undefined {
    return this.data.reviews.find((review) => review.pluginId === pluginId);
  }

  compatibilityFor(pluginId: string): PluginCompatibilityReport | undefined {
    const report = this.data.compatibility.find((entry) => entry.pluginId === pluginId);
    if (!report) {
      return undefined;
    }
    const hasContent =
      report.warnings.length > 0 ||
      report.deprecations.length > 0 ||
      report.migrations.length > 0 ||
      Boolean(report.minDockscopeVersion) ||
      Boolean(report.maxDockscopeVersion);
    return hasContent ? report : undefined;
  }

  configFor(pluginId: string): PluginConfigSnapshot | undefined {
    return this.data.configs.find(
      (config) => config.pluginId === pluginId && (config.schema?.fields.length ?? 0) > 0,
    );
  }

  secretsFor(pluginId: string): PluginSecretSnapshot | undefined {
    return this.data.secrets.find(
      (snapshot) => snapshot.pluginId === pluginId && snapshot.secrets.length > 0,
    );
  }

  commandsFor(pluginId: string): PluginCommand[] {
    return this.data.commands.filter((command) => command.pluginId === pluginId);
  }

  extensionsFor(pluginId: string): PluginUiExtension[] {
    return this.data.extensions.filter((extension) => extension.pluginId === pluginId);
  }

  settingsExtensionsFor(pluginId: string): PluginUiExtension[] {
    return this.data.extensions.filter(
      (extension) =>
        extension.pluginId === pluginId &&
        extension.slot === 'settings' &&
        pluginUiExtensionAllowed(this.role, extension.action),
    );
  }

  hasDetail(pluginId: string): boolean {
    return (
      Boolean(this.reviewFor(pluginId)) ||
      Boolean(this.compatibilityFor(pluginId)) ||
      Boolean(this.configFor(pluginId)) ||
      Boolean(this.secretsFor(pluginId)) ||
      this.commandsFor(pluginId).length > 0 ||
      this.extensionsFor(pluginId).length > 0
    );
  }

  detailSummary(pluginId: string): string {
    const parts: string[] = [];
    const commandCount = this.commandsFor(pluginId).length;
    const extensionCount = this.extensionsFor(pluginId).length;
    const secretSnapshot = this.secretsFor(pluginId);
    if (this.configFor(pluginId)) {
      parts.push('config');
    }
    if (secretSnapshot) {
      parts.push(pluralize(secretSnapshot.secrets.length, 'secret', 'secrets'));
    }
    if (commandCount > 0) {
      parts.push(pluralize(commandCount, 'command', 'commands'));
    }
    if (extensionCount > 0) {
      parts.push(pluralize(extensionCount, 'extension', 'extensions'));
    }
    return parts.join(' · ');
  }

  toggleExpanded(pluginId: string) {
    this.expanded = this.expanded === pluginId ? null : pluginId;
  }

  draftValue(pluginId: string, key: string): PluginConfigValue | undefined {
    return this.data.drafts[pluginId]?.[key];
  }

  setDraftValue(pluginId: string, key: string, value: PluginConfigValue) {
    this.data.drafts = {
      ...this.data.drafts,
      [pluginId]: {
        ...(this.data.drafts[pluginId] ?? {}),
        [key]: value,
      },
    };
  }

  fieldValue(pluginId: string, field: PluginConfigField): PluginConfigValue {
    const value = this.draftValue(pluginId, field.key);
    if (value !== undefined) {
      return value;
    }
    return defaultFieldValue(field);
  }

  commandFieldValue(command: PluginCommand, field: PluginConfigField): PluginConfigValue {
    return this.data.commandDrafts[commandKey(command)]?.[field.key] ?? defaultFieldValue(field);
  }

  setCommandInputValue(command: PluginCommand, key: string, value: PluginConfigValue) {
    const id = commandKey(command);
    this.data.commandDrafts = {
      ...this.data.commandDrafts,
      [id]: {
        ...(this.data.commandDrafts[id] ?? {}),
        [key]: value,
      },
    };
  }

  commandInputPayload(command: PluginCommand): Record<string, PluginConfigValue> {
    const payload: Record<string, PluginConfigValue> = {};
    for (const field of command.input?.fields ?? []) {
      payload[field.key] = this.commandFieldValue(command, field);
    }
    return payload;
  }

  async saveConfig(pluginId: string) {
    const snapshot = this.data.configs.find((config) => config.pluginId === pluginId);
    if (!this.canOperate || !snapshot?.schema || this.saving) {
      return;
    }
    this.saving = pluginId;
    const payload: Record<string, PluginConfigValue> = {};
    for (const field of snapshot.schema.fields) {
      payload[field.key] = this.fieldValue(pluginId, field);
    }
    try {
      const updated = await requestJson<PluginConfigSnapshot>(
        `/api/plugins/${encodeURIComponent(pluginId)}/config`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      this.data.configs = this.data.configs.map((config) =>
        config.pluginId === pluginId ? updated : config,
      );
      this.data.drafts = { ...this.data.drafts, [pluginId]: { ...updated.values } };
      addToast(`${pluginId}: config saved`, 'success');
    } catch {
      addToast(`${pluginId}: config save failed`, 'error');
    } finally {
      this.saving = null;
    }
  }

  async togglePlugin(plugin: PluginRuntimeInfo) {
    if (!this.canOperate || plugin.manifest.builtin || this.toggling) {
      return;
    }
    this.toggling = plugin.manifest.id;
    const action = plugin.enabled ? 'disable' : 'enable';
    try {
      const updated = await requestJson<PluginRuntimeInfo>(
        `/api/plugins/${encodeURIComponent(plugin.manifest.id)}/${action}`,
        { method: 'POST' },
      );
      this.data.plugins = this.data.plugins.map((item) =>
        item.manifest.id === updated.manifest.id ? updated : item,
      );
      clearPluginFrontendCache(plugin.manifest.id);
      await this.data.loadPluginState();
      addToast(`${plugin.manifest.name}: ${action}d`, 'success');
    } catch {
      addToast(`${plugin.manifest.name}: ${action} failed`, 'error');
    } finally {
      this.toggling = null;
    }
  }

  async reloadPlugin(plugin: PluginRuntimeInfo) {
    if (!this.canOperate || plugin.manifest.builtin || this.reloading) {
      return;
    }
    this.reloading = plugin.manifest.id;
    try {
      const updated = await requestJson<PluginRuntimeInfo>(
        `/api/plugins/${encodeURIComponent(plugin.manifest.id)}/reload`,
        { method: 'POST' },
      );
      this.data.plugins = this.data.plugins.map((item) =>
        item.manifest.id === updated.manifest.id ? updated : item,
      );
      clearPluginFrontendCache(plugin.manifest.id);
      await this.data.loadPluginState();
      addToast(`${plugin.manifest.name}: reloaded`, 'success');
    } catch {
      addToast(`${plugin.manifest.name}: reload failed`, 'error');
    } finally {
      this.reloading = null;
    }
  }

  async runExtensionAction(extension: PluginUiExtension, input?: unknown) {
    if (!pluginUiActionAllowed(this.role, extension.action)) {
      return;
    }
    try {
      const result = await invokePluginUiAction(extension, {}, input);
      if (result.type === 'open_url') {
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } else {
        addToast(result.result.message || extension.title, result.result.ok ? 'success' : 'error');
      }
    } catch (error) {
      addToast(apiErrorMessage(error) || `${extension.title}: action failed`, 'error');
    }
  }

  async runCommand(command: PluginCommand) {
    const key = commandKey(command);
    if (!this.canOperate || this.runningCommand) {
      return;
    }
    this.runningCommand = key;
    try {
      const hasInput = (command.input?.fields.length ?? 0) > 0;
      const result = await requestJson<PluginCommandResult>(
        `/api/plugins/${encodeURIComponent(command.pluginId)}/commands/${encodeURIComponent(command.id)}`,
        hasInput
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ input: this.commandInputPayload(command) }),
            }
          : { method: 'POST' },
      );
      await this.data.loadPluginState();
      addToast(
        result.message || `${command.title}: ${result.ok ? 'done' : 'failed'}`,
        result.ok ? 'success' : 'error',
      );
    } catch {
      addToast(`${command.title}: command failed`, 'error');
    } finally {
      this.runningCommand = null;
    }
  }

  async runMigration(pluginId: string, from: string, to: string) {
    const key = `${pluginId}:${from}:${to}`;
    if (!this.canOperate || this.runningCommand) {
      return;
    }
    this.runningCommand = key;
    try {
      const result = await requestJson<PluginCommandResult>(
        `/api/plugins/${encodeURIComponent(pluginId)}/migrate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to }),
        },
      );
      await this.data.loadPluginState();
      addToast(
        result.message || `${pluginId}: migration ${from} -> ${to} complete`,
        result.ok ? 'success' : 'error',
      );
    } catch {
      addToast(`${pluginId}: migration failed`, 'error');
    } finally {
      this.runningCommand = null;
    }
  }

  async approvePlugin(pluginId: string) {
    if (!this.canOperate || this.saving) {
      return;
    }
    this.saving = `${pluginId}:approval`;
    try {
      await requestJson(`/api/plugins/${encodeURIComponent(pluginId)}/approve`, { method: 'POST' });
      await this.data.loadPluginState();
      addToast(`${pluginId}: approved`, 'success');
    } catch {
      addToast(`${pluginId}: approval failed`, 'error');
    } finally {
      this.saving = null;
    }
  }

  async revokeApproval(pluginId: string) {
    if (!this.canOperate || this.saving) {
      return;
    }
    this.saving = `${pluginId}:approval`;
    try {
      await requestJson(`/api/plugins/${encodeURIComponent(pluginId)}/revoke-approval`, {
        method: 'POST',
      });
      await this.data.loadPluginState();
      addToast(`${pluginId}: approval revoked`, 'success');
    } catch {
      addToast(`${pluginId}: revoke failed`, 'error');
    } finally {
      this.saving = null;
    }
  }

  setSecretDraft(pluginId: string, key: string, value: string) {
    this.data.secretDrafts = {
      ...this.data.secretDrafts,
      [pluginId]: {
        ...(this.data.secretDrafts[pluginId] ?? {}),
        [key]: value,
      },
    };
  }

  async saveSecret(pluginId: string, key: string) {
    const value = this.data.secretDrafts[pluginId]?.[key];
    if (!this.canOperate || value === undefined || this.saving) {
      return;
    }
    this.saving = `${pluginId}:${key}`;
    try {
      const updated = await requestJson<PluginSecretSnapshot>(
        `/api/plugins/${encodeURIComponent(pluginId)}/secrets/${encodeURIComponent(key)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        },
      );
      this.data.secrets = this.data.secrets.map((secret) =>
        secret.pluginId === pluginId ? updated : secret,
      );
      this.setSecretDraft(pluginId, key, '');
      addToast(`${pluginId}: secret saved`, 'success');
    } catch {
      addToast(`${pluginId}: secret save failed`, 'error');
    } finally {
      this.saving = null;
    }
  }

  healthFor(pluginId: string): PluginRuntimeHealth | undefined {
    return this.data.runtimeHealth.find((health) => health.pluginId === pluginId);
  }
}
