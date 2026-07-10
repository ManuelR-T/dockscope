import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import type { PluginApprovalSnapshot, PluginApprovalWriter } from '../core/plugins.js';

type StoredApprovals = Record<string, PluginApprovalSnapshot>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeApproval(raw: unknown): PluginApprovalSnapshot | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (
    typeof raw.pluginId !== 'string' ||
    typeof raw.fingerprint !== 'string' ||
    typeof raw.approvedAt !== 'number'
  ) {
    return undefined;
  }
  return {
    pluginId: raw.pluginId,
    fingerprint: raw.fingerprint,
    approvedAt: raw.approvedAt,
  };
}

function normalizeApprovals(raw: unknown): StoredApprovals {
  if (!isRecord(raw)) {
    return {};
  }
  const approvals: StoredApprovals = {};
  for (const [pluginId, approval] of Object.entries(raw)) {
    const normalized = normalizeApproval(approval);
    if (normalized && normalized.pluginId === pluginId) {
      approvals[pluginId] = normalized;
    }
  }
  return approvals;
}

export class JsonPluginApprovalStore implements PluginApprovalWriter {
  constructor(private readonly filePath: string) {}

  async load(): Promise<PluginApprovalSnapshot[]> {
    try {
      return Object.values(
        normalizeApprovals(JSON.parse(await readFile(this.filePath, 'utf-8')) as unknown),
      );
    } catch {
      return [];
    }
  }

  async save(approvals: readonly PluginApprovalSnapshot[]): Promise<void> {
    const stored = Object.fromEntries(approvals.map((approval) => [approval.pluginId, approval]));
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(stored, null, 2), 'utf-8');
  }
}

export function createPluginApprovalStoreFromEnv(env: NodeJS.ProcessEnv): JsonPluginApprovalStore {
  return new JsonPluginApprovalStore(
    env.DOCKSCOPE_PLUGIN_APPROVALS || path.join(homedir(), '.dockscope', 'plugin-approvals.json'),
  );
}
