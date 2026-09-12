<script lang="ts">
  import { type AccessRole } from '../../../core/access';

  import PluginExtension from '../PluginExtension.svelte';

  import Icon from '../Icon.svelte';
  import { Button, Chip, IconButton, Select } from '../ui';

  import type { PluginManagerData } from './data.svelte';
  import type { InstalledPluginsModel } from './installed.svelte';
  import { inputValue, checkedValue, commandKey } from './forms';
  import {
    extensionContentPreview,
    statusClass,
    formatBytes,
    listText,
    shortFingerprint,
    riskTone,
    pluralize,
  } from './presentation';
  let {
    data,
    model,
    role,
  }: { data: PluginManagerData; model: InstalledPluginsModel; role: AccessRole | null } = $props();
</script>

<div class="summary-row">
  <span>{data.plugins.length} registered</span>
  {#if data.errors.length > 0}
    <span class="error-count">{data.errors.length} load errors</span>
  {/if}
  {#if data.warnings.length > 0}
    <span class="warning-count">{data.warnings.length} warnings</span>
  {/if}
</div>

<div class="list">
  {#each data.plugins as plugin}
    {@const id = plugin.manifest.id}
    {@const health = model.healthFor(id)}
    {@const review = model.reviewFor(id)}
    {@const compat = model.compatibilityFor(id)}
    {@const config = model.configFor(id)}
    {@const secretSnapshot = model.secretsFor(id)}
    {@const pluginCommands = model.commandsFor(id)}
    {@const pluginSettings = model.settingsExtensionsFor(id)}
    {@const otherExtensions = model.extensionsFor(id).filter((item) => item.slot !== 'settings')}
    {@const expandable = model.hasDetail(id)}
    {@const isOpen = model.expanded === id}
    <div class="item plugin-item">
      <div class="plugin-row">
        {#if expandable}
          <IconButton
            variant="bare"
            size={20}
            title={isOpen ? 'Hide plugin detail' : 'Show plugin detail'}
            onclick={() => model.toggleExpanded(id)}
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
            {#if health?.metrics}<span>rss {formatBytes(health.metrics.rssBytes)}</span>{/if}
            {#if health?.metrics}<span>cpu {health.metrics.cpuPercent.toFixed(1)}%</span>{/if}
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
          {#if expandable && !isOpen && model.detailSummary(id)}
            <div class="item-desc">{model.detailSummary(id)}</div>
          {/if}
        </div>
        {#if model.canOperate && !plugin.manifest.builtin}
          <div class="action-stack">
            <Button
              variant="secondary"
              disabled={model.reloading !== null}
              onclick={() => model.reloadPlugin(plugin)}
            >
              {model.reloading === id ? 'Reloading...' : 'Reload'}
            </Button>
            <Button
              variant="secondary"
              disabled={model.toggling !== null}
              onclick={() => model.togglePlugin(plugin)}
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
                {#if model.canOperate}
                  {#if review.approvalStatus !== 'approved'}
                    <Button
                      variant="secondary"
                      disabled={model.saving !== null}
                      onclick={() => model.approvePlugin(id)}
                    >
                      {model.saving === `${id}:approval` ? 'Saving...' : 'Approve'}
                    </Button>
                  {:else}
                    <Button
                      variant="secondary"
                      disabled={model.saving !== null}
                      onclick={() => model.revokeApproval(id)}
                    >
                      {model.saving === `${id}:approval` ? 'Saving...' : 'Revoke'}
                    </Button>
                  {/if}
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
                <span>{pluralize(compat.migrations.length, 'migration', 'migrations')}</span>
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
                  {#if model.canOperate && migration.commandId}
                    <Button
                      variant="secondary"
                      disabled={model.runningCommand !== null}
                      onclick={() => model.runMigration(id, migration.from, migration.to)}
                    >
                      {model.runningCommand === `${id}:${migration.from}:${migration.to}`
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
                        checked={Boolean(model.fieldValue(id, field))}
                        disabled={!model.canOperate}
                        onchange={(event) =>
                          model.setDraftValue(id, field.key, checkedValue(event))}
                      />
                    {:else if field.type === 'select'}
                      <Select
                        ariaLabel={field.label}
                        value={String(model.fieldValue(id, field))}
                        disabled={!model.canOperate}
                        options={(field.options ?? []).map((option) => ({
                          value: option.value,
                          label: option.label,
                        }))}
                        onchange={(value) => model.setDraftValue(id, field.key, value)}
                      />
                    {:else}
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={String(model.fieldValue(id, field))}
                        disabled={!model.canOperate}
                        oninput={(event) =>
                          model.setDraftValue(
                            id,
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
                {#if model.canOperate}
                  <div class="detail-actions">
                    <Button
                      variant="secondary"
                      disabled={model.saving !== null}
                      onclick={() => model.saveConfig(id)}
                    >
                      {model.saving === id ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                {/if}
              {/if}
              {#each pluginSettings as extension (extension.pluginId + extension.id)}
                <PluginExtension
                  {extension}
                  context={{}}
                  {role}
                  onAction={(extension, input) => model.runExtensionAction(extension, input)}
                />
              {/each}
            </div>
          {/if}

          {#if secretSnapshot}
            <div class="detail-section">
              <div class="section-title">Secrets</div>
              {#each secretSnapshot.secrets as secret}
                <label class="field">
                  <span class="field-label">{secret.label}</span>
                  {#if model.canOperate}
                    <div class="secret-row">
                      <input
                        type="password"
                        placeholder={secret.configured ? 'Configured' : 'Not configured'}
                        value={data.secretDrafts[id]?.[secret.key] ?? ''}
                        oninput={(event) => model.setSecretDraft(id, secret.key, inputValue(event))}
                      />
                      <Button
                        variant="secondary"
                        disabled={!data.secretDrafts[id]?.[secret.key] || model.saving !== null}
                        onclick={() => model.saveSecret(id, secret.key)}
                      >
                        {model.saving === `${id}:${secret.key}` ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  {/if}
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
                    {#if model.canOperate && command.input?.fields.length}
                      <div class="command-inputs">
                        {#each command.input.fields as field}
                          <label class="field command-field">
                            <span class="field-label">{field.label}</span>
                            {#if field.type === 'boolean'}
                              <input
                                type="checkbox"
                                checked={Boolean(model.commandFieldValue(command, field))}
                                onchange={(event) =>
                                  model.setCommandInputValue(
                                    command,
                                    field.key,
                                    checkedValue(event),
                                  )}
                              />
                            {:else if field.type === 'select'}
                              <Select
                                ariaLabel={field.label}
                                value={String(model.commandFieldValue(command, field))}
                                options={(field.options ?? []).map((option) => ({
                                  value: option.value,
                                  label: option.label,
                                }))}
                                onchange={(value) =>
                                  model.setCommandInputValue(command, field.key, value)}
                              />
                            {:else}
                              <input
                                type={field.type === 'number' ? 'number' : 'text'}
                                value={String(model.commandFieldValue(command, field))}
                                oninput={(event) =>
                                  model.setCommandInputValue(
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
                  {#if model.canOperate}
                    <Button
                      variant="secondary"
                      disabled={model.runningCommand !== null}
                      onclick={() => model.runCommand(command)}
                    >
                      {model.runningCommand === commandKey(command) ? 'Running...' : 'Run'}
                    </Button>
                  {/if}
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
                      <pre class="content-preview">{extensionContentPreview(extension)}</pre>
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
        </div>
      {/if}
    </div>
  {/each}
</div>

{#if data.errors.length > 0}
  <div class="section-title">Load Errors</div>
  <div class="list">
    {#each data.errors as error}
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
{#if data.warnings.length > 0}
  <div class="section-title">Manifest Warnings</div>
  <div class="list">
    {#each data.warnings as warning}
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

<style>
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
  .plugin-item {
    flex-direction: column;
    gap: 0;
  }

  .plugin-row {
    display: flex;
    gap: 10px;
  }
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
