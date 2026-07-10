<script lang="ts">
  import { onMount } from 'svelte';
  import { getJson, requestJson } from '../lib/api';
  import { addToast } from '../stores/toast.svelte';
  import type {
    PluginConfigSnapshot,
    PluginLoadError,
    PluginReviewReport,
    PluginRuntimeInfo,
  } from '../../core/plugins';
  import type { PluginConfigField, PluginConfigValue } from '../../core/plugin-config';
  import type { PluginSecretSnapshot } from '../../core/plugin-secrets';
  import type { PluginUiExtension } from '../../core/plugin-ui';
  import type { PluginCommand, PluginCommandResult } from '../../core/plugin-commands';
  import type { PluginEvent } from '../../core/plugin-events';
  import type { PluginCompatibilityReport } from '../../core/plugin-compatibility';
  import type { ResolvedPluginCatalogEntry } from '../../plugins/catalog';

  interface PluginCatalogResponse {
    configured: boolean;
    name?: string;
    entries: ResolvedPluginCatalogEntry[];
  }

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let tab = $state<
    | 'plugins'
    | 'extensions'
    | 'commands'
    | 'events'
    | 'review'
    | 'catalog'
    | 'compatibility'
    | 'config'
    | 'secrets'
  >('plugins');
  let loading = $state(true);
  let plugins = $state<PluginRuntimeInfo[]>([]);
  let errors = $state<PluginLoadError[]>([]);
  let extensions = $state<PluginUiExtension[]>([]);
  let commands = $state<PluginCommand[]>([]);
  let events = $state<PluginEvent[]>([]);
  let reviews = $state<PluginReviewReport[]>([]);
  let catalogConfigured = $state(false);
  let catalogName = $state<string | undefined>();
  let catalogEntries = $state<ResolvedPluginCatalogEntry[]>([]);
  let compatibility = $state<PluginCompatibilityReport[]>([]);
  let configs = $state<PluginConfigSnapshot[]>([]);
  let secrets = $state<PluginSecretSnapshot[]>([]);
  let drafts = $state<Record<string, Record<string, PluginConfigValue>>>({});
  let secretDrafts = $state<Record<string, Record<string, string>>>({});
  let saving = $state<string | null>(null);
  let toggling = $state<string | null>(null);
  let reloading = $state<string | null>(null);
  let runningCommand = $state<string | null>(null);

  const configurable = $derived(
    configs.filter((config) => (config.schema?.fields.length ?? 0) > 0),
  );

  onMount(() => {
    void loadPluginState();
  });

  async function loadPluginState() {
    loading = true;
    try {
      const [
        pluginData,
        errorData,
        extensionData,
        commandData,
        eventData,
        reviewData,
        catalogData,
        compatibilityData,
        configData,
        secretData,
      ] = await Promise.all([
        getJson<PluginRuntimeInfo[]>('/api/plugins'),
        getJson<PluginLoadError[]>('/api/plugins/errors'),
        getJson<PluginUiExtension[]>('/api/plugins/ui'),
        getJson<PluginCommand[]>('/api/plugins/commands'),
        getJson<PluginEvent[]>('/api/plugins/events'),
        getJson<PluginReviewReport[]>('/api/plugins/review'),
        getJson<PluginCatalogResponse>('/api/plugins/catalog'),
        getJson<PluginCompatibilityReport[]>('/api/plugins/compatibility'),
        getJson<PluginConfigSnapshot[]>('/api/plugins/config'),
        getJson<PluginSecretSnapshot[]>('/api/plugins/secrets'),
      ]);
      plugins = pluginData;
      errors = errorData;
      extensions = extensionData;
      commands = commandData;
      events = eventData;
      reviews = reviewData;
      catalogConfigured = catalogData.configured;
      catalogName = catalogData.name;
      catalogEntries = catalogData.entries;
      compatibility = compatibilityData;
      configs = configData;
      secrets = secretData;
      drafts = Object.fromEntries(
        configData.map((config) => [config.pluginId, { ...config.values }]),
      );
      secretDrafts = Object.fromEntries(secretData.map((secret) => [secret.pluginId, {}]));
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
      await loadPluginState();
      addToast(`${plugin.manifest.name}: reloaded`, 'success');
    } catch {
      addToast(`${plugin.manifest.name}: reload failed`, 'error');
    } finally {
      reloading = null;
    }
  }

  async function runCommand(command: PluginCommand) {
    const key = `${command.pluginId}:${command.id}`;
    if (runningCommand) {
      return;
    }
    runningCommand = key;
    try {
      const result = await requestJson<PluginCommandResult>(
        `/api/plugins/${encodeURIComponent(command.pluginId)}/commands/${encodeURIComponent(command.id)}`,
        { method: 'POST' },
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
    return status === 'started' ? 'ok' : status === 'failed' ? 'bad' : 'idle';
  }

  function listText(values: readonly string[]): string {
    return values.length > 0 ? values.join(', ') : 'none';
  }

  function shortFingerprint(value: string): string {
    return value.slice(0, 12);
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
        <button class="tab" class:active={tab === 'catalog'} onclick={() => (tab = 'catalog')}>
          Catalog
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
        </div>

        <div class="list">
          {#each plugins as plugin}
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
                </div>
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
                    <pre class="content-preview">{extension.content.body}</pre>
                  {/if}
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
                </div>
                <button
                  class="save-btn"
                  disabled={runningCommand !== null}
                  onclick={() => runCommand(command)}
                >
                  {runningCommand === `${command.pluginId}:${command.id}` ? 'Running...' : 'Run'}
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
      {:else if tab === 'catalog'}
        {#if !catalogConfigured}
          <div class="empty-msg">No plugin catalog configured.</div>
        {:else if catalogEntries.length === 0}
          <div class="empty-msg">{catalogName ?? 'Plugin catalog'} is empty.</div>
        {:else}
          <div class="summary-row">
            <span>{catalogName}</span>
            <span>{catalogEntries.length} entries</span>
          </div>
          <div class="list">
            {#each catalogEntries as entry}
              <div class="item">
                <div class="slot-badge">catalog</div>
                <div class="item-main">
                  <div class="item-title">
                    <span>{entry.name}</span>
                    <code>{entry.id} v{entry.version}</code>
                  </div>
                  {#if entry.description}
                    <div class="item-desc">{entry.description}</div>
                  {/if}
                  <div class="item-meta">
                    <span>{entry.signature?.algorithm ?? 'unsigned'}</span>
                    {#if entry.category}
                      <span>{entry.category}</span>
                    {/if}
                    <span>{entry.tags.length} tags</span>
                  </div>
                  <div class="item-desc">{entry.resolvedPackageUrl}</div>
                </div>
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
      {:else if tab === 'config' && configurable.length === 0}
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
  }
</style>
