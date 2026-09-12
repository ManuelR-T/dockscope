<script lang="ts">
  import { Button, CloseButton } from '../ui';

  import type { PluginManagerData } from './data.svelte';
  import type { MarketplaceModel } from './marketplace.svelte';

  import {
    listText,
    shortFingerprint,
    marketplaceActionLabel,
    marketplaceActionKey,
    marketplaceTrust,
    marketplaceVersionLine,
    marketplaceCompatibility,
  } from './presentation';
  let { data, model }: { data: PluginManagerData; model: MarketplaceModel } = $props();
</script>

{#if model.marketplaceReview}
  <div class="confirm-layer">
    <div class="confirm-box">
      <div class="confirm-header">
        <div>
          <div class="confirm-title">{model.marketplaceReview.entry.name}</div>
          <code>{model.marketplaceReview.entry.id} v{model.marketplaceReview.entry.version}</code>
        </div>
        <CloseButton label="Close review" onclick={() => (model.marketplaceReview = null)} />
      </div>

      <div class="review-grid marketplace-review-grid">
        <div>
          <span class="review-label">Action</span>
          <span>{model.marketplaceReview.action}</span>
        </div>
        <div>
          <span class="review-label">Version</span>
          <span>{marketplaceVersionLine(model.marketplaceReview.entry)}</span>
        </div>
        <div>
          <span class="review-label">Signature</span>
          <span>{marketplaceTrust(model.marketplaceReview.entry)}</span>
        </div>
        <div>
          <span class="review-label">Package</span>
          <code>{shortFingerprint(model.marketplaceReview.entry.packageSha256 ?? 'unsigned')}</code>
        </div>
        <div>
          <span class="review-label">Capabilities</span>
          <span>{listText(model.marketplaceReview.entry.capabilities)}</span>
        </div>
        <div>
          <span class="review-label">Permissions</span>
          <span>{listText(model.marketplaceReview.entry.permissions)}</span>
        </div>
        <div>
          <span class="review-label">Compatibility</span>
          <span>{marketplaceCompatibility(model.marketplaceReview.entry)}</span>
        </div>
        <div>
          <span class="review-label">Registry</span>
          <code>{data.marketplace.registryDir}</code>
        </div>
      </div>

      {#if model.marketplaceReview.action !== 'uninstall' && model.marketplaceReview.entry.permissions.length > 0}
        <div class="grant-note">
          Confirming grants this plugin: {listText(model.marketplaceReview.entry.permissions)}
        </div>
      {/if}

      {#if model.marketplaceReview.entry.releaseNotes}
        <div class="release-notes">{model.marketplaceReview.entry.releaseNotes}</div>
      {/if}

      {#if model.marketplaceReview.entry.screenshots.length > 0}
        <div class="screenshot-strip">
          {#each model.marketplaceReview.entry.screenshots as screenshot}
            <img
              src={screenshot}
              alt={`${model.marketplaceReview.entry.name} screenshot`}
              loading="lazy"
            />
          {/each}
        </div>
      {/if}

      {#if model.marketplaceReview.entry.readme}
        <pre class="readme-preview">{model.marketplaceReview.entry.readme}</pre>
      {:else if model.marketplaceReview.entry.readmeUrl}
        <div class="marketplace-links review-links">
          <a href={model.marketplaceReview.entry.readmeUrl} target="_blank" rel="noreferrer">
            Open README
          </a>
        </div>
      {/if}

      <div class="confirm-actions">
        <Button variant="secondary" onclick={() => (model.marketplaceReview = null)}>Cancel</Button>
        {#if model.canOperate}
          <Button
            variant="primary"
            disabled={model.marketplaceActionDisabled(model.marketplaceReview.entry)}
            onclick={() => void model.confirmMarketplaceReview()}
          >
            {model.marketplaceAction === marketplaceActionKey(model.marketplaceReview.entry)
              ? 'Working...'
              : marketplaceActionLabel(model.marketplaceReview.entry)}
          </Button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  code {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: rgba(122, 133, 153, 0.8);
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

  @media (max-width: 640px) {
    .review-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
