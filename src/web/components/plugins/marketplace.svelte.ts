import { apiErrorMessage, deleteJson, postJson, requestJson } from '../../lib/api';
import { addToast } from '../../stores/toast.svelte';

import { allowsUiIntent, type AccessRole } from '../../../core/access';

import { clearPluginFrontendCache } from '../../lib/pluginUi';
import type {
  PluginMarketplaceEntry,
  PluginMarketplaceSnapshot,
} from '../../../plugins/marketplace';
import { marketplaceActionType } from './presentation';
import type { PluginManagerData } from './data.svelte';

type MarketplaceAction = 'install' | 'update' | 'uninstall';
type MarketplaceFilter = 'all' | 'available' | 'installed' | 'updates' | 'local' | 'deprecated';
interface MarketplaceReview {
  entry: PluginMarketplaceEntry;
  action: MarketplaceAction;
}
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

/** Catalog trust, review, and install state shared by the marketplace and its review dialog. */
export class MarketplaceModel {
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

  showAddCatalog = $state(false);
  catalogSourceDraft = $state('');
  catalogPreview = $state<CatalogPreview | null>(null);
  catalogBusy = $state(false);
  marketplaceAction = $state<string | null>(null);
  marketplaceReview = $state<MarketplaceReview | null>(null);
  marketplaceQuery = $state('');
  marketplaceFilter = $state<MarketplaceFilter>('all');
  marketplaceEntries = $derived.by(() =>
    this.data.marketplace.entries.filter((entry) => this.marketplaceEntryMatches(entry)),
  );

  async runMarketplaceAction(entry: PluginMarketplaceEntry, action: MarketplaceAction) {
    const key = `${entry.id}:${action}`;
    if (!this.canOperate || this.marketplaceAction) {
      return;
    }
    this.marketplaceAction = key;
    try {
      const encodedId = encodeURIComponent(entry.id);
      if (action === 'uninstall') {
        this.data.marketplace = await deleteJson<PluginMarketplaceSnapshot>(
          `/api/plugins/marketplace/${encodedId}`,
        );
      } else {
        this.data.marketplace = await requestJson<PluginMarketplaceSnapshot>(
          `/api/plugins/marketplace/${encodedId}/${action}`,
          { method: 'POST' },
        );
      }
      clearPluginFrontendCache(entry.id);
      await this.data.loadPluginState();
      addToast(`${entry.name}: ${action} complete`, 'success');
    } catch (error) {
      const detail = apiErrorMessage(error);
      addToast(`${entry.name}: ${action} failed${detail ? `: ${detail}` : ''}`, 'error');
    } finally {
      this.marketplaceAction = null;
    }
  }

  requestMarketplaceAction(entry: PluginMarketplaceEntry) {
    const action = marketplaceActionType(entry);
    this.marketplaceReview = { entry, action };
  }

  async confirmMarketplaceReview() {
    if (!this.canOperate || !this.marketplaceReview) {
      return;
    }
    const review = this.marketplaceReview;
    this.marketplaceReview = null;
    await this.runMarketplaceAction(review.entry, review.action);
  }

  marketplaceActionDisabled(entry: PluginMarketplaceEntry): boolean {
    const action = marketplaceActionType(entry);
    return (
      !this.canOperate ||
      this.marketplaceAction !== null ||
      entry.status === 'yanked' ||
      (action !== 'uninstall' && entry.compatibilityWarnings.length > 0)
    );
  }

  marketplaceEntryMatches(entry: PluginMarketplaceEntry): boolean {
    const query = this.marketplaceQuery.trim().toLowerCase();
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
    if (this.marketplaceFilter === 'available') {
      return entry.state === 'available';
    }
    if (this.marketplaceFilter === 'installed') {
      return entry.state === 'installed';
    }
    if (this.marketplaceFilter === 'updates') {
      return entry.state === 'update_available';
    }
    if (this.marketplaceFilter === 'local') {
      return entry.state === 'local';
    }
    if (this.marketplaceFilter === 'deprecated') {
      return entry.status === 'deprecated' || entry.status === 'yanked';
    }
    return true;
  }

  catalogTrustText(): string {
    const loaded = (this.data.marketplace.catalogs ?? []).filter((catalog) => !catalog.error);
    if (loaded.length > 1) {
      const signed = loaded.filter((catalog) => catalog.signatureVerified === true).length;
      return `${signed} / ${loaded.length} catalogs signed`;
    }
    if (this.data.marketplace.catalogSignatureVerified === true) {
      return 'catalog signed';
    }
    if (this.data.marketplace.catalogSignatureVerified === false) {
      return 'catalog signature unverified';
    }
    return 'catalog unsigned';
  }

  failedCatalogs() {
    return (this.data.marketplace.catalogs ?? []).filter((catalog) => catalog.error);
  }

  alreadyConfigured(source: string): boolean {
    return (this.data.marketplace.catalogs ?? []).some(
      (catalog) => catalog.source === source.trim(),
    );
  }

  resetAddCatalog() {
    this.showAddCatalog = false;
    this.catalogSourceDraft = '';
    this.catalogPreview = null;
  }

  async previewCatalog() {
    if (!this.canOperate || !this.catalogSourceDraft.trim()) {
      return;
    }
    this.catalogBusy = true;
    this.catalogPreview = null;
    try {
      this.catalogPreview = await postJson<CatalogPreview>('/api/plugins/catalogs/preview', {
        source: this.catalogSourceDraft,
      });
    } catch (error) {
      addToast(apiErrorMessage(error), 'error');
    } finally {
      this.catalogBusy = false;
    }
  }

  async trustCatalog() {
    if (!this.canOperate || !this.catalogPreview?.signatureVerified) {
      return;
    }
    this.catalogBusy = true;
    try {
      this.data.marketplace = await postJson<PluginMarketplaceSnapshot>('/api/plugins/catalogs', {
        source: this.catalogPreview.source,
      });
      addToast(
        `Added catalog ${this.catalogPreview.name ?? this.catalogPreview.source}`,
        'success',
      );
      this.resetAddCatalog();
    } catch (error) {
      addToast(apiErrorMessage(error), 'error');
    } finally {
      this.catalogBusy = false;
    }
  }

  async removeCatalog(source: string, name?: string) {
    if (!this.canOperate) {
      return;
    }
    this.catalogBusy = true;
    try {
      this.data.marketplace = await deleteJson<PluginMarketplaceSnapshot>(
        `/api/plugins/catalogs?source=${encodeURIComponent(source)}`,
      );
      addToast(`Removed catalog ${name ?? source}`, 'success');
    } catch (error) {
      addToast(apiErrorMessage(error), 'error');
    } finally {
      this.catalogBusy = false;
    }
  }

  catalogSummaryText(): string {
    const loaded = (this.data.marketplace.catalogs ?? []).filter((catalog) => !catalog.error);
    if (loaded.length > 1) {
      return `${loaded.length} catalogs`;
    }
    return loaded[0]?.name ?? this.data.marketplace.catalogName ?? 'Local plugins';
  }

  entryCatalogLabel(entry: PluginMarketplaceEntry): string | undefined {
    const loaded = (this.data.marketplace.catalogs ?? []).filter((catalog) => !catalog.error);
    if (loaded.length < 2 || !entry.catalogName) {
      return undefined;
    }
    return entry.catalogName;
  }
}
