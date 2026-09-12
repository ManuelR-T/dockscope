import { getJson } from '../../lib/api';
import { addToast } from '../../stores/toast.svelte';
import type {
  PluginConfigSnapshot,
  PluginLoadError,
  PluginLoadWarning,
  PluginReviewReport,
  PluginRuntimeInfo,
} from '../../../core/plugin-contract/manifest';
import type { PluginRuntimeHealth } from '../../../core/plugin-contract/runtime';
import type { PluginConfigValue } from '../../../core/plugin-contract/config';
import type { PluginSecretSnapshot } from '../../../core/plugin-contract/secrets';
import type { PluginUiExtension } from '../../../core/plugin-contract/ui';

import type { PluginCommand } from '../../../core/plugin-contract/commands';
import type { PluginEvent } from '../../../core/plugin-contract/events';
import type { PluginCompatibilityReport } from '../../../core/plugin-contract/compatibility';

import type { PluginMarketplaceSnapshot } from '../../../plugins/marketplace';

import { commandKey, commandInputDefaults } from './forms';

/** One consistent refresh for all tabs, including the existing draft-reset policy. */
export class PluginManagerData {
  loading = $state(true);
  plugins = $state<PluginRuntimeInfo[]>([]);
  runtimeHealth = $state<PluginRuntimeHealth[]>([]);
  errors = $state<PluginLoadError[]>([]);
  warnings = $state<PluginLoadWarning[]>([]);
  extensions = $state<PluginUiExtension[]>([]);
  commands = $state<PluginCommand[]>([]);
  events = $state<PluginEvent[]>([]);
  reviews = $state<PluginReviewReport[]>([]);
  marketplace = $state<PluginMarketplaceSnapshot>({
    configured: false,
    registryDir: '',
    approvals: [],
    catalogs: [],
    entries: [],
  });
  compatibility = $state<PluginCompatibilityReport[]>([]);
  configs = $state<PluginConfigSnapshot[]>([]);
  secrets = $state<PluginSecretSnapshot[]>([]);
  drafts = $state<Record<string, Record<string, PluginConfigValue>>>({});
  secretDrafts = $state<Record<string, Record<string, string>>>({});
  commandDrafts = $state<Record<string, Record<string, PluginConfigValue>>>({});

  async loadPluginState() {
    this.loading = true;
    try {
      const [
        pluginData,
        healthData,
        errorData,
        warningData,
        extensionData,
        commandData,
        eventData,
        reviewData,
        marketplaceData,
        compatibilityData,
        configData,
        secretData,
      ] = await Promise.all([
        getJson<PluginRuntimeInfo[]>('/api/plugins'),
        getJson<PluginRuntimeHealth[]>('/api/plugins/health'),
        getJson<PluginLoadError[]>('/api/plugins/errors'),
        getJson<PluginLoadWarning[]>('/api/plugins/warnings'),
        getJson<PluginUiExtension[]>('/api/plugins/ui'),
        getJson<PluginCommand[]>('/api/plugins/commands'),
        getJson<PluginEvent[]>('/api/plugins/events'),
        getJson<PluginReviewReport[]>('/api/plugins/review'),
        getJson<PluginMarketplaceSnapshot>('/api/plugins/marketplace'),
        getJson<PluginCompatibilityReport[]>('/api/plugins/compatibility'),
        getJson<PluginConfigSnapshot[]>('/api/plugins/config'),
        getJson<PluginSecretSnapshot[]>('/api/plugins/secrets'),
      ]);
      this.plugins = pluginData;
      this.runtimeHealth = healthData;
      this.errors = errorData;
      this.warnings = warningData;
      this.extensions = extensionData;
      this.commands = commandData;
      this.events = eventData;
      this.reviews = reviewData;
      this.marketplace = marketplaceData;
      this.compatibility = compatibilityData;
      this.configs = configData;
      this.secrets = secretData;
      this.drafts = Object.fromEntries(
        configData.map((config) => [config.pluginId, { ...config.values }]),
      );
      this.secretDrafts = Object.fromEntries(secretData.map((secret) => [secret.pluginId, {}]));
      this.commandDrafts = Object.fromEntries(
        commandData.map((command) => [
          commandKey(command),
          {
            ...commandInputDefaults(command),
            ...(this.commandDrafts[commandKey(command)] ?? {}),
          },
        ]),
      );
    } catch {
      addToast('Failed to load plugins', 'error');
    } finally {
      this.loading = false;
    }
  }

  async refreshRuntimeHealth() {
    try {
      const [pluginData, healthData] = await Promise.all([
        getJson<PluginRuntimeInfo[]>('/api/plugins'),
        getJson<PluginRuntimeHealth[]>('/api/plugins/health'),
      ]);
      this.plugins = pluginData;
      this.runtimeHealth = healthData;
    } catch {
      // The full refresh path surfaces connectivity failures to the user.
    }
  }
}
