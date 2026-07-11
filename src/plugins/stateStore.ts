import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';

export interface PluginPersistedRuntimeState {
  enabled: boolean;
  quarantined?: boolean;
  quarantineReason?: string;
  crashCount?: number;
  lastCrashAt?: number;
  lastCrashError?: string;
  quarantinedAt?: number;
  recentCrashTimes?: readonly number[];
}

type StoredPluginState = Record<string, Partial<PluginPersistedRuntimeState>>;

export interface PluginStateStore {
  loadRuntimeState(pluginId: string): Promise<PluginPersistedRuntimeState>;
  loadEnabled(pluginId: string): Promise<boolean>;
  saveEnabled(pluginId: string, enabled: boolean): Promise<void>;
  saveRuntimeState(pluginId: string, state: PluginPersistedRuntimeState): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStoredState(raw: unknown): StoredPluginState {
  if (!isRecord(raw)) {
    throw new Error('Plugin state must be an object');
  }
  const stored: StoredPluginState = {};
  for (const [pluginId, state] of Object.entries(raw)) {
    if (!isRecord(state)) {
      throw new Error(`Plugin state entry must be an object: ${pluginId}`);
    }
    stored[pluginId] = {
      ...(typeof state.enabled === 'boolean' ? { enabled: state.enabled } : {}),
      ...(typeof state.quarantined === 'boolean' ? { quarantined: state.quarantined } : {}),
      ...(typeof state.quarantineReason === 'string'
        ? { quarantineReason: state.quarantineReason }
        : {}),
      ...(typeof state.crashCount === 'number' && Number.isFinite(state.crashCount)
        ? { crashCount: state.crashCount }
        : {}),
      ...(typeof state.lastCrashAt === 'number' && Number.isFinite(state.lastCrashAt)
        ? { lastCrashAt: state.lastCrashAt }
        : {}),
      ...(typeof state.lastCrashError === 'string' ? { lastCrashError: state.lastCrashError } : {}),
      ...(typeof state.quarantinedAt === 'number' && Number.isFinite(state.quarantinedAt)
        ? { quarantinedAt: state.quarantinedAt }
        : {}),
      ...(Array.isArray(state.recentCrashTimes)
        ? {
            recentCrashTimes: state.recentCrashTimes.filter(
              (time): time is number => typeof time === 'number' && Number.isFinite(time),
            ),
          }
        : {}),
    };
  }
  return stored;
}

export class JsonPluginStateStore implements PluginStateStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async loadRuntimeState(pluginId: string): Promise<PluginPersistedRuntimeState> {
    const state = (await this.readAll())[pluginId];
    return {
      enabled: state?.enabled ?? true,
      quarantined: state?.quarantined === true,
      quarantineReason: state?.quarantineReason,
      crashCount: state?.crashCount,
      lastCrashAt: state?.lastCrashAt,
      lastCrashError: state?.lastCrashError,
      quarantinedAt: state?.quarantinedAt,
      recentCrashTimes: state?.recentCrashTimes,
    };
  }

  async loadEnabled(pluginId: string): Promise<boolean> {
    return (await this.loadRuntimeState(pluginId)).enabled;
  }

  async saveEnabled(pluginId: string, enabled: boolean): Promise<void> {
    await this.enqueueWrite(async () => {
      const stored = await this.readAll();
      stored[pluginId] = { ...(stored[pluginId] ?? {}), enabled };
      await this.writeAll(stored);
    });
  }

  async saveRuntimeState(pluginId: string, state: PluginPersistedRuntimeState): Promise<void> {
    await this.enqueueWrite(async () => {
      const stored = await this.readAll();
      stored[pluginId] = { ...state };
      await this.writeAll(stored);
    });
  }

  private async enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.catch(() => undefined);
    await next;
  }

  private async writeAll(stored: StoredPluginState): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const tempDir = await mkdtemp(path.join(directory, '.plugin-state-'));
    const tempPath = path.join(tempDir, path.basename(this.filePath));
    try {
      await writeFile(tempPath, JSON.stringify(stored, null, 2), 'utf-8');
      await rename(tempPath, this.filePath);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async readAll(): Promise<StoredPluginState> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, 'utf-8');
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return {};
      }
      throw error;
    }
    try {
      return normalizeStoredState(JSON.parse(contents) as unknown);
    } catch (error) {
      throw new Error(`Plugin state file is invalid: ${this.filePath}`, { cause: error });
    }
  }
}

export function createPluginStateStoreFromEnv(env: NodeJS.ProcessEnv): PluginStateStore {
  return new JsonPluginStateStore(
    env.DOCKSCOPE_PLUGIN_STATE || path.join(homedir(), '.dockscope', 'plugin-state.json'),
  );
}
