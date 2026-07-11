<script lang="ts">
  import { onMount } from 'svelte';
  import { apiErrorMessage, deleteJson, getJson, requestJson } from '../lib/api';
  import { addToast } from '../stores/toast.svelte';
  import type {
    PluginConfigSnapshot,
    PluginLoadError,
    PluginLoadWarning,
    PluginReviewReport,
    PluginRuntimeInfo,
  } from '../../core/plugins';
  import type { PluginRuntimeHealth } from '../../core/plugin-runtime';
  import type { PluginConfigField, PluginConfigValue } from '../../core/plugin-config';
  import type { PluginSecretSnapshot } from '../../core/plugin-secrets';
  import type { PluginUiExtension } from '../../core/plugin-ui';
  import type { PluginCommand, PluginCommandResult } from '../../core/plugin-commands';
  import type { PluginEvent } from '../../core/plugin-events';
  import type { PluginCompatibilityReport } from '../../core/plugin-compatibility';
  import PluginExtension from './PluginExtension.svelte';
  import { clearPluginFrontendCache, invokePluginUiAction } from '../lib/pluginUi';
  import type {
    PluginMarketplaceEntry,
    PluginMarketplaceSnapshot,
  } from '../../plugins/marketplace';
  import Icon from './Icon.svelte';

  interface Props {
    onClose: () => void;
  }

  type MarketplaceAction = 'install' | 'update' | 'uninstall';
  type MarketplaceFilter = 'all' | 'available' | 'installed' | 'updates' | 'local' | 'deprecated';

  interface MarketplaceReview {
    entry: PluginMarketplaceEntry;
    action: MarketplaceAction;
  }

  let { onClose }: Props = $props();

  let tab = $state<
    | 'plugins'
    | 'extensions'
    | 'commands'
    | 'events'
    | 'review'
    | 'marketplace'
    | 'compatibility'
    | 'config'
    | 'secrets'
  >('plugins');
  let loading = $state(true);
  let plugins = $state<PluginRuntimeInfo[]>([]);
  let runtimeHealth = $state<PluginRuntimeHealth[]>([]);
  let errors = $state<PluginLoadError[]>([]);
  let warnings = $state<PluginLoadWarning[]>([]);
  let extensions = $state<PluginUiExtension[]>([]);
  let commands = $state<PluginCommand[]>([]);
  let events = $state<PluginEvent[]>([]);
  let reviews = $state<PluginReviewReport[]>([]);
  let marketplace = $state<PluginMarketplaceSnapshot>({
    configured: false,
    registryDir: '',
    approvals: [],
    entries: [],
  });
  let compatibility = $state<PluginCompatibilityReport[]>([]);
  let configs = $state<PluginConfigSnapshot[]>([]);
  let secrets = $state<PluginSecretSnapshot[]>([]);
  let drafts = $state<Record<string, Record<string, PluginConfigValue>>>({});
  let secretDrafts = $state<Record<string, Record<string, string>>>({});
  let commandDrafts = $state<Record<string, Record<string, PluginConfigValue>>>({});
  let saving = $state<string | null>(null);
  let toggling = $state<string | null>(null);
  let reloading = $state<string | null>(null);
  let runningCommand = $state<string | null>(null);
  let marketplaceAction = $state<string | null>(null);
  let marketplaceReview = $state<MarketplaceReview | null>(null);
  let marketplaceQuery = $state('');
  let marketplaceFilter = $state<MarketplaceFilter>('all');

  const configurable = $derived(
    configs.filter((config) => (config.schema?.fields.length ?? 0) > 0),
  );
  const marketplaceEntries = $derived(
    marketplace.entries.filter((entry) => marketplaceEntryMatches(entry)),
  );
  const settingsExtensions = $derived(
    extensions.filter((extension) => extension.slot === 'settings'),
  );

  onMount(() => {
    void loadPluginState();
    const runtimeRefresh = window.setInterval(() => {
      if (tab === 'plugins' && !loading) {
        void refreshRuntimeHealth();
      }
    }, 5000);
    return () => window.clearInterval(runtimeRefresh);
  });

  async function refreshRuntimeHealth() {
    try {
      const [pluginData, healthData] = await Promise.all([
        getJson<PluginRuntimeInfo[]>('/api/plugins'),
        getJson<PluginRuntimeHealth[]>('/api/plugins/health'),
      ]);
      plugins = pluginData;
      runtimeHealth = healthData;
    } catch {
      // The full refresh path surfaces connectivity failures to the user.
    }
  }

  async function loadPluginState() {
    loading = true;
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
      plugins = pluginData;
      runtimeHealth = healthData;
      errors = errorData;
      warnings = warningData;
      extensions = extensionData;
      commands = commandData;
      events = eventData;
      reviews = reviewData;
      marketplace = marketplaceData;
      compatibility = compatibilityData;
      configs = configData;
      secrets = secretData;
      drafts = Object.fromEntries(
        configData.map((config) => [config.pluginId, { ...config.values }]),
      );
      secretDrafts = Object.fromEntries(secretData.map((secret) => [secret.pluginId, {}]));
      commandDrafts = Object.fromEntries(
        commandData.map((command) => [
          commandKey(command),
          {
            ...commandInputDefaults(command),
            ...(commandDrafts[commandKey(command)] ?? {}),
          },
        ]),
      );
    } catch {
      addToast('Failed to load plugins', 'error');
    } finally {
      loading = false;
    }
  }

  function draftValue(pluginId: string, key: string): PluginConfigValue | undefined {
    return drafts[pluginId]?.[key];
  }

  function setDraftValue(pluginId: string, key: string, value: PluginConfigValue) {
    drafts = {
      ...drafts,
      [pluginId]: {
        ...(drafts[pluginId] ?? {}),
        [key]: value,
      },
    };
  }

  function inputValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement).value;
  }

  function checkedValue(event: Event): boolean {
    return (event.currentTarget as HTMLInputElement).checked;
  }

  function fieldValue(pluginId: string, field: PluginConfigField): PluginConfigValue {
    const value = draftValue(pluginId, field.key);
    if (value !== undefined) {
      return value;
    }
    if (field.default !== undefined) {
      return field.default;
    }
    if (field.type === 'boolean') {
      return false;
    }
    if (field.type === 'number') {
      return 0;
    }
    return '';
  }

  function defaultFieldValue(field: PluginConfigField): PluginConfigValue {
    if (field.default !== undefined) {
      return field.default;
    }
    if (field.type === 'boolean') {
      return false;
    }
    if (field.type === 'number') {
      return 0;
    }
    return '';
  }

  function commandKey(command: PluginCommand): string {
    return `${command.pluginId}:${command.id}`;
  }

  function commandInputDefaults(command: PluginCommand): Record<string, PluginConfigValue> {
    return Object.fromEntries(
      (command.input?.fields ?? []).map((field) => [field.key, defaultFieldValue(field)]),
    );
  }

  function commandFieldValue(command: PluginCommand, field: PluginConfigField): PluginConfigValue {
    return commandDrafts[commandKey(command)]?.[field.key] ?? defaultFieldValue(field);
  }

  function setCommandInputValue(command: PluginCommand, key: string, value: PluginConfigValue) {
    const id = commandKey(command);
    commandDrafts = {
      ...commandDrafts,
      [id]: {
        ...(commandDrafts[id] ?? {}),
        [key]: value,
      },
    };
  }

  function commandInputPayload(command: PluginCommand): Record<string, PluginConfigValue> {
    const payload: Record<string, PluginConfigValue> = {};
    for (const field of command.input?.fields ?? []) {
      payload[field.key] = commandFieldValue(command, field);
    }
    return payload;
  }

  async function saveConfig(pluginId: string) {
    const snapshot = configs.find((config) => config.pluginId === pluginId);
    if (!snapshot?.schema || saving) {
      return;
    }
    saving = pluginId;
    const payload: Record<string, PluginConfigValue> = {};
    for (const field of snapshot.schema.fields) {
      payload[field.key] = fieldValue(pluginId, field);
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
      configs = configs.map((config) => (config.pluginId === pluginId ? updated : config));
      drafts = { ...drafts, [pluginId]: { ...updated.values } };
      addToast(`${pluginId}: config saved`, 'success');
    } catch {
      addToast(`${pluginId}: config save failed`, 'error');
    } finally {
      saving = null;
    }
  }

  async function togglePlugin(plugin: PluginRuntimeInfo) {
    if (plugin.manifest.builtin || toggling) {
      return;
    }
    toggling = plugin.manifest.id;
    const action = plugin.enabled ? 'disable' : 'enable';
    try {
      const updated = await requestJson<PluginRuntimeInfo>(
        `/api/plugins/${encodeURIComponent(plugin.manifest.id)}/${action}`,
        { method: 'POST' },
      );
      plugins = plugins.map((item) => (item.manifest.id === updated.manifest.id ? updated : item));
      clearPluginFrontendCache(plugin.manifest.id);
      await loadPluginState();
      addToast(`${plugin.manifest.name}: ${action}d`, 'success');
    } catch {
      addToast(`${plugin.manifest.name}: ${action} failed`, 'error');
    } finally {
      toggling = null;
    }
  }

  async function reloadPlugin(plugin: PluginRuntimeInfo) {
    if (plugin.manifest.builtin || reloading) {
      return;
    }
    reloading = plugin.manifest.id;
    try {
      const updated = await requestJson<PluginRuntimeInfo>(
        `/api/plugins/${encodeURIComponent(plugin.manifest.id)}/reload`,
        { method: 'POST' },
      );
      plugins = plugins.map((item) => (item.manifest.id === updated.manifest.id ? updated : item));
      clearPluginFrontendCache(plugin.manifest.id);
      await loadPluginState();
      addToast(`${plugin.manifest.name}: reloaded`, 'success');
    } catch {
      addToast(`${plugin.manifest.name}: reload failed`, 'error');
    } finally {
      reloading = null;
    }
  }

  async function runExtensionAction(extension: PluginUiExtension, input?: unknown) {
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

  function extensionContentPreview(extension: PluginUiExtension): string {
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

  async function runCommand(command: PluginCommand) {
    const key = commandKey(command);
    if (runningCommand) {
      return;
    }
    runningCommand = key;
    try {
      const hasInput = (command.input?.fields.length ?? 0) > 0;
      const result = await requestJson<PluginCommandResult>(
        `/api/plugins/${encodeURIComponent(command.pluginId)}/commands/${encodeURIComponent(command.id)}`,
        hasInput
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ input: commandInputPayload(command) }),
            }
          : { method: 'POST' },
      );
      await loadPluginState();
      addToast(
        result.message || `${command.title}: ${result.ok ? 'done' : 'failed'}`,
        result.ok ? 'success' : 'error',
      );
    } catch {
      addToast(`${command.title}: command failed`, 'error');
    } finally {
      runningCommand = null;
    }
  }

  async function runMigration(pluginId: string, from: string, to: string) {
    const key = `${pluginId}:${from}:${to}`;
    if (runningCommand) {
      return;
    }
    runningCommand = key;
    try {
      const result = await requestJson<PluginCommandResult>(
        `/api/plugins/${encodeURIComponent(pluginId)}/migrate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to }),
        },
      );
      await loadPluginState();
      addToast(
        result.message || `${pluginId}: migration ${from} -> ${to} complete`,
        result.ok ? 'success' : 'error',
      );
    } catch {
      addToast(`${pluginId}: migration failed`, 'error');
    } finally {
      runningCommand = null;
    }
  }

  async function approvePlugin(pluginId: string) {
    if (saving) {
      return;
    }
    saving = `${pluginId}:approval`;
    try {
      await requestJson(`/api/plugins/${encodeURIComponent(pluginId)}/approve`, { method: 'POST' });
      await loadPluginState();
      addToast(`${pluginId}: approved`, 'success');
    } catch {
      addToast(`${pluginId}: approval failed`, 'error');
    } finally {
      saving = null;
    }
  }

  async function revokeApproval(pluginId: string) {
    if (saving) {
      return;
    }
    saving = `${pluginId}:approval`;
    try {
      await requestJson(`/api/plugins/${encodeURIComponent(pluginId)}/revoke-approval`, {
        method: 'POST',
      });
      await loadPluginState();
      addToast(`${pluginId}: approval revoked`, 'success');
    } catch {
      addToast(`${pluginId}: revoke failed`, 'error');
    } finally {
      saving = null;
    }
  }

  async function runMarketplaceAction(entry: PluginMarketplaceEntry, action: MarketplaceAction) {
    const key = `${entry.id}:${action}`;
    if (marketplaceAction) {
      return;
    }
    marketplaceAction = key;
    try {
      const encodedId = encodeURIComponent(entry.id);
      if (action === 'uninstall') {
        marketplace = await deleteJson<PluginMarketplaceSnapshot>(
          `/api/plugins/marketplace/${encodedId}`,
        );
      } else {
        marketplace = await requestJson<PluginMarketplaceSnapshot>(
          `/api/plugins/marketplace/${encodedId}/${action}`,
          { method: 'POST' },
        );
      }
      clearPluginFrontendCache(entry.id);
      await loadPluginState();
      addToast(`${entry.name}: ${action} complete`, 'success');
    } catch (error) {
      const detail = apiErrorMessage(error);
      addToast(`${entry.name}: ${action} failed${detail ? `: ${detail}` : ''}`, 'error');
    } finally {
      marketplaceAction = null;
    }
  }

  function requestMarketplaceAction(entry: PluginMarketplaceEntry) {
    const action = marketplaceActionType(entry);
    marketplaceReview = { entry, action };
  }

  async function confirmMarketplaceReview() {
    if (!marketplaceReview) {
      return;
    }
    const review = marketplaceReview;
    marketplaceReview = null;
    await runMarketplaceAction(review.entry, review.action);
  }

  function eventPayload(event: PluginEvent): string {
    try {
      return JSON.stringify(event.payload, null, 2);
    } catch {
      return String(event.payload);
    }
  }

  function setSecretDraft(pluginId: string, key: string, value: string) {
    secretDrafts = {
      ...secretDrafts,
      [pluginId]: {
        ...(secretDrafts[pluginId] ?? {}),
        [key]: value,
      },
    };
  }

  async function saveSecret(pluginId: string, key: string) {
    const value = secretDrafts[pluginId]?.[key];
    if (value === undefined || saving) {
      return;
    }
    saving = `${pluginId}:${key}`;
    try {
      const updated = await requestJson<PluginSecretSnapshot>(
        `/api/plugins/${encodeURIComponent(pluginId)}/secrets/${encodeURIComponent(key)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        },
      );
      secrets = secrets.map((secret) => (secret.pluginId === pluginId ? updated : secret));
      setSecretDraft(pluginId, key, '');
      addToast(`${pluginId}: secret saved`, 'success');
    } catch {
      addToast(`${pluginId}: secret save failed`, 'error');
    } finally {
      saving = null;
    }
  }

  function statusClass(status: PluginRuntimeInfo['status']): string {
    return status === 'started'
      ? 'ok'
      : status === 'failed' || status === 'quarantined'
        ? 'bad'
        : 'idle';
  }

  function healthFor(pluginId: string): PluginRuntimeHealth | undefined {
    return runtimeHealth.find((health) => health.pluginId === pluginId);
  }

  function formatBytes(value: number): string {
    if (value < 1024 * 1024) {
      return `${Math.round(value / 1024)} KiB`;
    }
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  }

  function listText(values: readonly string[]): string {
    return values.length > 0 ? values.join(', ') : 'none';
  }

  function shortFingerprint(value: string): string {
    return value.slice(0, 12);
  }

  function marketplaceLabel(entry: PluginMarketplaceEntry): string {
    if (entry.state === 'update_available') {
      return 'update';
    }
    if (entry.state === 'local') {
      return 'local';
    }
    return entry.state;
  }

  function marketplaceActionLabel(entry: PluginMarketplaceEntry): string {
    if (entry.state === 'available') {
      return 'Install';
    }
    if (entry.state === 'update_available') {
      return 'Update';
    }
    return 'Uninstall';
  }

  function marketplaceActionType(entry: PluginMarketplaceEntry): MarketplaceAction {
    if (entry.state === 'available') {
      return 'install';
    }
    if (entry.state === 'update_available') {
      return 'update';
    }
    return 'uninstall';
  }

  function marketplaceActionKey(entry: PluginMarketplaceEntry): string {
    return `${entry.id}:${marketplaceActionType(entry)}`;
  }

  function marketplaceActionDisabled(entry: PluginMarketplaceEntry): boolean {
    const action = marketplaceActionType(entry);
    return (
      marketplaceAction !== null ||
      entry.status === 'yanked' ||
      (action !== 'uninstall' && entry.compatibilityWarnings.length > 0)
    );
  }

  function marketplaceTrust(entry: PluginMarketplaceEntry): string {
    if (entry.signature) {
      return entry.signature.keyId
        ? `${entry.signature.algorithm}:${entry.signature.keyId}`
        : entry.signature.algorithm;
    }
    return entry.installed?.signatureAlgorithm ?? 'unsigned';
  }

  function marketplaceEntryMatches(entry: PluginMarketplaceEntry): boolean {
    const query = marketplaceQuery.trim().toLowerCase();
    const matchesQuery =
      !query ||
      [
        entry.id,
        entry.name,
        entry.description,
        entry.category,
        entry.author,
        entry.readme,
        ...(entry.tags ?? []),
        ...entry.capabilities,
        ...entry.permissions,
      ]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLowerCase().includes(query));
    if (!matchesQuery) {
      return false;
    }
    if (marketplaceFilter === 'available') {
      return entry.state === 'available';
    }
    if (marketplaceFilter === 'installed') {
      return entry.state === 'installed';
    }
    if (marketplaceFilter === 'updates') {
      return entry.state === 'update_available';
    }
    if (marketplaceFilter === 'local') {
      return entry.state === 'local';
    }
    if (marketplaceFilter === 'deprecated') {
      return entry.status === 'deprecated' || entry.status === 'yanked';
    }
    return true;
  }

  function formatDate(value: string | undefined): string {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
  }

  function marketplaceVersionLine(entry: PluginMarketplaceEntry): string {
    if (!entry.installed) {
      return `new install v${entry.version}`;
    }
    if (entry.installed.version === entry.version) {
      return `installed v${entry.installed.version}`;
    }
    return `installed v${entry.installed.version} -> catalog v${entry.version}`;
  }

  function marketplaceCompatibility(entry: PluginMarketplaceEntry): string {
    const parts = [];
    if (entry.compatibility?.minDockscopeVersion) {
      parts.push(`min ${entry.compatibility.minDockscopeVersion}`);
    }
    if (entry.compatibility?.maxDockscopeVersion) {
      parts.push(`max ${entry.compatibility.maxDockscopeVersion}`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'not declared';
  }

  function catalogTrustText(): string {
    if (marketplace.catalogSignatureVerified === true) {
      return 'catalog signed';
    }
    if (marketplace.catalogSignatureVerified === false) {
      return 'catalog signature unverified';
    }
    return 'catalog unsigned';
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="header">
      <div class="tabs">
        <button class="tab" class:active={tab === 'plugins'} onclick={() => (tab = 'plugins')}>
          Plugins
        </button>
        <button
          class="tab"
          class:active={tab === 'extensions'}
          onclick={() => (tab = 'extensions')}
        >
          Extensions
        </button>
        <button class="tab" class:active={tab === 'commands'} onclick={() => (tab = 'commands')}>
          Commands
        </button>
        <button class="tab" class:active={tab === 'events'} onclick={() => (tab = 'events')}>
          Events
        </button>
        <button class="tab" class:active={tab === 'review'} onclick={() => (tab = 'review')}>
          Review
        </button>
        <button
          class="tab"
          class:active={tab === 'marketplace'}
          onclick={() => (tab = 'marketplace')}
        >
          Marketplace
        </button>
        <button
          class="tab"
          class:active={tab === 'compatibility'}
          onclick={() => (tab = 'compatibility')}
        >
          Compatibility
        </button>
        <button class="tab" class:active={tab === 'config'} onclick={() => (tab = 'config')}>
          Config
        </button>
        <button class="tab" class:active={tab === 'secrets'} onclick={() => (tab = 'secrets')}>
          Secrets
        </button>
      </div>
      <button class="close-btn" onclick={onClose}>&times;</button>
    </div>

    <div class="content">
      {#if loading}
        <div class="empty-msg">Loading plugins...</div>
      {:else if tab === 'plugins'}
        <div class="summary-row">
          <span>{plugins.length} registered</span>
          {#if errors.length > 0}
            <span class="error-count">{errors.length} load errors</span>
          {/if}
          {#if warnings.length > 0}
            <span class="warning-count">{warnings.length} warnings</span>
          {/if}
        </div>

        <div class="list">
          {#each plugins as plugin}
            {@const health = healthFor(plugin.manifest.id)}
            <div class="item">
              <span class="status-dot {statusClass(plugin.status)}"></span>
              <div class="item-main">
                <div class="item-title">
                  <span>{plugin.manifest.name}</span>
                  <code>{plugin.manifest.id}</code>
                </div>
                <div class="item-meta">
                  v{plugin.manifest.version}
                  <span>api {plugin.manifest.dockscopeApiVersion}</span>
                  {#if plugin.manifest.builtin}
                    <span>built-in</span>
                  {/if}
                  <span>{plugin.status}</span>
                  {#if plugin.manifest.execution?.isolation}
                    <span>{plugin.manifest.execution.isolation}</span>
                  {/if}
                  {#if health?.pid}<span>pid {health.pid}</span>{/if}
                  {#if health?.metrics}<span>rss {formatBytes(health.metrics.rssBytes)}</span>{/if}
                  {#if health?.metrics}<span>cpu {health.metrics.cpuPercent.toFixed(1)}%</span>{/if}
                  {#if health && health.crashCount > 0}
                    <span>{health.crashCount} crashes</span>
                  {/if}
                </div>
                {#if plugin.quarantineReason}
                  <div class="warning-line">Quarantined: {plugin.quarantineReason}</div>
                {/if}
                {#if plugin.error}
                  <div class="error-line">{plugin.error}</div>
                {/if}
              </div>
              {#if !plugin.manifest.builtin}
                <div class="action-stack">
                  <button
                    class="save-btn"
                    disabled={reloading !== null}
                    onclick={() => reloadPlugin(plugin)}
                  >
                    {reloading === plugin.manifest.id ? 'Reloading...' : 'Reload'}
                  </button>
                  <button
                    class="save-btn"
                    disabled={toggling !== null}
                    onclick={() => togglePlugin(plugin)}
                  >
                    {plugin.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              {/if}
            </div>
          {/each}
        </div>

        {#if errors.length > 0}
          <div class="section-title">Load Errors</div>
          <div class="list">
            {#each errors as error}
              <div class="item error">
                <div class="item-main">
                  <div class="item-title">
                    <span>{error.id ?? 'unknown plugin'}</span>
                    <code>{error.phase}</code>
                  </div>
                  <div class="error-line">{error.message}</div>
                  {#if error.path}
                    <div class="path-line">{error.path}</div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
        {#if warnings.length > 0}
          <div class="section-title">Manifest Warnings</div>
          <div class="list">
            {#each warnings as warning}
              <div class="item warning">
                <div class="item-main">
                  <div class="item-title">
                    <span>{warning.id ?? 'unknown plugin'}</span>
                    <code>{warning.code}</code>
                  </div>
                  <div class="warning-line">{warning.message}</div>
                  {#if warning.path}
                    <div class="path-line">{warning.path}</div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else if tab === 'extensions'}
        {#if extensions.length === 0}
          <div class="empty-msg">No UI extensions registered.</div>
        {:else}
          <div class="list">
            {#each extensions as extension}
              <div class="item">
                <div class="slot-badge">{extension.slot}</div>
                <div class="item-main">
                  <div class="item-title">
                    <span>{extension.title}</span>
                    <code>{extension.pluginId}:{extension.id}</code>
                  </div>
                  {#if extension.description}
                    <div class="item-desc">{extension.description}</div>
                  {/if}
                  {#if extension.content}
                    <pre class="content-preview">{extensionContentPreview(extension)}</pre>
                  {/if}
                  <div class="item-meta">
                    {#if extension.frontendView}
                      <span>frontend {extension.frontendView}</span>
                    {/if}
                    {#if extension.context?.runtimes?.length}
                      <span>runtime {extension.context.runtimes.join(', ')}</span>
                    {/if}
                    {#if extension.context?.kinds?.length}
                      <span>kind {extension.context.kinds.join(', ')}</span>
                    {/if}
                  </div>
                  {#if extension.action}
                    <div class="item-desc">
                      action {extension.action.type}
                      {#if extension.action.type === 'run_command'}
                        · {extension.action.pluginId ?? extension.pluginId}:{extension.action
                          .commandId}
                      {/if}
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else if tab === 'commands'}
        {#if commands.length === 0}
          <div class="empty-msg">No plugin commands registered.</div>
        {:else}
          <div class="list">
            {#each commands as command}
              <div class="item">
                <div class="slot-badge">command</div>
                <div class="item-main">
                  <div class="item-title">
                    <span>{command.title}</span>
                    <code>{command.pluginId}:{command.id}</code>
                  </div>
                  {#if command.description}
                    <div class="item-desc">{command.description}</div>
                  {/if}
                  {#if command.input?.fields.length}
                    <div class="command-inputs">
                      {#each command.input.fields as field}
                        <label class="field command-field">
                          <span class="field-label">{field.label}</span>
                          {#if field.type === 'boolean'}
                            <input
                              type="checkbox"
                              checked={Boolean(commandFieldValue(command, field))}
                              onchange={(event) =>
                                setCommandInputValue(command, field.key, checkedValue(event))}
                            />
                          {:else if field.type === 'select'}
                            <select
                              value={String(commandFieldValue(command, field))}
                              onchange={(event) =>
                                setCommandInputValue(command, field.key, inputValue(event))}
                            >
                              {#each field.options ?? [] as option}
                                <option value={option.value}>{option.label}</option>
                              {/each}
                            </select>
                          {:else}
                            <input
                              type={field.type === 'number' ? 'number' : 'text'}
                              value={String(commandFieldValue(command, field))}
                              oninput={(event) =>
                                setCommandInputValue(
                                  command,
                                  field.key,
                                  field.type === 'number'
                                    ? Number(inputValue(event))
                                    : inputValue(event),
                                )}
                            />
                          {/if}
                          {#if field.description}
                            <span class="field-desc">{field.description}</span>
                          {/if}
                        </label>
                      {/each}
                    </div>
                  {/if}
                </div>
                <button
                  class="save-btn"
                  disabled={runningCommand !== null}
                  onclick={() => runCommand(command)}
                >
                  {runningCommand === commandKey(command) ? 'Running...' : 'Run'}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      {:else if tab === 'events'}
        {#if events.length === 0}
          <div class="empty-msg">No plugin events recorded.</div>
        {:else}
          <div class="list">
            {#each events as event}
              <div class="item">
                <div class="slot-badge">event</div>
                <div class="item-main">
                  <div class="item-title">
                    <span>{event.type}</span>
                    <code>{event.pluginId}</code>
                  </div>
                  <div class="item-desc">{new Date(event.time).toLocaleString()}</div>
                  <pre class="content-preview">{eventPayload(event)}</pre>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else if tab === 'review'}
        {#if reviews.length === 0}
          <div class="empty-msg">No external plugins to review.</div>
        {:else}
          <div class="list">
            {#each reviews as review}
              <div class="item">
                <div class="slot-badge risk-{review.riskLevel}">{review.riskLevel}</div>
                <div class="item-main">
                  <div class="item-title">
                    <span>{review.name}</span>
                    <code>{review.pluginId} v{review.version}</code>
                  </div>
                  <div class="item-meta">
                    <span>{review.enabled ? 'enabled' : 'disabled'}</span>
                    <span>{review.status}</span>
                    <span>{review.executionIsolation}</span>
                    <span>{review.approvalStatus}</span>
                  </div>
                  <div class="review-grid">
                    <div>
                      <span class="review-label">Capabilities</span>
                      <span>{listText(review.capabilities)}</span>
                    </div>
                    <div>
                      <span class="review-label">Permissions</span>
                      <span>{listText(review.permissions)}</span>
                    </div>
                    <div>
                      <span class="review-label">Commands</span>
                      <span>{listText(review.commands)}</span>
                    </div>
                    <div>
                      <span class="review-label">Secrets</span>
                      <span>{listText(review.secrets)}</span>
                    </div>
                    <div>
                      <span class="review-label">UI slots</span>
                      <span>{listText(review.uiSlots)}</span>
                    </div>
                    <div>
                      <span class="review-label">Frontend</span>
                      <span>{listText(review.frontendSlots)}</span>
                    </div>
                    <div>
                      <span class="review-label">Config</span>
                      <span>{listText(review.configFields)}</span>
                    </div>
                  </div>
                  {#each review.riskReasons as reason}
                    <div class={review.riskLevel === 'high' ? 'error-line' : 'item-desc'}>
                      {reason}
                    </div>
                  {/each}
                  {#each review.compatibilityWarnings as warning}
                    <div class="error-line">{warning}</div>
                  {/each}
                  <div class="approval-row">
                    <code>{shortFingerprint(review.fingerprint)}</code>
                    {#if review.approvedAt}
                      <span>approved {new Date(review.approvedAt).toLocaleString()}</span>
                    {/if}
                    {#if review.approvalStatus !== 'approved'}
                      <button
                        class="save-btn"
                        disabled={saving !== null}
                        onclick={() => approvePlugin(review.pluginId)}
                      >
                        {saving === `${review.pluginId}:approval` ? 'Saving...' : 'Approve'}
                      </button>
                    {:else}
                      <button
                        class="save-btn"
                        disabled={saving !== null}
                        onclick={() => revokeApproval(review.pluginId)}
                      >
                        {saving === `${review.pluginId}:approval` ? 'Saving...' : 'Revoke'}
                      </button>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else if tab === 'marketplace'}
        {#if marketplace.catalogError}
          <div class="marketplace-alert">
            <span>Catalog unavailable: {marketplace.catalogError}</span>
            <button
              class="marketplace-retry"
              title="Retry catalog"
              aria-label="Retry catalog"
              onclick={() => void loadPluginState()}
            >
              <Icon name="restart" size={13} />
            </button>
          </div>
        {/if}
        {#if !marketplace.configured && marketplace.entries.length === 0}
          <div class="empty-msg">No plugin marketplace configured.</div>
        {:else if marketplace.entries.length === 0}
          {#if !marketplace.catalogError}
            <div class="empty-msg">{marketplace.catalogName ?? 'Plugin marketplace'} is empty.</div>
          {/if}
        {:else}
          <div class="summary-row">
            <span>{marketplace.catalogName ?? 'Local plugins'}</span>
            <span
              >{catalogTrustText()} · {marketplaceEntries.length} / {marketplace.entries.length} entries</span
            >
          </div>
          <div class="path-line marketplace-registry">{marketplace.registryDir}</div>
          <div class="marketplace-controls">
            <input
              type="text"
              placeholder="Search marketplace"
              value={marketplaceQuery}
              oninput={(event) => (marketplaceQuery = inputValue(event))}
            />
            <select
              value={marketplaceFilter}
              onchange={(event) => (marketplaceFilter = inputValue(event) as MarketplaceFilter)}
            >
              <option value="all">All</option>
              <option value="available">Available</option>
              <option value="installed">Installed</option>
              <option value="updates">Updates</option>
              <option value="local">Local</option>
              <option value="deprecated">Deprecated</option>
            </select>
          </div>
          <div class="list">
            {#each marketplaceEntries as entry}
              <div class="item">
                <div class="slot-badge marketplace-{entry.state}">
                  {marketplaceLabel(entry)}
                </div>
                <div class="item-main">
                  <div class="marketplace-identity">
                    {#if entry.iconUrl}
                      <img class="marketplace-icon" src={entry.iconUrl} alt="" loading="lazy" />
                    {/if}
                    <div class="item-title">
                      <span>{entry.name}</span>
                      <code>{entry.id} v{entry.version}</code>
                    </div>
                  </div>
                  {#if entry.description}
                    <div class="item-desc">{entry.description}</div>
                  {/if}
                  <div class="item-meta">
                    <span>{marketplaceTrust(entry)}</span>
                    <span>{entry.capabilities.length} capabilities</span>
                    <span>{entry.permissions.length} permissions</span>
                    {#if entry.license}
                      <span>{entry.license}</span>
                    {/if}
                    {#if entry.status !== 'active'}
                      <span>{entry.status}</span>
                    {/if}
                    {#if entry.category}
                      <span>{entry.category}</span>
                    {/if}
                    <span>{entry.tags.length} tags</span>
                  </div>
                  {#if entry.installed}
                    <div class="item-desc">
                      installed v{entry.installed.version}
                      {#if entry.runtime}
                        · {entry.runtime.enabled ? 'enabled' : 'disabled'} {entry.runtime.status}
                      {/if}
                    </div>
                  {/if}
                  <div class="marketplace-facts">
                    <span>{marketplaceVersionLine(entry)}</span>
                    <span>compat {marketplaceCompatibility(entry)}</span>
                    {#if entry.publishedAt}
                      <span>published {formatDate(entry.publishedAt)}</span>
                    {/if}
                  </div>
                  {#if entry.releaseNotes}
                    <div class="item-desc">{entry.releaseNotes}</div>
                  {/if}
                  {#if entry.repositoryUrl || entry.readmeUrl}
                    <div class="marketplace-links">
                      {#if entry.repositoryUrl}
                        <a href={entry.repositoryUrl} target="_blank" rel="noreferrer">Repo</a>
                      {/if}
                      {#if entry.readmeUrl}
                        <a href={entry.readmeUrl} target="_blank" rel="noreferrer">README</a>
                      {/if}
                    </div>
                  {/if}
                  {#each entry.compatibilityWarnings as warning}
                    <div class="error-line">{warning}</div>
                  {/each}
                  <div class="item-desc">
                    {entry.resolvedPackageUrl ?? entry.installed?.path ?? 'local registry'}
                  </div>
                </div>
                <button
                  class="save-btn"
                  disabled={marketplaceActionDisabled(entry)}
                  onclick={() => requestMarketplaceAction(entry)}
                >
                  {marketplaceAction === marketplaceActionKey(entry)
                    ? 'Working...'
                    : marketplaceActionLabel(entry)}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      {:else if tab === 'compatibility'}
        <div class="list">
          {#each compatibility as report}
            <div class="item">
              <div class="slot-badge">api</div>
              <div class="item-main">
                <div class="item-title">
                  <span>{report.name}</span>
                  <code>{report.pluginId} v{report.version}</code>
                </div>
                <div class="item-meta">
                  {#if report.minDockscopeVersion}
                    <span>min {report.minDockscopeVersion}</span>
                  {/if}
                  {#if report.maxDockscopeVersion}
                    <span>max {report.maxDockscopeVersion}</span>
                  {/if}
                  <span>{report.migrations.length} migrations</span>
                </div>
                {#each report.warnings as warning}
                  <div class="error-line">{warning}</div>
                {/each}
                {#each report.deprecations as deprecation}
                  <div class="item-desc">{deprecation}</div>
                {/each}
                {#each report.migrations as migration}
                  <div class="migration-row">
                    <span>{migration.from} -> {migration.to}</span>
                    {#if migration.notes}
                      <span>{migration.notes}</span>
                    {/if}
                    {#if migration.commandId}
                      <button
                        class="save-btn"
                        disabled={runningCommand !== null}
                        onclick={() => runMigration(report.pluginId, migration.from, migration.to)}
                      >
                        {runningCommand === `${report.pluginId}:${migration.from}:${migration.to}`
                          ? 'Running...'
                          : 'Run'}
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {:else if tab === 'config' && configurable.length === 0 && settingsExtensions.length === 0}
        <div class="empty-msg">No configurable plugins.</div>
      {:else if tab === 'config'}
        <div class="config-list">
          {#each configurable as config}
            <div class="config-block">
              <div class="config-header">
                <span>{config.pluginId}</span>
                <button
                  class="save-btn"
                  disabled={saving !== null}
                  onclick={() => saveConfig(config.pluginId)}
                >
                  {saving === config.pluginId ? 'Saving...' : 'Save'}
                </button>
              </div>
              {#each config.schema?.fields ?? [] as field}
                <label class="field">
                  <span class="field-label">{field.label}</span>
                  {#if field.type === 'boolean'}
                    <input
                      type="checkbox"
                      checked={Boolean(fieldValue(config.pluginId, field))}
                      onchange={(event) =>
                        setDraftValue(config.pluginId, field.key, checkedValue(event))}
                    />
                  {:else if field.type === 'select'}
                    <select
                      value={String(fieldValue(config.pluginId, field))}
                      onchange={(event) =>
                        setDraftValue(config.pluginId, field.key, inputValue(event))}
                    >
                      {#each field.options ?? [] as option}
                        <option value={option.value}>{option.label}</option>
                      {/each}
                    </select>
                  {:else}
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={String(fieldValue(config.pluginId, field))}
                      oninput={(event) =>
                        setDraftValue(
                          config.pluginId,
                          field.key,
                          field.type === 'number' ? Number(inputValue(event)) : inputValue(event),
                        )}
                    />
                  {/if}
                  {#if field.description}
                    <span class="field-desc">{field.description}</span>
                  {/if}
                </label>
              {/each}
            </div>
          {/each}
          {#each settingsExtensions as extension (extension.pluginId + extension.id)}
            <PluginExtension {extension} context={{}} onAction={runExtensionAction} />
          {/each}
        </div>
      {:else if secrets.length === 0}
        <div class="empty-msg">No plugin secrets declared.</div>
      {:else}
        <div class="config-list">
          {#each secrets as pluginSecrets}
            <div class="config-block">
              <div class="config-header">
                <span>{pluginSecrets.pluginId}</span>
              </div>
              {#each pluginSecrets.secrets as secret}
                <label class="field">
                  <span class="field-label">{secret.label}</span>
                  <div class="secret-row">
                    <input
                      type="password"
                      placeholder={secret.configured ? 'Configured' : 'Not configured'}
                      value={secretDrafts[pluginSecrets.pluginId]?.[secret.key] ?? ''}
                      oninput={(event) =>
                        setSecretDraft(pluginSecrets.pluginId, secret.key, inputValue(event))}
                    />
                    <button
                      class="save-btn"
                      disabled={!secretDrafts[pluginSecrets.pluginId]?.[secret.key] ||
                        saving !== null}
                      onclick={() => saveSecret(pluginSecrets.pluginId, secret.key)}
                    >
                      {saving === `${pluginSecrets.pluginId}:${secret.key}` ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  <span class="field-desc">
                    {secret.configured ? 'Configured' : 'Missing'}
                    {#if secret.required}
                      · required
                    {/if}
                    {#if secret.description}
                      · {secret.description}
                    {/if}
                  </span>
                </label>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    {#if marketplaceReview}
      <div class="confirm-layer">
        <div class="confirm-box">
          <div class="confirm-header">
            <div>
              <div class="confirm-title">{marketplaceReview.entry.name}</div>
              <code>{marketplaceReview.entry.id} v{marketplaceReview.entry.version}</code>
            </div>
            <button class="close-btn" onclick={() => (marketplaceReview = null)}>&times;</button>
          </div>

          <div class="review-grid marketplace-review-grid">
            <div>
              <span class="review-label">Action</span>
              <span>{marketplaceReview.action}</span>
            </div>
            <div>
              <span class="review-label">Version</span>
              <span>{marketplaceVersionLine(marketplaceReview.entry)}</span>
            </div>
            <div>
              <span class="review-label">Signature</span>
              <span>{marketplaceTrust(marketplaceReview.entry)}</span>
            </div>
            <div>
              <span class="review-label">Package</span>
              <code>{shortFingerprint(marketplaceReview.entry.packageSha256 ?? 'unsigned')}</code>
            </div>
            <div>
              <span class="review-label">Capabilities</span>
              <span>{listText(marketplaceReview.entry.capabilities)}</span>
            </div>
            <div>
              <span class="review-label">Permissions</span>
              <span>{listText(marketplaceReview.entry.permissions)}</span>
            </div>
            <div>
              <span class="review-label">Compatibility</span>
              <span>{marketplaceCompatibility(marketplaceReview.entry)}</span>
            </div>
            <div>
              <span class="review-label">Registry</span>
              <code>{marketplace.registryDir}</code>
            </div>
          </div>

          {#if marketplaceReview.entry.releaseNotes}
            <div class="release-notes">{marketplaceReview.entry.releaseNotes}</div>
          {/if}

          {#if marketplaceReview.entry.screenshots.length > 0}
            <div class="screenshot-strip">
              {#each marketplaceReview.entry.screenshots as screenshot}
                <img
                  src={screenshot}
                  alt={`${marketplaceReview.entry.name} screenshot`}
                  loading="lazy"
                />
              {/each}
            </div>
          {/if}

          {#if marketplaceReview.entry.readme}
            <pre class="readme-preview">{marketplaceReview.entry.readme}</pre>
          {:else if marketplaceReview.entry.readmeUrl}
            <div class="marketplace-links review-links">
              <a href={marketplaceReview.entry.readmeUrl} target="_blank" rel="noreferrer">
                Open README
              </a>
            </div>
          {/if}

          <div class="confirm-actions">
            <button class="save-btn" onclick={() => (marketplaceReview = null)}>Cancel</button>
            <button
              class="save-btn primary"
              disabled={marketplaceActionDisabled(marketplaceReview.entry)}
              onclick={() => void confirmMarketplaceReview()}
            >
              {marketplaceAction === marketplaceActionKey(marketplaceReview.entry)
                ? 'Working...'
                : marketplaceActionLabel(marketplaceReview.entry)}
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(4, 4, 14, 0.64);
    backdrop-filter: blur(5px);
  }

  .panel {
    position: relative;
    width: min(760px, calc(100vw - 28px));
    max-height: min(760px, calc(100vh - 28px));
    display: flex;
    flex-direction: column;
    background: rgba(8, 10, 24, 0.96);
    border: 1px solid rgba(0, 228, 255, 0.12);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 20px 80px rgba(0, 0, 0, 0.35);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }

  .tab {
    padding: 8px 14px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: rgba(122, 133, 153, 0.78);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .tab.active {
    color: #00e4ff;
    border-bottom-color: #00e4ff;
  }

  .close-btn {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.35);
    cursor: pointer;
  }

  .close-btn:hover {
    color: #e2e8f0;
    border-color: rgba(0, 228, 255, 0.16);
  }

  .content {
    padding: 16px 18px 18px;
    overflow-y: auto;
  }

  .summary-row,
  .config-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    font-size: 11px;
    color: rgba(226, 232, 240, 0.68);
  }

  .error-count {
    color: #ff5f7a;
  }

  .warning-count,
  .warning-line {
    color: var(--accent-amber);
  }

  .marketplace-alert {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
    padding: 9px 10px;
    border: 1px solid rgba(255, 95, 122, 0.2);
    border-radius: 6px;
    background: rgba(255, 95, 122, 0.06);
    color: #ff7d92;
    font-size: 11px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .marketplace-retry {
    display: grid;
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
    place-items: center;
    padding: 0;
    border: 1px solid rgba(255, 125, 146, 0.28);
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.035);
    color: #ff9aab;
    cursor: pointer;
  }

  .marketplace-retry:hover {
    border-color: rgba(255, 125, 146, 0.5);
    background: rgba(255, 255, 255, 0.07);
  }

  .list,
  .config-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .item,
  .config-block {
    display: flex;
    gap: 10px;
    padding: 11px 12px;
    background: rgba(255, 255, 255, 0.026);
    border: 1px solid rgba(255, 255, 255, 0.045);
    border-radius: 8px;
  }

  .item.error {
    border-color: rgba(255, 95, 122, 0.18);
  }

  .item.warning {
    border-color: rgba(255, 138, 43, 0.2);
  }

  .item-main {
    min-width: 0;
    flex: 1;
  }

  .item > .save-btn {
    align-self: center;
    flex: 0 0 auto;
  }

  .action-stack {
    align-self: center;
    display: grid;
    gap: 6px;
    flex: 0 0 auto;
  }

  .item-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: #e2e8f0;
    font-size: 12px;
    font-weight: 600;
  }

  code,
  .path-line {
    font-family: var(--font-mono);
    font-size: 10px;
    color: rgba(122, 133, 153, 0.8);
  }

  .item-meta,
  .item-desc,
  .error-line,
  .field-desc {
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.45;
    color: rgba(122, 133, 153, 0.82);
  }

  .item-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .error-line {
    color: #ff6b84;
  }

  .section-title {
    margin: 18px 0 8px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: rgba(0, 228, 255, 0.7);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    margin-top: 4px;
    border-radius: 999px;
    flex: 0 0 auto;
  }

  .status-dot.ok {
    background: #00ff6a;
    box-shadow: 0 0 8px rgba(0, 255, 106, 0.45);
  }

  .status-dot.bad {
    background: #ff3d63;
  }

  .status-dot.idle {
    background: #ffb02e;
  }

  .slot-badge {
    align-self: flex-start;
    padding: 3px 6px;
    border-radius: 5px;
    background: rgba(255, 176, 46, 0.1);
    color: #ffb02e;
    font-size: 10px;
    font-weight: 700;
  }

  .slot-badge.risk-low {
    background: rgba(0, 255, 106, 0.08);
    color: #00ff6a;
  }

  .slot-badge.risk-medium {
    background: rgba(255, 176, 46, 0.1);
    color: #ffb02e;
  }

  .slot-badge.risk-high {
    background: rgba(255, 95, 122, 0.12);
    color: #ff5f7a;
  }

  .slot-badge.marketplace-available {
    background: rgba(0, 228, 255, 0.1);
    color: #00e4ff;
  }

  .slot-badge.marketplace-installed {
    background: rgba(0, 255, 106, 0.08);
    color: #00ff6a;
  }

  .slot-badge.marketplace-update_available {
    background: rgba(255, 176, 46, 0.1);
    color: #ffb02e;
  }

  .slot-badge.marketplace-local {
    background: rgba(172, 138, 255, 0.12);
    color: #bda5ff;
  }

  .marketplace-registry {
    margin: -4px 0 10px;
    overflow-wrap: anywhere;
  }

  .marketplace-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 150px;
    gap: 8px;
    margin-bottom: 10px;
  }

  .marketplace-identity {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    align-items: center;
  }

  .marketplace-icon {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    object-fit: cover;
    background: rgba(255, 255, 255, 0.05);
  }

  .marketplace-links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
    font-size: 11px;
  }

  .marketplace-links a {
    color: #00e4ff;
    text-decoration: none;
  }

  .marketplace-links a:hover {
    text-decoration: underline;
  }

  .marketplace-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
    font-size: 10px;
    color: rgba(226, 232, 240, 0.62);
  }

  .marketplace-facts span {
    padding: 3px 6px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.035);
  }

  .confirm-layer {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(5, 7, 17, 0.78);
    backdrop-filter: blur(4px);
  }

  .confirm-box {
    width: min(620px, 100%);
    max-height: 100%;
    overflow: auto;
    padding: 14px;
    background: rgba(10, 13, 29, 0.98);
    border: 1px solid rgba(0, 228, 255, 0.14);
    border-radius: 8px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
  }

  .confirm-header,
  .confirm-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .confirm-title {
    margin-bottom: 2px;
    color: #e2e8f0;
    font-size: 13px;
    font-weight: 700;
  }

  .marketplace-review-grid {
    margin-top: 14px;
  }

  .release-notes {
    margin-top: 12px;
    padding: 10px;
    border-left: 2px solid rgba(0, 228, 255, 0.34);
    background: rgba(0, 228, 255, 0.04);
    color: rgba(226, 232, 240, 0.76);
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .screenshot-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 8px;
    margin-top: 12px;
  }

  .screenshot-strip img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.03);
  }

  .readme-preview {
    max-height: 220px;
    overflow: auto;
    margin: 12px 0 0;
    padding: 10px;
    white-space: pre-wrap;
    border: 1px solid rgba(255, 255, 255, 0.055);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.2);
    color: rgba(226, 232, 240, 0.72);
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1.55;
  }

  .review-links {
    margin-top: 12px;
  }

  .confirm-actions {
    margin-top: 14px;
    justify-content: flex-end;
  }

  .save-btn.primary {
    background: rgba(0, 228, 255, 0.14);
    border-color: rgba(0, 228, 255, 0.32);
    color: #e2fbff;
  }

  .review-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
    margin-top: 10px;
    font-size: 11px;
    line-height: 1.4;
    color: rgba(226, 232, 240, 0.66);
  }

  .review-grid > div {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .review-label {
    display: block;
    margin-bottom: 2px;
    color: rgba(0, 228, 255, 0.68);
    font-weight: 700;
  }

  .migration-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
    font-size: 11px;
    color: rgba(226, 232, 240, 0.7);
  }

  .approval-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    margin-top: 10px;
    font-size: 11px;
    color: rgba(226, 232, 240, 0.7);
  }

  .content-preview {
    margin: 8px 0 0;
    white-space: pre-wrap;
    font-family: var(--font-mono);
    font-size: 10px;
    color: rgba(226, 232, 240, 0.66);
  }

  .command-inputs {
    display: grid;
    gap: 4px;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  .command-field {
    grid-template-columns: minmax(100px, 150px) minmax(0, 1fr);
    padding: 4px 0;
  }

  .config-block {
    display: block;
  }

  .config-header {
    color: #e2e8f0;
    font-family: var(--font-mono);
  }

  .field {
    display: grid;
    grid-template-columns: minmax(120px, 180px) 1fr;
    gap: 8px 12px;
    align-items: center;
    padding: 8px 0;
  }

  .field + .field {
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  .field-label {
    font-size: 11px;
    color: rgba(226, 232, 240, 0.78);
  }

  .field-desc {
    grid-column: 2;
    margin-top: -3px;
  }

  input[type='text'],
  input[type='number'],
  input[type='password'],
  select {
    min-width: 0;
    width: 100%;
    background: rgba(0, 0, 0, 0.26);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 6px;
    padding: 8px 9px;
    color: #e2e8f0;
    font-size: 12px;
  }

  input[type='checkbox'] {
    width: 16px;
    height: 16px;
  }

  .save-btn {
    padding: 6px 10px;
    background: rgba(0, 228, 255, 0.08);
    border: 1px solid rgba(0, 228, 255, 0.18);
    border-radius: 6px;
    color: #00e4ff;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }

  .save-btn:disabled {
    opacity: 0.4;
    cursor: wait;
  }

  .secret-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }

  .empty-msg {
    padding: 30px 10px;
    text-align: center;
    font-size: 12px;
    color: rgba(122, 133, 153, 0.82);
  }

  @media (max-width: 640px) {
    .field {
      grid-template-columns: 1fr;
    }

    .field-desc {
      grid-column: 1;
    }

    .review-grid {
      grid-template-columns: 1fr;
    }

    .migration-row,
    .approval-row {
      grid-template-columns: 1fr;
    }

    .marketplace-controls {
      grid-template-columns: 1fr;
    }
  }
</style>
