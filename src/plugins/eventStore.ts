import { statePath } from '../paths.js';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { PluginEvent } from '../core/plugin-contract/events.js';
import type { PluginEventWriter } from '../core/plugin-contract/manifest.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeEvent(raw: unknown): PluginEvent | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (
    typeof raw.id !== 'string' ||
    typeof raw.pluginId !== 'string' ||
    typeof raw.type !== 'string' ||
    typeof raw.time !== 'number'
  ) {
    return undefined;
  }
  return {
    id: raw.id,
    pluginId: raw.pluginId,
    type: raw.type,
    payload: raw.payload,
    time: raw.time,
  };
}

function normalizeEvents(raw: unknown): PluginEvent[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item) => {
    const event = normalizeEvent(item);
    return event ? [event] : [];
  });
}

export class JsonPluginEventStore implements PluginEventWriter {
  constructor(
    private readonly filePath: string,
    private readonly maxEvents = 500,
  ) {}

  async load(): Promise<PluginEvent[]> {
    try {
      return normalizeEvents(JSON.parse(await readFile(this.filePath, 'utf-8')) as unknown).slice(
        0,
        this.maxEvents,
      );
    } catch {
      return [];
    }
  }

  async save(events: readonly PluginEvent[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify(events.slice(0, this.maxEvents), null, 2),
      'utf-8',
    );
  }
}

export function createPluginEventStoreFromEnv(env: NodeJS.ProcessEnv): JsonPluginEventStore {
  return new JsonPluginEventStore(
    env.DOCKSCOPE_PLUGIN_EVENTS || statePath(env, 'plugin-events.json'),
  );
}
