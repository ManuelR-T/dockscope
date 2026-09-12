import { render } from 'svelte/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessRole } from '../../../core/access';
import type { PluginCommand } from '../../../core/plugin-contract/commands';
import { validatePluginManifest } from '../../../core/plugin-contract/manifest';
import type { PluginMarketplaceEntry } from '../../../plugins/marketplace';
import { PluginManagerData } from '../../components/plugins/data.svelte';
import { InstalledPluginsModel } from '../../components/plugins/installed.svelte';
import { MarketplaceModel } from '../../components/plugins/marketplace.svelte';
import MarketplaceReview from '../../components/plugins/MarketplaceReview.svelte';
import PluginMarketplace from '../../components/plugins/PluginMarketplace.svelte';
import InstalledPlugins from '../../components/plugins/InstalledPlugins.svelte';
import { getJson, postJson, requestJson } from '../api';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getJson: vi.fn(),
  postJson: vi.fn(),
  requestJson: vi.fn(),
  deleteJson: vi.fn(),
}));
vi.mock('../../stores/toast.svelte', () => ({ addToast: vi.fn() }));

function entry(overrides: Partial<PluginMarketplaceEntry> = {}): PluginMarketplaceEntry {
  return {
    id: 'test.plugin',
    name: 'Test plugin',
    version: '1.0.0',
    status: 'active',
    state: 'available',
    updateAvailable: false,
    compatibilityWarnings: [],
    screenshots: [],
    tags: [],
    capabilities: [],
    permissions: [],
    ...overrides,
  };
}

const command: PluginCommand = {
  pluginId: 'test.plugin',
  id: 'hello',
  title: 'Hello',
  input: { fields: [{ key: 'name', label: 'Name', type: 'string', default: 'World' }] },
};

beforeEach(() => vi.resetAllMocks());

