import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PLUGIN_CATALOG_FORMAT } from '../catalog';
import { loadAggregatedPluginCatalogs, findAggregatedEntry } from '../catalogAggregate';

async function writeCatalog(
  dir: string,
  file: string,
  name: string,
  entryIds: readonly string[],
): Promise<string> {
  const catalogPath = path.join(dir, file);
  await writeFile(
    catalogPath,
    JSON.stringify({
      format: PLUGIN_CATALOG_FORMAT,
      name,
      entries: entryIds.map((id) => ({
        id,
        name: id,
        version: '1.0.0',
        capabilities: ['ui.command'],
        permissions: [],
        packageUrl: `./${id}.dockscope-plugin`,
        packageSha256: 'a'.repeat(64),
      })),
    }),
    'utf-8',
  );
  return catalogPath;
}

// The official catalog is disabled throughout so these stay offline and
// deterministic; the merging behaviour is independent of which source is first.
describe('aggregated plugin catalogs', () => {
  it('merges entries from several catalogs and records provenance', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dockscope-aggregate-'));
    const first = await writeCatalog(dir, 'a.json', 'Acme Plugins', ['acme.one']);
    const second = await writeCatalog(dir, 'b.json', 'Other Plugins', ['other.two']);

    const aggregated = await loadAggregatedPluginCatalogs({
      source: `${first},${second}`,
      disableOfficial: true,
    });

    expect(aggregated.catalogs.map((catalog) => catalog.name)).toEqual([
      'Acme Plugins',
      'Other Plugins',
    ]);
    expect(aggregated.entries.map((item) => item.entry.id)).toEqual(['acme.one', 'other.two']);
    expect(findAggregatedEntry(aggregated, 'other.two')).toMatchObject({
      source: second,
      catalogName: 'Other Plugins',
      official: false,
    });
  });

  it('keeps the first catalog when an id appears twice', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dockscope-aggregate-dup-'));
    const first = await writeCatalog(dir, 'a.json', 'First', ['shared.plugin']);
    const second = await writeCatalog(dir, 'b.json', 'Second', ['shared.plugin']);

    const aggregated = await loadAggregatedPluginCatalogs({
      source: `${first},${second}`,
      disableOfficial: true,
    });

    expect(aggregated.entries).toHaveLength(1);
    expect(aggregated.entries[0]).toMatchObject({ source: first, catalogName: 'First' });
    expect(aggregated.shadowedIds).toEqual(['shared.plugin']);
  });

  it('isolates a failing catalog so the others still load', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dockscope-aggregate-fail-'));
    const good = await writeCatalog(dir, 'good.json', 'Good', ['good.plugin']);
    const missing = path.join(dir, 'does-not-exist.json');

    const aggregated = await loadAggregatedPluginCatalogs({
      source: `${missing},${good}`,
      disableOfficial: true,
    });

    expect(aggregated.entries.map((item) => item.entry.id)).toEqual(['good.plugin']);
    const failed = aggregated.catalogs.find((catalog) => catalog.source === missing);
    expect(failed?.error).toBeTruthy();
    expect(failed?.entryCount).toBe(0);
    expect(aggregated.catalogs.find((catalog) => catalog.source === good)?.error).toBeUndefined();
  });

  it('returns no catalogs when everything is disabled', async () => {
    const aggregated = await loadAggregatedPluginCatalogs({ disableOfficial: true });

    expect(aggregated.catalogs).toEqual([]);
    expect(aggregated.entries).toEqual([]);
  });
});
