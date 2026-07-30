export interface PluginEvent {
  id: string;
  pluginId: string;
  type: string;
  payload: unknown;
  time: number;
}

export interface PluginEventFilter {
  pluginId?: string;
  type?: string;
  since?: number;
  limit?: number;
}

const EVENT_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.:-]*$/;

export class PluginEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginEventError';
  }
}

export class PluginEventBus {
  private readonly events: PluginEvent[] = [];
  private nextId = 1;

  constructor(
    private readonly maxEvents = 500,
    initialEvents: readonly PluginEvent[] = [],
  ) {
    this.events = [...initialEvents]
      .sort((a, b) => b.time - a.time)
      .slice(0, maxEvents)
      .map((event) => ({ ...event }));
  }

  publish(pluginId: string, type: string, payload: unknown): PluginEvent {
    if (!EVENT_TYPE_PATTERN.test(type)) {
      throw new PluginEventError(`Invalid plugin event type: ${type}`);
    }
    const event: PluginEvent = {
      id: `${Date.now()}-${this.nextId++}`,
      pluginId,
      type,
      payload,
      time: Date.now(),
    };
    this.events.unshift(event);
    if (this.events.length > this.maxEvents) {
      this.events.length = this.maxEvents;
    }
    return event;
  }

  list(filter: PluginEventFilter = {}): PluginEvent[] {
    const limit =
      filter.limit && Number.isFinite(filter.limit)
        ? Math.max(1, Math.min(1000, Math.floor(filter.limit)))
        : undefined;
    return this.events
      .filter((event) => !filter.pluginId || event.pluginId === filter.pluginId)
      .filter((event) => !filter.type || event.type === filter.type)
      .filter((event) => filter.since === undefined || event.time >= filter.since!)
      .slice(0, limit)
      .map((event) => ({ ...event }));
  }
}
