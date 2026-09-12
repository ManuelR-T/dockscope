import type { PluginMarketplaceEntry } from '../../../plugins/marketplace';

export type MarketplaceAction = 'install' | 'update' | 'uninstall';
type MarketplaceTone = 'accent' | 'success' | 'warn' | 'info';

interface StatePresentation {
  label: string;
  tone: MarketplaceTone;
  action: MarketplaceAction;
}

const STATES = {
  available: { label: 'available', tone: 'accent', action: 'install' },
  installed: { label: 'installed', tone: 'success', action: 'uninstall' },
  update_available: { label: 'update', tone: 'warn', action: 'update' },
  local: { label: 'local', tone: 'info', action: 'uninstall' },
} satisfies Record<PluginMarketplaceEntry['state'], StatePresentation>;

export const MARKETPLACE_ACTION_LABELS: Record<MarketplaceAction, string> = {
  install: 'Install',
  update: 'Update',
  uninstall: 'Uninstall',
};

export function marketplaceState(entry: PluginMarketplaceEntry): StatePresentation {
  // Keep the existing fallback for an unfamiliar state received from the server.
  return Object.hasOwn(STATES, entry.state)
    ? STATES[entry.state]
    : { label: entry.state, tone: 'accent', action: 'uninstall' };
}

type EntryPredicate = (entry: PluginMarketplaceEntry) => boolean;
const FILTERS = {
  all: { label: 'All', matches: () => true },
  available: { label: 'Available', matches: (entry) => entry.state === 'available' },
  installed: { label: 'Installed', matches: (entry) => entry.state === 'installed' },
  updates: { label: 'Updates', matches: (entry) => entry.state === 'update_available' },
  local: { label: 'Local', matches: (entry) => entry.state === 'local' },
  deprecated: {
    label: 'Deprecated',
    matches: (entry) => entry.status === 'deprecated' || entry.status === 'yanked',
  },
} satisfies Record<string, { label: string; matches: EntryPredicate }>;

export type MarketplaceFilter = keyof typeof FILTERS;
export const MARKETPLACE_FILTER_OPTIONS = Object.entries(FILTERS).map(([value, { label }]) => ({
  value,
  label,
}));
const filterPredicates = new Map<string, EntryPredicate>(
  Object.entries(FILTERS).map(([key, rule]) => [key, rule.matches]),
);

export function matchesMarketplaceFilter(
  entry: PluginMarketplaceEntry,
  filter: MarketplaceFilter,
): boolean {
  return filterPredicates.get(filter)?.(entry) ?? true;
}
