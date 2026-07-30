<script lang="ts">
  import { onMount } from 'svelte';
  import { apiErrorMessage, deleteJson, getJson, postJson, requestJson } from '../lib/api';
  import { addToast } from '../stores/toast.svelte';
  import type {
    PluginConfigSnapshot,
    PluginLoadError,
    PluginLoadWarning,
    PluginReviewReport,
    PluginRuntimeInfo,
  } from '../../core/plugin-contract/manifest';
  import type { PluginRuntimeHealth } from '../../core/plugin-contract/runtime';
  import type { PluginConfigField, PluginConfigValue } from '../../core/plugin-contract/config';
  import type { PluginSecretSnapshot } from '../../core/plugin-contract/secrets';
  import type { PluginUiExtension } from '../../core/plugin-contract/ui';
  import type { PluginCommand, PluginCommandResult } from '../../core/plugin-contract/commands';
  import type { PluginEvent } from '../../core/plugin-contract/events';
  import type { PluginCompatibilityReport } from '../../core/plugin-contract/compatibility';
  import PluginExtension from './PluginExtension.svelte';
  import { clearPluginFrontendCache, invokePluginUiAction } from '../lib/pluginUi';
  import type {
    PluginMarketplaceEntry,
    PluginMarketplaceSnapshot,
  } from '../../plugins/marketplace';
  import Icon from './Icon.svelte';
  import { Button, Chip, CloseButton, IconButton, Select, Tab, TabBar, TextInput } from './ui';

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

  // Three destinations, not nine. Everything that is a property *of a plugin*
  // (config, secrets, commands, extensions, review, compatibility) lives in that
  // plugin's expandable detail on the Installed tab instead of in its own global
  // tab, which is why seven of the old tabs read "No X" on a fresh install.
  let tab = $state<'installed' | 'marketplace' | 'events'>('installed');
  /** Plugin id whose detail is expanded, or null. One at a time. */
  let expanded = $state<string | null>(null);
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
    catalogs: [],
    entries: [],
  });
  // Add-catalog flow: the user enters a source, previews it, then trusts the
  // key fingerprint the publisher advertises (trust on first use).
  interface CatalogPreview {
    source: string;
    name?: string;
    entryCount: number;
    keyId?: string;
    fingerprint?: string;
    signed: boolean;
    signatureVerified: boolean;
    keySource?: string;
    problem?: string;
  }
  let showAddCatalog = $state(false);
  let catalogSourceDraft = $state('');
  let catalogPreview = $state<CatalogPreview | null>(null);
  let catalogBusy = $state(false);

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

  const marketplaceEntries = $derived(
    marketplace.entries.filter((entry) => marketplaceEntryMatches(entry)),
  );

  onMount(() => {
    void loadPluginState();
    const runtimeRefresh = window.setInterval(() => {
      if (tab === 'installed' && !loading) {
        void refreshRuntimeHealth();
      }
    }, 5000);
    return () => window.clearInterval(runtimeRefresh);
  });

  // ---- per-plugin facet lookups ----
  // Each of these used to back a whole tab. They are attributes of one plugin,
  // so they are resolved per row and omitted entirely when empty.

  function reviewFor(pluginId: string): PluginReviewReport | undefined {
    return reviews.find((review) => review.pluginId === pluginId);
  }

  function compatibilityFor(pluginId: string): PluginCompatibilityReport | undefined {
    const report = compatibility.find((entry) => entry.pluginId === pluginId);
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

  /** Only returns a snapshot that actually declares fields, so the Save button
      always has something to save. The old Config tab rendered a Save button per
      plugin even when the schema was empty. */
  function configFor(pluginId: string): PluginConfigSnapshot | undefined {
    return configs.find(
      (config) => config.pluginId === pluginId && (config.schema?.fields.length ?? 0) > 0,
    );
  }

  function secretsFor(pluginId: string): PluginSecretSnapshot | undefined {
    return secrets.find(
      (snapshot) => snapshot.pluginId === pluginId && snapshot.secrets.length > 0,
    );
  }

  function commandsFor(pluginId: string): PluginCommand[] {
    return commands.filter((command) => command.pluginId === pluginId);
  }

  function extensionsFor(pluginId: string): PluginUiExtension[] {
    return extensions.filter((extension) => extension.pluginId === pluginId);
  }

  function settingsExtensionsFor(pluginId: string): PluginUiExtension[] {
    return extensions.filter(
      (extension) => extension.pluginId === pluginId && extension.slot === 'settings',
    );
  }

  /** Whether a plugin has anything worth expanding, so rows without detail do
      not get a disclosure control that opens an empty box. */
  function hasDetail(pluginId: string): boolean {
    return (
      Boolean(reviewFor(pluginId)) ||
      Boolean(compatibilityFor(pluginId)) ||
      Boolean(configFor(pluginId)) ||
      Boolean(secretsFor(pluginId)) ||
      commandsFor(pluginId).length > 0 ||
      extensionsFor(pluginId).length > 0
    );
  }

  /** Compact hint of what expanding will reveal. */
  function detailSummary(pluginId: string): string {
    const parts: string[] = [];
    const commandCount = commandsFor(pluginId).length;
    const extensionCount = extensionsFor(pluginId).length;
    const secretSnapshot = secretsFor(pluginId);
    if (configFor(pluginId)) {
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

  function toggleExpanded(pluginId: string) {
    expanded = expanded === pluginId ? null : pluginId;
  }

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

  function riskTone(level: string): 'success' | 'warn' | 'danger' {
    if (level === 'low') {
      return 'success';
    }
    return level === 'high' ? 'danger' : 'warn';
  }

  function marketplaceStateTone(
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
    const loaded = (marketplace.catalogs ?? []).filter((catalog) => !catalog.error);
    if (loaded.length > 1) {
      const signed = loaded.filter((catalog) => catalog.signatureVerified === true).length;
      return `${signed} / ${loaded.length} catalogs signed`;
    }
    if (marketplace.catalogSignatureVerified === true) {
      return 'catalog signed';
    }
    if (marketplace.catalogSignatureVerified === false) {
      return 'catalog signature unverified';
    }
    return 'catalog unsigned';
  }

  function failedCatalogs() {
    return (marketplace.catalogs ?? []).filter((catalog) => catalog.error);
  }

  function pluralize(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function alreadyConfigured(source: string): boolean {
    return (marketplace.catalogs ?? []).some((catalog) => catalog.source === source.trim());
  }

  function resetAddCatalog() {
    showAddCatalog = false;
    catalogSourceDraft = '';
    catalogPreview = null;
  }

  async function previewCatalog() {
    if (!catalogSourceDraft.trim()) {
      return;
    }
    catalogBusy = true;
    catalogPreview = null;
    try {
      catalogPreview = await postJson<CatalogPreview>('/api/plugins/catalogs/preview', {
        source: catalogSourceDraft,
      });
    } catch (error) {
      addToast(apiErrorMessage(error), 'error');
    } finally {
      catalogBusy = false;
    }
  }

  async function trustCatalog() {
    if (!catalogPreview?.signatureVerified) {
      return;
    }
    catalogBusy = true;
    try {
      marketplace = await postJson<PluginMarketplaceSnapshot>('/api/plugins/catalogs', {
        source: catalogPreview.source,
      });
      addToast(`Added catalog ${catalogPreview.name ?? catalogPreview.source}`, 'success');
      resetAddCatalog();
    } catch (error) {
      addToast(apiErrorMessage(error), 'error');
    } finally {
      catalogBusy = false;
    }
  }

  async function removeCatalog(source: string, name?: string) {
    catalogBusy = true;
    try {
      marketplace = await deleteJson<PluginMarketplaceSnapshot>(
        `/api/plugins/catalogs?source=${encodeURIComponent(source)}`,
      );
      addToast(`Removed catalog ${name ?? source}`, 'success');
    } catch (error) {
      addToast(apiErrorMessage(error), 'error');
    } finally {
      catalogBusy = false;
    }
  }

  function catalogSummaryText(): string {
    const loaded = (marketplace.catalogs ?? []).filter((catalog) => !catalog.error);
    if (loaded.length > 1) {
      return `${loaded.length} catalogs`;
    }
    return loaded[0]?.name ?? marketplace.catalogName ?? 'Local plugins';
  }

  /** Provenance label shown per entry once more than one catalog is configured. */
  function entryCatalogLabel(entry: PluginMarketplaceEntry): string | undefined {
    const loaded = (marketplace.catalogs ?? []).filter((catalog) => !catalog.error);
    if (loaded.length < 2 || !entry.catalogName) {
      return undefined;
    }
    return entry.catalogName;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="header">
      <TabBar ariaLabel="Plugin views">
        <Tab active={tab === 'installed'} onclick={() => (tab = 'installed')}>Installed</Tab>
        <Tab active={tab === 'marketplace'} onclick={() => (tab = 'marketplace')}>Marketplace</Tab>
        <Tab active={tab === 'events'} onclick={() => (tab = 'events')}>Events</Tab>
      </TabBar>
      <span class="header-close">
        <CloseButton label="Close plugins" onclick={onClose} />
      </span>
    </div>

    <div class="content">
      {#if loading}
        <div class="empty-msg">Loading plugins...</div>
      {:else if tab === 'installed'}
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
            {@const id = plugin.manifest.id}
            {@const health = healthFor(id)}
            {@const review = reviewFor(id)}
            {@const compat = compatibilityFor(id)}
            {@const config = configFor(id)}
            {@const secretSnapshot = secretsFor(id)}
            {@const pluginCommands = commandsFor(id)}
            {@const pluginSettings = settingsExtensionsFor(id)}
            {@const otherExtensions = extensionsFor(id).filter((item) => item.slot !== 'settings')}
            {@const expandable = hasDetail(id)}
            {@const isOpen = expanded === id}
            <div class="item plugin-item">
              <div class="plugin-row">
                {#if expandable}
                  <IconButton
                    variant="bare"
                    size={20}
                    title={isOpen ? 'Hide plugin detail' : 'Show plugin detail'}
                    onclick={() => toggleExpanded(id)}
                  >
                    <span class="chevron" class:is-open={isOpen}>
                      <Icon name="chevron" size={11} />
                    </span>
                  </IconButton>
                {:else}
                  <span class="chevron-spacer"></span>
                {/if}
                <span class="status-dot {statusClass(plugin.status)}"></span>
                <div class="item-main">
                  <div class="item-title">
                    <span>{plugin.manifest.name}</span>
                    <code>{id}</code>
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
                    {#if health?.metrics}<span>rss {formatBytes(health.metrics.rssBytes)}</span
                      >{/if}
                    {#if health?.metrics}<span>cpu {health.metrics.cpuPercent.toFixed(1)}%</span
                      >{/if}
                    {#if health && health.crashCount > 0}
                      <span>{health.crashCount} crashes</span>
                    {/if}
                  </div>
                  {#if review}
                    <div class="plugin-badges">
                      <Chip tone={riskTone(review.riskLevel)} bold>{review.riskLevel} risk</Chip>
                      {#if review.approvalStatus !== 'approved'}
                        <Chip tone="warn">needs approval</Chip>
                      {/if}
                    </div>
                  {/if}
                  {#if plugin.quarantineReason}
                    <div class="warning-line">Quarantined: {plugin.quarantineReason}</div>
                  {/if}
                  {#if plugin.error}
                    <div class="error-line">{plugin.error}</div>
                  {/if}
                  {#if expandable && !isOpen && detailSummary(id)}
                    <div class="item-desc">{detailSummary(id)}</div>
                  {/if}
                </div>
                {#if !plugin.manifest.builtin}
                  <div class="action-stack">
                    <Button
                      variant="secondary"
                      disabled={reloading !== null}
                      onclick={() => reloadPlugin(plugin)}
                    >
                      {reloading === id ? 'Reloading...' : 'Reload'}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={toggling !== null}
                      onclick={() => togglePlugin(plugin)}
                    >
                      {plugin.enabled ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                {/if}
              </div>

              {#if isOpen}
                <div class="plugin-detail">
                  {#if review}
                    <div class="detail-section">
                      <div class="section-title">Security review</div>
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
                        <span>
                          {review.approvedAt
                            ? `approved ${new Date(review.approvedAt).toLocaleString()}`
                            : ''}
                        </span>
                        {#if review.approvalStatus !== 'approved'}
                          <Button
                            variant="secondary"
                            disabled={saving !== null}
                            onclick={() => approvePlugin(id)}
                          >
                            {saving === `${id}:approval` ? 'Saving...' : 'Approve'}
                          </Button>
                        {:else}
                          <Button
                            variant="secondary"
                            disabled={saving !== null}
                            onclick={() => revokeApproval(id)}
                          >
                            {saving === `${id}:approval` ? 'Saving...' : 'Revoke'}
                          </Button>
                        {/if}
                      </div>
                    </div>
                  {/if}

                  {#if compat}
                    <div class="detail-section">
                      <div class="section-title">Compatibility</div>
                      <div class="item-meta">
                        {#if compat.minDockscopeVersion}
                          <span>min {compat.minDockscopeVersion}</span>
                        {/if}
                        {#if compat.maxDockscopeVersion}
                          <span>max {compat.maxDockscopeVersion}</span>
                        {/if}
                        <span>{pluralize(compat.migrations.length, 'migration', 'migrations')}</span
                        >
                      </div>
                      {#each compat.warnings as warning}
                        <div class="error-line">{warning}</div>
                      {/each}
                      {#each compat.deprecations as deprecation}
                        <div class="item-desc">{deprecation}</div>
                      {/each}
                      {#each compat.migrations as migration}
                        <div class="migration-row">
                          <span>{migration.from} -> {migration.to}</span>
                          <span>{migration.notes ?? ''}</span>
                          {#if migration.commandId}
                            <Button
                              variant="secondary"
                              disabled={runningCommand !== null}
                              onclick={() => runMigration(id, migration.from, migration.to)}
                            >
                              {runningCommand === `${id}:${migration.from}:${migration.to}`
                                ? 'Running...'
                                : 'Run'}
                            </Button>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}

                  {#if config || pluginSettings.length > 0}
                    <div class="detail-section">
                      <div class="section-title">Configuration</div>
                      {#if config}
                        {#each config.schema?.fields ?? [] as field}
                          <label class="field">
                            <span class="field-label">{field.label}</span>
                            {#if field.type === 'boolean'}
                              <input
                                type="checkbox"
                                checked={Boolean(fieldValue(id, field))}
                                onchange={(event) =>
                                  setDraftValue(id, field.key, checkedValue(event))}
                              />
                            {:else if field.type === 'select'}
                              <Select
                                ariaLabel={field.label}
                                value={String(fieldValue(id, field))}
                                options={(field.options ?? []).map((option) => ({
                                  value: option.value,
                                  label: option.label,
                                }))}
                                onchange={(value) => setDraftValue(id, field.key, value)}
                              />
                            {:else}
                              <input
                                type={field.type === 'number' ? 'number' : 'text'}
                                value={String(fieldValue(id, field))}
                                oninput={(event) =>
                                  setDraftValue(
                                    id,
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
                        <div class="detail-actions">
                          <Button
                            variant="secondary"
                            disabled={saving !== null}
                            onclick={() => saveConfig(id)}
                          >
                            {saving === id ? 'Saving...' : 'Save'}
                          </Button>
                        </div>
                      {/if}
                      {#each pluginSettings as extension (extension.pluginId + extension.id)}
                        <PluginExtension {extension} context={{}} onAction={runExtensionAction} />
                      {/each}
                    </div>
                  {/if}

                  {#if secretSnapshot}
                    <div class="detail-section">
                      <div class="section-title">Secrets</div>
                      {#each secretSnapshot.secrets as secret}
                        <label class="field">
                          <span class="field-label">{secret.label}</span>
                          <div class="secret-row">
                            <input
                              type="password"
                              placeholder={secret.configured ? 'Configured' : 'Not configured'}
                              value={secretDrafts[id]?.[secret.key] ?? ''}
                              oninput={(event) => setSecretDraft(id, secret.key, inputValue(event))}
                            />
                            <Button
                              variant="secondary"
                              disabled={!secretDrafts[id]?.[secret.key] || saving !== null}
                              onclick={() => saveSecret(id, secret.key)}
                            >
                              {saving === `${id}:${secret.key}` ? 'Saving...' : 'Save'}
                            </Button>
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
                  {/if}

                  {#if pluginCommands.length > 0}
                    <div class="detail-section">
                      <div class="section-title">Commands</div>
                      {#each pluginCommands as command}
                        <div class="detail-entry">
                          <div class="detail-entry-main">
                            <div class="item-title">
                              <span>{command.title}</span>
                              <code>{command.id}</code>
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
                                          setCommandInputValue(
                                            command,
                                            field.key,
                                            checkedValue(event),
                                          )}
                                      />
                                    {:else if field.type === 'select'}
                                      <Select
                                        ariaLabel={field.label}
                                        value={String(commandFieldValue(command, field))}
                                        options={(field.options ?? []).map((option) => ({
                                          value: option.value,
                                          label: option.label,
                                        }))}
                                        onchange={(value) =>
                                          setCommandInputValue(command, field.key, value)}
                                      />
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
                          <Button
                            variant="secondary"
                            disabled={runningCommand !== null}
                            onclick={() => runCommand(command)}
                          >
                            {runningCommand === commandKey(command) ? 'Running...' : 'Run'}
                          </Button>
                        </div>
                      {/each}
                    </div>
                  {/if}

                  {#if otherExtensions.length > 0}
                    <div class="detail-section">
                      <div class="section-title">UI extensions</div>
                      {#each otherExtensions as extension}
                        <div class="detail-entry">
                          <div class="detail-entry-main">
                            <div class="item-title">
                              <span>{extension.title}</span>
                              <code>{extension.id}</code>
                            </div>
                            {#if extension.description}
                              <div class="item-desc">{extension.description}</div>
                            {/if}
                            {#if extension.content}
                              <pre class="content-preview">{extensionContentPreview(
                                  extension,
                                )}</pre>
                            {/if}
                            <div class="item-meta">
                              <span>slot {extension.slot}</span>
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
                                  · {extension.action.pluginId ?? extension.pluginId}:{extension
                                    .action.commandId}
                                {/if}
                              </div>
                            {/if}
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
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
      {:else if tab === 'marketplace'}
        {#each failedCatalogs() as failed (failed.source)}
          <div class="marketplace-alert">
            <span>Catalog unavailable: {failed.name ?? failed.source} — {failed.error}</span>
            <IconButton
              variant="outline"
              size={28}
              title="Retry catalog"
              onclick={() => void loadPluginState()}
            >
              <Icon name="restart" size={13} />
            </IconButton>
          </div>
        {/each}
        {#if !marketplace.configured && marketplace.entries.length === 0}
          <div class="empty-msg">No plugin marketplace configured.</div>
        {:else if marketplace.entries.length === 0}
          {#if failedCatalogs().length === 0}
            <div class="empty-msg">{marketplace.catalogName ?? 'Plugin marketplace'} is empty.</div>
          {/if}
        {:else}
          <div class="summary-row">
            <span>{catalogSummaryText()}</span>
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
            <Select
              ariaLabel="Filter marketplace"
              value={marketplaceFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'available', label: 'Available' },
                { value: 'installed', label: 'Installed' },
                { value: 'updates', label: 'Updates' },
                { value: 'local', label: 'Local' },
                { value: 'deprecated', label: 'Deprecated' },
              ]}
              onchange={(value) => (marketplaceFilter = value as MarketplaceFilter)}
            />
          </div>

          <div class="catalog-manager">
            <div class="catalog-manager-head">
              <span>Catalogs</span>
              <Button
                size="sm"
                disabled={catalogBusy}
                onclick={() => (showAddCatalog ? resetAddCatalog() : (showAddCatalog = true))}
              >
                {showAddCatalog ? 'Cancel' : '+ Add catalog'}
              </Button>
            </div>

            {#each marketplace.catalogs ?? [] as catalog (catalog.source)}
              <div class="catalog-row">
                <span class="catalog-row-name">
                  {catalog.name ?? catalog.source}
                  {#if catalog.official}
                    <Chip tone="accent" uppercase>official</Chip>
                  {/if}
                  {#if catalog.error}
                    <Chip tone="warn" uppercase>unavailable</Chip>
                  {:else if catalog.signatureVerified}
                    <Chip uppercase>signed</Chip>
                  {:else}
                    <Chip tone="warn" uppercase>unsigned</Chip>
                  {/if}
                </span>
                <span class="catalog-row-meta" class:is-error={Boolean(catalog.error)}>
                  {catalog.error ?? pluralize(catalog.entryCount, 'entry', 'entries')}
                </span>
                {#if catalog.userAdded}
                  <Button
                    variant="ghost"
                    tone="danger"
                    size="sm"
                    title={catalog.fingerprint
                      ? `Pinned key ${catalog.fingerprint}`
                      : 'Remove catalog'}
                    disabled={catalogBusy}
                    onclick={() => void removeCatalog(catalog.source, catalog.name)}
                  >
                    Remove
                  </Button>
                {/if}
              </div>
            {/each}

            {#if showAddCatalog}
              <div class="catalog-add">
                <div class="catalog-add-row">
                  <TextInput
                    bind:value={catalogSourceDraft}
                    placeholder="https://example.com/catalog.json"
                    ariaLabel="Catalog URL"
                    onkeydown={(event) => event.key === 'Enter' && void previewCatalog()}
                  />
                  <Button
                    disabled={catalogBusy || !catalogSourceDraft.trim()}
                    onclick={() => void previewCatalog()}
                  >
                    {catalogBusy ? 'Checking...' : 'Fetch'}
                  </Button>
                </div>

                {#if catalogPreview}
                  {#if alreadyConfigured(catalogPreview.source)}
                    <div class="catalog-preview catalog-preview-bad">
                      <div class="catalog-preview-title">Already configured</div>
                      <div class="catalog-preview-fact">
                        This catalog is already active, so there is nothing to add.
                      </div>
                    </div>
                  {:else if catalogPreview.signatureVerified}
                    <div class="catalog-preview">
                      <div class="catalog-preview-title">
                        {catalogPreview.name ?? catalogPreview.source} · {pluralize(
                          catalogPreview.entryCount,
                          'entry',
                          'entries',
                        )}
                      </div>
                      <div class="catalog-preview-fact">
                        <span>Signed by</span>
                        <code>{catalogPreview.keyId ?? 'unknown key'}</code>
                      </div>
                      <div class="catalog-preview-fact">
                        <span>SHA-256</span>
                        <code>{catalogPreview.fingerprint}</code>
                      </div>
                      <div class="catalog-preview-warn">
                        Verify this fingerprint with the publisher before trusting it. The key is
                        pinned, so a later change will make this catalog fail instead of loading
                        silently.
                      </div>
                      <Button
                        variant="primary"
                        disabled={catalogBusy}
                        onclick={() => void trustCatalog()}
                      >
                        Trust and add
                      </Button>
                    </div>
                  {:else}
                    <div class="catalog-preview catalog-preview-bad">
                      <div class="catalog-preview-title">Cannot add this catalog</div>
                      <div class="catalog-preview-fact">{catalogPreview.problem}</div>
                    </div>
                  {/if}
                {/if}
              </div>
            {/if}
          </div>
          <div class="list">
            {#each marketplaceEntries as entry}
              <div class="item">
                <Chip tone={marketplaceStateTone(entry)} bold>
                  {marketplaceLabel(entry)}
                </Chip>
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
                    {#if entryCatalogLabel(entry)}
                      <span class="entry-catalog" title={entry.catalogSource}
                        >{entryCatalogLabel(entry)}</span
                      >
                    {/if}
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
                <Button
                  variant="secondary"
                  disabled={marketplaceActionDisabled(entry)}
                  onclick={() => requestMarketplaceAction(entry)}
                >
                  {marketplaceAction === marketplaceActionKey(entry)
                    ? 'Working...'
                    : marketplaceActionLabel(entry)}
                </Button>
              </div>
            {/each}
          </div>
        {/if}
      {:else if events.length === 0}
        <div class="empty-msg">No plugin events recorded.</div>
      {:else}
        <div class="list">
          {#each events as event}
            <div class="item">
              <Chip tone="warn">event</Chip>
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
    </div>

    {#if marketplaceReview}
      <div class="confirm-layer">
        <div class="confirm-box">
          <div class="confirm-header">
            <div>
              <div class="confirm-title">{marketplaceReview.entry.name}</div>
              <code>{marketplaceReview.entry.id} v{marketplaceReview.entry.version}</code>
            </div>
            <CloseButton label="Close review" onclick={() => (marketplaceReview = null)} />
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

          {#if marketplaceReview.action !== 'uninstall' && marketplaceReview.entry.permissions.length > 0}
            <div class="grant-note">
              Confirming grants this plugin: {listText(marketplaceReview.entry.permissions)}
            </div>
          {/if}

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
            <Button variant="secondary" onclick={() => (marketplaceReview = null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={marketplaceActionDisabled(marketplaceReview.entry)}
              onclick={() => void confirmMarketplaceReview()}
            >
              {marketplaceAction === marketplaceActionKey(marketplaceReview.entry)
                ? 'Working...'
                : marketplaceActionLabel(marketplaceReview.entry)}
            </Button>
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
    width: min(880px, calc(100vw - 28px));
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
    gap: 12px;
    padding: 14px 18px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  /* Centre the close button on the tab labels rather than on the whole tab box,
     which includes the active-tab underline sitting on the header's bottom edge.
     Without this the button ends up a pixel off that underline. */
  .header-close {
    display: flex;
    align-self: flex-start;
    margin-top: 4px;
  }

  .content {
    padding: 16px 18px 18px;
    overflow-y: auto;
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    font-size: var(--text-base);
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
    font-size: var(--text-base);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .item {
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

  .item-main,
  .detail-entry-main {
    min-width: 0;
    flex: 1;
  }

  /* ---- installed list: one expandable row per plugin ---- */

  /* The detail region sits below the row, so the item stacks and the row itself
     becomes the flex line. */
  .plugin-item {
    flex-direction: column;
    gap: 0;
  }

  .plugin-row {
    display: flex;
    gap: 10px;
  }

  /* Holds the title column in line with rows that do have a disclosure control.
     Matches the chevron IconButton's 20px box. */
  .chevron-spacer {
    width: 20px;
    flex: 0 0 auto;
  }

  .chevron {
    display: flex;
    color: rgba(226, 232, 240, 0.5);
    transition: transform 0.15s ease;
  }

  .chevron.is-open {
    transform: rotate(90deg);
  }

  .plugin-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }

  .plugin-detail {
    margin-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.055);
  }

  .detail-section + .detail-section {
    border-top: 1px solid rgba(255, 255, 255, 0.035);
  }

  /* Tighter than a top-level section heading, which is spaced for the panel. */
  .plugin-detail .section-title {
    margin: 12px 0 6px;
  }

  .detail-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
  }

  .detail-entry {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 0;
  }

  .detail-entry + .detail-entry {
    border-top: 1px solid rgba(255, 255, 255, 0.035);
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
    font-size: var(--text-md);
    font-weight: 600;
  }

  code,
  .path-line {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: rgba(122, 133, 153, 0.8);
  }

  .item-meta,
  .item-desc,
  .error-line,
  .field-desc {
    margin-top: 4px;
    font-size: var(--text-base);
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
    font-size: var(--text-sm);
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

  .marketplace-registry {
    margin: -4px 0 10px;
    overflow-wrap: anywhere;
  }

  /* Plain text, not a chip: every sibling in .item-meta is unstyled text, so a
     padded box here was the only thing making that row taller. Colour alone is
     enough to mark provenance. */
  .entry-catalog {
    color: rgba(0, 228, 255, 0.72);
  }

  .catalog-manager {
    margin: 0 0 12px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.012);
  }

  .catalog-manager-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .catalog-manager-head span {
    font-size: var(--text-sm);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(226, 232, 240, 0.5);
  }

  /* Entry counts share a fixed column so they line up across rows. */
  .catalog-row {
    display: grid;
    grid-template-columns: 1fr auto 62px;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    font-size: var(--text-base);
    color: #e2e8f0;
  }

  .catalog-row + .catalog-row {
    border-top: 1px solid rgba(255, 255, 255, 0.03);
  }

  .catalog-row-name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .catalog-row-meta {
    font-size: var(--text-sm);
    color: rgba(122, 133, 153, 0.82);
    text-align: right;
    overflow-wrap: anywhere;
  }

  .catalog-row-meta.is-error {
    color: #ff6b84;
  }

  .catalog-add {
    padding: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  /* Grid rather than flex so the primitive sizes itself and the parent never
     has to reach into the component's scope to set flex on its input. */
  .catalog-add-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
  }

  .catalog-preview {
    margin-top: 10px;
    padding: 10px;
    border: 1px solid rgba(0, 228, 255, 0.14);
    border-radius: 6px;
    background: rgba(0, 228, 255, 0.03);
    font-size: var(--text-base);
  }

  .catalog-preview-bad {
    border-color: rgba(255, 176, 32, 0.28);
    background: rgba(255, 176, 32, 0.04);
  }

  .catalog-preview-title {
    color: #e2e8f0;
    font-weight: 600;
    margin-bottom: 6px;
  }

  .catalog-preview-fact {
    display: flex;
    gap: 6px;
    margin-bottom: 3px;
    font-size: var(--text-sm);
    color: rgba(226, 232, 240, 0.62);
  }

  .catalog-preview-fact code {
    color: rgba(226, 232, 240, 0.85);
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }

  .catalog-preview-warn {
    margin: 8px 0;
    padding: 7px 8px;
    border-radius: 5px;
    background: rgba(255, 176, 32, 0.07);
    color: var(--accent-amber);
    font-size: var(--text-sm);
    line-height: 1.45;
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
    font-size: var(--text-base);
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
    font-size: var(--text-sm);
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
    font-size: var(--text-lg);
    font-weight: 700;
  }

  .marketplace-review-grid {
    margin-top: 14px;
  }

  .grant-note {
    margin-top: 12px;
    padding: 10px;
    border-left: 2px solid rgba(255, 190, 64, 0.5);
    background: rgba(255, 190, 64, 0.06);
    color: rgba(226, 232, 240, 0.82);
    font-size: var(--text-base);
    line-height: 1.5;
  }

  .release-notes {
    margin-top: 12px;
    padding: 10px;
    border-left: 2px solid rgba(0, 228, 255, 0.34);
    background: rgba(0, 228, 255, 0.04);
    color: rgba(226, 232, 240, 0.76);
    font-size: var(--text-base);
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
    font-size: var(--text-sm);
    line-height: 1.55;
  }

  .review-links {
    margin-top: 12px;
  }

  .confirm-actions {
    margin-top: 14px;
    justify-content: flex-end;
  }

  .review-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
    margin-top: 10px;
    font-size: var(--text-base);
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
    font-size: var(--text-base);
    color: rgba(226, 232, 240, 0.7);
  }

  .approval-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    margin-top: 10px;
    font-size: var(--text-base);
    color: rgba(226, 232, 240, 0.7);
  }

  .content-preview {
    margin: 8px 0 0;
    white-space: pre-wrap;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
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
    font-size: var(--text-base);
    color: rgba(226, 232, 240, 0.78);
  }

  .field-desc {
    grid-column: 2;
    margin-top: -3px;
  }

  /* Raw text inputs that are not yet TextInput components. Kept in sync with
     the TextInput surface so mixed forms still line up. */
  input[type='text'],
  input[type='number'],
  input[type='password'] {
    min-width: 0;
    width: 100%;
    background: var(--bg-inset);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    padding: 8px 9px;
    color: var(--text-primary);
    font-size: var(--text-md);
  }

  input[type='checkbox'] {
    width: 16px;
    height: 16px;
  }

  .secret-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }

  .empty-msg {
    padding: 30px 10px;
    text-align: center;
    font-size: var(--text-md);
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
