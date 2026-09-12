<script lang="ts">
  import Icon from '../Icon.svelte';
  import { Button, Chip, IconButton, Select, TextInput } from '../ui';

  import { MARKETPLACE_FILTER_OPTIONS, type MarketplaceFilter } from './marketplacePolicy';

  import type { PluginManagerData } from './data.svelte';
  import type { MarketplaceModel } from './marketplace.svelte';
  import { inputValue } from './forms';
  import {
    marketplaceStateTone,
    marketplaceLabel,
    marketplaceActionLabel,
    marketplaceActionKey,
    marketplaceTrust,
    formatDate,
    marketplaceVersionLine,
    marketplaceCompatibility,
    pluralize,
  } from './presentation';
  let { data, model }: { data: PluginManagerData; model: MarketplaceModel } = $props();
</script>

{#each model.failedCatalogs() as failed (failed.source)}
  <div class="marketplace-alert">
    <span>Catalog unavailable: {failed.name ?? failed.source} — {failed.error}</span>
    <IconButton
      variant="outline"
      size={28}
      title="Retry catalog"
      onclick={() => void data.loadPluginState()}
    >
      <Icon name="restart" size={13} />
    </IconButton>
  </div>
{/each}
{#if !data.marketplace.configured && data.marketplace.entries.length === 0}
  <div class="empty-msg">No plugin marketplace configured.</div>
{:else if data.marketplace.entries.length === 0}
  {#if model.failedCatalogs().length === 0}
    <div class="empty-msg">{data.marketplace.catalogName ?? 'Plugin marketplace'} is empty.</div>
  {/if}
{:else}
  <div class="summary-row">
    <span>{model.catalogSummaryText()}</span>
    <span
      >{model.catalogTrustText()} · {model.marketplaceEntries.length} / {data.marketplace.entries
        .length} entries</span
    >
  </div>
  <div class="path-line marketplace-registry">{data.marketplace.registryDir}</div>
  <div class="marketplace-controls">
    <input
      type="text"
      placeholder="Search marketplace"
      value={model.marketplaceQuery}
      oninput={(event) => (model.marketplaceQuery = inputValue(event))}
    />
    <Select
      ariaLabel="Filter marketplace"
      value={model.marketplaceFilter}
      options={MARKETPLACE_FILTER_OPTIONS}
      onchange={(value) => (model.marketplaceFilter = value as MarketplaceFilter)}
    />
  </div>

  <div class="catalog-manager">
    <div class="catalog-manager-head">
      <span>Catalogs</span>
      {#if model.canOperate}
        <Button
          size="sm"
          disabled={model.catalogBusy}
          onclick={() =>
            model.showAddCatalog ? model.resetAddCatalog() : (model.showAddCatalog = true)}
        >
          {model.showAddCatalog ? 'Cancel' : '+ Add catalog'}
        </Button>
      {/if}
    </div>

    {#each data.marketplace.catalogs ?? [] as catalog (catalog.source)}
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
        {#if model.canOperate && catalog.userAdded}
          <Button
            variant="ghost"
            tone="danger"
            size="sm"
            title={catalog.fingerprint ? `Pinned key ${catalog.fingerprint}` : 'Remove catalog'}
            disabled={model.catalogBusy}
            onclick={() => void model.removeCatalog(catalog.source, catalog.name)}
          >
            Remove
          </Button>
        {/if}
      </div>
    {/each}

    {#if model.canOperate && model.showAddCatalog}
      <div class="catalog-add">
        <div class="catalog-add-row">
          <TextInput
            bind:value={model.catalogSourceDraft}
            placeholder="https://example.com/catalog.json"
            ariaLabel="Catalog URL"
            onkeydown={(event) => event.key === 'Enter' && void model.previewCatalog()}
          />
          <Button
            disabled={model.catalogBusy || !model.catalogSourceDraft.trim()}
            onclick={() => void model.previewCatalog()}
          >
            {model.catalogBusy ? 'Checking...' : 'Fetch'}
          </Button>
        </div>

        {#if model.catalogPreview}
          {#if model.alreadyConfigured(model.catalogPreview.source)}
            <div class="catalog-preview catalog-preview-bad">
              <div class="catalog-preview-title">Already configured</div>
              <div class="catalog-preview-fact">
                This catalog is already active, so there is nothing to add.
              </div>
            </div>
          {:else if model.catalogPreview.signatureVerified}
            <div class="catalog-preview">
              <div class="catalog-preview-title">
                {model.catalogPreview.name ?? model.catalogPreview.source} · {pluralize(
                  model.catalogPreview.entryCount,
                  'entry',
                  'entries',
                )}
              </div>
              <div class="catalog-preview-fact">
                <span>Signed by</span>
                <code>{model.catalogPreview.keyId ?? 'unknown key'}</code>
              </div>
              <div class="catalog-preview-fact">
                <span>SHA-256</span>
                <code>{model.catalogPreview.fingerprint}</code>
              </div>
              <div class="catalog-preview-warn">
                Verify this fingerprint with the publisher before trusting it. The key is pinned, so
                a later change will make this catalog fail instead of loading silently.
              </div>
              {#if model.canOperate}
                <Button
                  variant="primary"
                  disabled={model.catalogBusy}
                  onclick={() => void model.trustCatalog()}
                >
                  Trust and add
                </Button>
              {/if}
            </div>
          {:else}
            <div class="catalog-preview catalog-preview-bad">
              <div class="catalog-preview-title">Cannot add this catalog</div>
              <div class="catalog-preview-fact">{model.catalogPreview.problem}</div>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
  <div class="list">
    {#each model.marketplaceEntries as entry}
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
            {#if model.entryCatalogLabel(entry)}
              <span class="entry-catalog" title={entry.catalogSource}
                >{model.entryCatalogLabel(entry)}</span
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
          disabled={model.canOperate && model.marketplaceActionDisabled(entry)}
          onclick={() => model.requestMarketplaceAction(entry)}
        >
          {model.marketplaceAction === marketplaceActionKey(entry)
            ? 'Working...'
            : model.canOperate
              ? marketplaceActionLabel(entry)
              : 'Review'}
        </Button>
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

  .item-main {
    min-width: 0;
    flex: 1;
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
  .error-line {
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

  .marketplace-registry {
    margin: -4px 0 10px;
    overflow-wrap: anywhere;
  }
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
  input[type='text'] {
    min-width: 0;
    width: 100%;
    background: var(--bg-inset);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    padding: 8px 9px;
    color: var(--text-primary);
    font-size: var(--text-md);
  }

  .empty-msg {
    padding: 30px 10px;
    text-align: center;
    font-size: var(--text-md);
    color: rgba(122, 133, 153, 0.82);
  }

  @media (max-width: 640px) {
    .marketplace-controls {
      grid-template-columns: 1fr;
    }
  }
</style>
