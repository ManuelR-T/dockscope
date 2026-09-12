import { describe, expect, it } from 'vitest';
import type { PluginMarketplaceEntry } from '../../../plugins/marketplace';
import {
  MARKETPLACE_FILTER_OPTIONS,
  matchesMarketplaceFilter,
  type MarketplaceFilter,
} from '../../components/plugins/marketplacePolicy';
import {
  marketplaceActionLabel,
  marketplaceActionType,
  marketplaceLabel,
  marketplaceStateTone,
} from '../../components/plugins/presentation';
import { defaultFieldValue } from '../../components/plugins/forms';
import type {
  PluginConfigFieldType,
  PluginConfigValue,
} from '../../../core/plugin-contract/config';

function entry(
  state: PluginMarketplaceEntry['state'],
  status: PluginMarketplaceEntry['status'] = 'active',
): PluginMarketplaceEntry {
  return {
    id: 'test.plugin',
    name: 'Test',
    version: '1.0.0',
    state,
    status,
    updateAvailable: false,
    compatibilityWarnings: [],
    screenshots: [],
    tags: [],
    capabilities: [],
    permissions: [],
  };
}

describe('marketplace policy tables', () => {
  it.each([
    ['available', 'available', 'accent', 'install', 'Install'],
    ['installed', 'installed', 'success', 'uninstall', 'Uninstall'],
    ['update_available', 'update', 'warn', 'update', 'Update'],
    ['local', 'local', 'info', 'uninstall', 'Uninstall'],
  ] as const)(
    'maps %s consistently across all presentation helpers',
    (state, label, tone, action, actionLabel) => {
      const item = entry(state);
      expect(marketplaceLabel(item)).toBe(label);
      expect(marketplaceStateTone(item)).toBe(tone);
      expect(marketplaceActionType(item)).toBe(action);
      expect(marketplaceActionLabel(item)).toBe(actionLabel);
    },
  );

  const filterCases: [MarketplaceFilter, PluginMarketplaceEntry['state'][]][] = [
    ['all', ['available', 'installed', 'update_available', 'local']],
    ['available', ['available']],
    ['installed', ['installed']],
    ['updates', ['update_available']],
    ['local', ['local']],
    ['deprecated', []],
  ];
  it.each(filterCases)(
    'matches the %s filter advertised in the selector',
    (filter, expectedStates) => {
      const states = ['available', 'installed', 'update_available', 'local'] as const;
      expect(states.filter((state) => matchesMarketplaceFilter(entry(state), filter))).toEqual(
        expectedStates,
      );
      expect(MARKETPLACE_FILTER_OPTIONS.some((option) => option.value === filter)).toBe(true);
    },
  );

  it.each(['deprecated', 'yanked'] as const)(
    'includes %s entries in the deprecated filter regardless of install state',
    (status) => {
      expect(matchesMarketplaceFilter(entry('available', status), 'deprecated')).toBe(true);
      expect(matchesMarketplaceFilter(entry('installed', status), 'deprecated')).toBe(true);
    },
  );

  it.each(['future-state', 'constructor', '__proto__'])(
    'preserves unknown-value fallbacks for %s without prototype lookups',
    (value) => {
      const item = entry(value as PluginMarketplaceEntry['state']);
      expect(marketplaceLabel(item)).toBe(value);
      expect(marketplaceStateTone(item)).toBe('accent');
      expect(marketplaceActionType(item)).toBe('uninstall');
      expect(matchesMarketplaceFilter(item, value as MarketplaceFilter)).toBe(true);
    },
  );
});

describe('field default table', () => {
  it.each<[PluginConfigFieldType, PluginConfigValue]>([
    ['string', ''],
    ['select', ''],
    ['boolean', false],
    ['number', 0],
  ])('defaults %s fields without overwriting explicit defaults', (type, fallback) => {
    const field = { key: 'value', label: 'Value', type };
    expect(defaultFieldValue(field)).toBe(fallback);
    expect(defaultFieldValue({ ...field, default: false })).toBe(false);
    expect(defaultFieldValue({ ...field, default: 0 })).toBe(0);
    expect(defaultFieldValue({ ...field, default: '' })).toBe('');
  });
});