describe('plugin manager models', () => {
  it('renders expanded installed-plugin details with their current command drafts', () => {
    const data = new PluginManagerData();
    const model = new InstalledPluginsModel(data, () => 'operator');
    data.plugins = [
      {
        manifest: validatePluginManifest({
          id: 'test.plugin',
          name: 'Test plugin',
          version: '1.0.0',
          dockscopeApiVersion: '1',
          capabilities: ['ui.command'],
          permissions: [],
        }),
        registeredAt: 0,
        crashCount: 0,
        enabled: true,
        status: 'started',
      },
    ];
    data.commands = [command];
    model.setCommandInputValue(command, 'name', 'Manuel');
    model.toggleExpanded('test.plugin');
    const html = render(InstalledPlugins, { props: { data, model, role: 'operator' } }).body;
    expect(html).toContain('Test plugin');
    expect(html).toContain('Hello');
    expect(html).toContain('Manuel');
    expect(html).toContain('Reload');
  });

  it('refreshes the shared snapshot while retaining command drafts', async () => {
    const data = new PluginManagerData();
    data.commandDrafts = { 'test.plugin:hello': { name: 'Manuel' } };
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url.endsWith('/marketplace')) {
        return new PluginManagerData().marketplace;
      }
      if (url.endsWith('/commands')) {
        return [command];
      }
      if (url.endsWith('/config')) {
        return [{ pluginId: 'test.plugin', values: { enabled: false } }];
      }
      return [];
    });
    await data.loadPluginState();
    expect(getJson).toHaveBeenCalledTimes(12);
    expect(data.loading).toBe(false);
    expect(data.drafts).toEqual({ 'test.plugin': { enabled: false } });
    expect(data.commandDrafts['test.plugin:hello']).toEqual({ name: 'Manuel' });
  });

  it('keeps the previous snapshot if a full refresh fails', async () => {
    const data = new PluginManagerData();
    data.commands = [command];
    vi.mocked(getJson).mockRejectedValue(new Error('offline'));
    await data.loadPluginState();
    expect(data.loading).toBe(false);
    expect(data.commands).toEqual([command]);
  });

  it('health polling leaves form drafts and marketplace selection alone', async () => {
    const data = new PluginManagerData();
    const installed = new InstalledPluginsModel(data, () => 'operator');
    const marketplace = new MarketplaceModel(data, () => 'operator');
    installed.expanded = 'test.plugin';
    data.secretDrafts = { 'test.plugin': { token: 'unsaved' } };
    marketplace.requestMarketplaceAction(entry());
    marketplace.marketplaceQuery = 'test';
    vi.mocked(getJson).mockResolvedValue([]);
    await data.refreshRuntimeHealth();
    expect(installed.expanded).toBe('test.plugin');
    expect(data.secretDrafts['test.plugin'].token).toBe('unsaved');
    expect(marketplace.marketplaceReview?.entry.id).toBe('test.plugin');
    expect(marketplace.marketplaceQuery).toBe('test');
  });

  it('uses the current role for mutation guards, even after the models were created', async () => {
    let role: AccessRole = 'operator';
    const data = new PluginManagerData();
    const installed = new InstalledPluginsModel(data, () => role);
    const marketplace = new MarketplaceModel(data, () => role);
    role = 'reader';
    marketplace.catalogSourceDraft = 'https://example.com/catalog.json';
    await installed.runCommand(command);
    await marketplace.previewCatalog();
    marketplace.requestMarketplaceAction(entry());
    await marketplace.confirmMarketplaceReview();
    expect(requestJson).not.toHaveBeenCalled();
    expect(postJson).not.toHaveBeenCalled();
    expect(marketplace.marketplaceReview).not.toBeNull();
    expect(installed.canOperate).toBe(false);
  });

  it('preserves false and zero inputs and saves only declared configuration fields', async () => {
    const data = new PluginManagerData();
    const model = new InstalledPluginsModel(data, () => 'operator');
    data.configs = [
      {
        pluginId: 'test.plugin',
        values: {},
        schema: {
          fields: [
            { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
            { key: 'count', label: 'Count', type: 'number', default: 10 },
          ],
        },
      },
    ];
    data.drafts = { 'test.plugin': { enabled: false, count: 0, undeclared: 'ignore' } };
    vi.mocked(requestJson).mockResolvedValue({
      ...data.configs[0],
      values: { enabled: false, count: 0 },
    });
    await model.saveConfig('test.plugin');
    expect(requestJson).toHaveBeenCalledWith(
      '/api/plugins/test.plugin/config',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ enabled: false, count: 0 }),
      }),
    );
    expect(model.saving).toBeNull();
  });

  it('releases the busy state when an action fails', async () => {
    const data = new PluginManagerData();
    const model = new InstalledPluginsModel(data, () => 'operator');
    vi.mocked(requestJson).mockRejectedValue(new Error('offline'));
    await model.runCommand(command);
    expect(model.runningCommand).toBeNull();
  });

  it('filters marketplace entries using the current query and filter', () => {
    const data = new PluginManagerData();
    const model = new MarketplaceModel(data, () => 'operator');
    data.marketplace.entries = [
      entry(),
      entry({ id: 'other.plugin', name: 'Other', state: 'installed' }),
    ];
    expect(model.marketplaceEntries).toHaveLength(2);
    model.marketplaceQuery = 'OTHER';
    expect(model.marketplaceEntries.map((item) => item.id)).toEqual(['other.plugin']);
    model.marketplaceFilter = 'available';
    expect(model.marketplaceEntries).toEqual([]);
  });

  it('requires a verified preview before trusting a catalog', async () => {
    const model = new MarketplaceModel(new PluginManagerData(), () => 'operator');
    model.catalogPreview = {
      source: 'https://example.com/catalog.json',
      entryCount: 1,
      signed: true,
      signatureVerified: false,
    };
    await model.trustCatalog();
    expect(postJson).not.toHaveBeenCalled();
  });

  it('renders marketplace review for readers without mutation controls', () => {
    const data = new PluginManagerData();
    const model = new MarketplaceModel(data, () => 'reader');
    data.marketplace = { ...data.marketplace, configured: true, entries: [entry()] };
    expect(render(PluginMarketplace, { props: { data, model } }).body).toContain('Review');
    model.requestMarketplaceAction(entry());
    const html = render(MarketplaceReview, { props: { data, model } }).body;
    expect(html).toContain('Test plugin');
    expect(html).toContain('Cancel');
    expect(html).not.toMatch(/>\s*Install\s*</);
  });
});
