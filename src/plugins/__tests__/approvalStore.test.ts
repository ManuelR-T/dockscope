import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { JsonPluginApprovalStore } from '../approvalStore';

describe('JsonPluginApprovalStore', () => {
  it('persists and reloads approval snapshots', async () => {
    const filePath = path.join(
      await mkdtemp(path.join(tmpdir(), 'dockscope-approvals-')),
      'approvals.json',
    );
    const store = new JsonPluginApprovalStore(filePath);

    await store.save([{ pluginId: 'plugin.demo', fingerprint: 'abc123', approvedAt: 1 }]);

    await expect(new JsonPluginApprovalStore(filePath).load()).resolves.toEqual([
      { pluginId: 'plugin.demo', fingerprint: 'abc123', approvedAt: 1 },
    ]);
  });
});
