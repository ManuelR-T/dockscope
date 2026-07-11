import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { JsonPluginStateStore } from '../stateStore';

describe('JsonPluginStateStore', () => {
  it('persists quarantine state and preserves it across enabled-only updates', async () => {
    const filePath = path.join(
      await mkdtemp(path.join(tmpdir(), 'dockscope-state-')),
      'state.json',
    );
    const store = new JsonPluginStateStore(filePath);

    await store.saveRuntimeState('plugin.unstable', {
      enabled: false,
      quarantined: true,
      quarantineReason: '3 crashes within 60s',
      crashCount: 3,
      lastCrashAt: 1000,
      lastCrashError: 'boom',
      quarantinedAt: 1000,
      recentCrashTimes: [800, 900, 1000],
    });

    await expect(
      new JsonPluginStateStore(filePath).loadRuntimeState('plugin.unstable'),
    ).resolves.toEqual({
      enabled: false,
      quarantined: true,
      quarantineReason: '3 crashes within 60s',
      crashCount: 3,
      lastCrashAt: 1000,
      lastCrashError: 'boom',
      quarantinedAt: 1000,
      recentCrashTimes: [800, 900, 1000],
    });

    await store.saveEnabled('plugin.unstable', true);
    await expect(store.loadRuntimeState('plugin.unstable')).resolves.toMatchObject({
      enabled: true,
      quarantined: true,
      crashCount: 3,
    });
  });

  it('fails closed when persisted runtime state is corrupt', async () => {
    const filePath = path.join(
      await mkdtemp(path.join(tmpdir(), 'dockscope-state-corrupt-')),
      'state.json',
    );
    await writeFile(filePath, '{invalid', 'utf-8');

    await expect(new JsonPluginStateStore(filePath).loadEnabled('plugin.unstable')).rejects.toThrow(
      'Plugin state file is invalid',
    );
  });
});
