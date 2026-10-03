import { randomUUID, createHash } from 'node:crypto';
import type { WSMessage, Anomaly, CrashDiagnostic } from '../types.js';
import {
  DEFAULT_WEBHOOK_EVENTS,
  WEBHOOK_EVENTS,
  defaultWebhookScope,
  type WebhookSelection,
} from '../shared/webhooks.js';
import type { WebhookAlert } from './webhookEvents.js';

type WebhookFormat = 'json' | 'slack' | 'discord';
export interface WebhookConfig extends Partial<WebhookSelection> {
  url: string;
  format: WebhookFormat;
}

export function readWebhookConfig(env: NodeJS.ProcessEnv): WebhookConfig | null {
  const raw = env.DOCKSCOPE_WEBHOOK_URL?.trim();
  if (!raw) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DOCKSCOPE_WEBHOOK_URL must be an absolute HTTP or HTTPS URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('DOCKSCOPE_WEBHOOK_URL must use HTTP(S), without credentials or a fragment');
  }
  const format = env.DOCKSCOPE_WEBHOOK_FORMAT?.trim() || 'json';
  if (format !== 'json' && format !== 'slack' && format !== 'discord') {
    throw new Error('DOCKSCOPE_WEBHOOK_FORMAT must be json, slack, or discord');
  }
  const selection = parseWebhookSelection({
    events:
      env.DOCKSCOPE_WEBHOOK_EVENTS === undefined
        ? undefined
        : env.DOCKSCOPE_WEBHOOK_EVENTS.split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    scope: parseScopeEnv(env.DOCKSCOPE_WEBHOOK_SCOPE),
  });
  return { url: raw, format, ...selection };
}

function parseScopeEnv(raw: string | undefined): unknown {
  if (raw === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('DOCKSCOPE_WEBHOOK_SCOPE must be a JSON scope object');
  }
}

export function parseWebhookSelection(input: {
  events?: unknown;
  scope?: unknown;
}): WebhookSelection {
  const events = input.events === undefined ? DEFAULT_WEBHOOK_EVENTS : input.events;
  if (
    !Array.isArray(events) ||
    events.length > WEBHOOK_EVENTS.length ||
    events.some((e) => !WEBHOOK_EVENTS.some((option) => option.value === e))
  ) {
    throw new Error('Invalid webhook event selection');
  }
  const scope = input.scope === undefined ? defaultWebhookScope() : input.scope;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('Invalid webhook scope');
  }
  const record = scope as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['sources', 'projects', 'workloads'].includes(key))) {
    throw new Error('Invalid webhook scope field');
  }
  const valid = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 512;
  const sources = record.sources === undefined ? [] : record.sources;
  const projects = record.projects === undefined ? [] : record.projects;
  const workloads = record.workloads === undefined ? [] : record.workloads;
  if (
    ![sources, projects, workloads].every((v) => Array.isArray(v) && v.length <= 512) ||
    !(sources as unknown[]).every(valid) ||
    !(projects as unknown[]).every(
      (v) =>
        v &&
        typeof v === 'object' &&
        'sourceId' in v &&
        valid(v.sourceId) &&
        'project' in v &&
        valid(v.project),
    ) ||
    !(workloads as unknown[]).every(
      (v) =>
        v &&
        typeof v === 'object' &&
        'sourceId' in v &&
        valid(v.sourceId) &&
        'entityId' in v &&
        valid(v.entityId),
    )
  ) {
    throw new Error('Invalid webhook scope selections');
  }
  return {
    events: [...new Set(events)],
    scope: {
      sources: [...new Set(sources as string[])],
      projects: (projects as { sourceId: string; project: string }[]).map(
        ({ sourceId, project }) => ({ sourceId, project }),
      ),
      workloads: (workloads as { sourceId: string; entityId: string }[]).map(
        ({ sourceId, entityId }) => ({ sourceId, entityId }),
      ),
    },
  };
}

type Alert = WebhookAlert;

function alertText(alert: Alert): string {
  if (alert.type === 'transition') {
    return `DockScope: ${alert.data.message}\nSource: ${alert.sourceId}${alert.workload ? `; workload: ${alert.workload.entityId}` : ''}`;
  }
  const data = alert.data;
  const heading = `DockScope: ${data.containerName} (${data.containerId})\nSource: ${alert.sourceId}`;
  if (alert.type === 'anomaly') {
    const a = alert.data;
    return `${heading}\n${a.metric.toUpperCase()} anomaly: ${a.value.toFixed(1)}% (average ${a.average.toFixed(1)}%, threshold ${a.threshold.toFixed(1)}%)`;
  }
  const d = alert.data;
  return `${heading}\nCrash: ${d.cause}\nExit code: ${d.exitCode}; OOM killed: ${d.oomKilled ? 'yes' : 'no'}`;
}

function payload(alert: Alert, format: WebhookFormat, id: string): unknown {
  if (format === 'json') {
    return { version: alert.type === 'transition' ? 2 : 1, app: 'dockscope', id, ...alert };
  }
  const text = alertText(alert).slice(0, 1900);
  if (format === 'discord') {
    return { content: text, allowed_mentions: { parse: [] } };
  }
  return {
    text: text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    blocks: [{ type: 'section', text: { type: 'plain_text', text } }],
    unfurl_links: false,
    unfurl_media: false,
  };
}

const MAX_PENDING = 100;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 30_000;

/** Best-effort, instance-owned delivery. Never waits in the monitor's broadcast path. */
export class WebhookNotifier {
  private queue: { id: string; body: string }[] = [];
  private running: Promise<void> | null = null;
  private controller = new AbortController();
  private seen = new Map<string, number>();
  private cooldowns = new Map<
    string,
    { until: number; last: string; pending?: Alert; timer?: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly config: WebhookConfig | null,
    private readonly dependencies: {
      fetch?: typeof fetch;
      warn?: (message: string) => void;
    } = {},
  ) {}

  // Legacy entry point retained for callers with anomaly/diagnostic messages.
  notify(message: WSMessage): void {
    if (message.type !== 'anomaly' && message.type !== 'diagnostic') {
      return;
    }
    if (message.type === 'anomaly') {
      const data = message.data as Anomaly;
      this.notifyAlert({
        type: 'anomaly',
        data,
        family: data.metric,
        eventType: `anomaly.${data.metric}`,
        time: data.time,
        sourceId: 'local',
      });
    } else {
      const data = message.data as CrashDiagnostic;
      this.notifyAlert({
        type: 'diagnostic',
        data,
        family: 'crash',
        eventType: 'crash',
        time: data.time,
        sourceId: 'local',
      });
    }
  }

  notifyAlert(alert: Alert): void {
    if (!this.config || this.controller.signal.aborted) {
      return;
    }
    const { events, scope } = parseWebhookSelection(this.config);
    if (
      !events.includes(alert.family) ||
      (scope.sources.length && !scope.sources.includes(alert.sourceId))
    ) {
      return;
    }
    if (alert.family !== 'connectivity') {
      if (
        scope.projects.length &&
        !scope.projects.some(
          (p) => p.sourceId === alert.sourceId && p.project === alert.workload?.project,
        )
      ) {
        return;
      }
      if (
        scope.workloads.length &&
        !scope.workloads.some(
          (w) => w.sourceId === alert.sourceId && w.entityId === alert.workload?.entityId,
        )
      ) {
        return;
      }
    }
    const subject = JSON.stringify([alert.sourceId, alert.workload?.entityId ?? null]);
    const identity = createHash('sha256')
      .update(JSON.stringify([subject, alert.eventType, alert.time, alert.data]))
      .digest('hex');
    const now = Date.now();
    for (const [key, time] of this.seen) {
      if (now - time >= 60_000 || this.seen.size >= 2048) {
        this.seen.delete(key);
      }
    }
    if (this.seen.has(identity)) {
      return;
    }
    this.seen.set(identity, now);
    // Terminal lifecycle and diagnostics are correlated before entering this notifier.
    if (
      alert.type === 'transition' &&
      alert.eventType === 'lifecycle.stopped' &&
      alert.data.crash &&
      events.includes('crash')
    ) {
      return;
    }
    if (alert.family === 'health' || alert.family === 'connectivity') {
      const key = JSON.stringify([subject, alert.family]);
      const entry = this.cooldowns.get(key);
      if (entry && now < entry.until) {
        entry.pending = alert;
        entry.timer ??= setTimeout(() => {
          entry.timer = undefined;
          const pending = entry.pending;
          entry.pending = undefined;
          if (pending && pending.eventType !== entry.last) {
            entry.last = pending.eventType;
            entry.until = Date.now() + 30_000;
            this.enqueue(pending);
          }
        }, entry.until - now);
        return;
      }
      if (!entry && this.cooldowns.size >= 512) {
        const first = this.cooldowns.keys().next().value!;
        clearTimeout(this.cooldowns.get(first)?.timer);
        this.cooldowns.delete(first);
      }
      this.cooldowns.set(key, { until: now + 30_000, last: alert.eventType });
    }
    this.enqueue(alert);
  }

  private enqueue(message: Alert): void {
    if (!this.config || this.controller.signal.aborted) {
      return;
    }
    if (this.queue.length >= MAX_PENDING) {
      this.warn('queue full; dropping newest alert');
      return;
    }
    const id = randomUUID();
    const body = JSON.stringify(payload(message as Alert, this.config.format, id)).replaceAll(
      this.config.url,
      '[REDACTED]',
    );
    if (Buffer.byteLength(body) > MAX_PAYLOAD_BYTES) {
      this.warn('payload exceeds 256 KiB; dropping alert');
      return;
    }
    this.queue.push({ id, body });
    this.startDelivery();
  }

  async stop(): Promise<void> {
    for (const entry of this.cooldowns.values()) {
      clearTimeout(entry.timer);
    }
    this.cooldowns.clear();
    this.seen.clear();
    this.queue = [];
    this.controller.abort();
    await this.running;
  }

  private warn(message: string): void {
    (this.dependencies.warn ?? console.warn)(`Webhook delivery: ${message}`);
  }

  private startDelivery(): void {
    this.running ??= this.drain().finally(() => {
      this.running = null;
      // A notification can arrive between drain finishing and this callback.
      if (this.queue.length && !this.controller.signal.aborted) {
        this.startDelivery();
      }
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length && !this.controller.signal.aborted) {
      const next = this.queue.shift()!;
      await this.deliver(next);
    }
  }

  private async deliver(item: { id: string; body: string }): Promise<void> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let delay = 1000 * 2 ** attempt;
      let failure = 'request failed or timed out';
      try {
        const response = await (this.dependencies.fetch ?? fetch)(this.config!.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-DockScope-Event-Id': item.id },
          body: item.body,
          redirect: 'error',
          signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(TIMEOUT_MS)]),
        });
        // Do not retain or log response bodies, which may echo credentials.
        await response.body?.cancel();
        if (response.ok) {
          return;
        }
        failure = `HTTP ${response.status}`;
        if (response.status !== 429 && response.status < 500) {
          this.warn(`${failure}; dropping alert`);
          return;
        }
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const seconds = Number(retryAfter);
          const wait = Number.isFinite(seconds)
            ? seconds * 1000
            : Date.parse(retryAfter) - Date.now();
          if (Number.isFinite(wait)) {
            delay = Math.max(delay, wait);
          }
        }
      } catch {
        // Deliberately omit exception text and the URL: webhook URLs contain secrets.
      }
      if (this.controller.signal.aborted) {
        return;
      }
      if (attempt === MAX_ATTEMPTS - 1 || delay > MAX_RETRY_DELAY_MS) {
        this.warn(`${failure}; dropping alert`);
        return;
      }
      await this.wait(delay);
      if (this.controller.signal.aborted) {
        return;
      }
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.controller.signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.controller.signal.addEventListener('abort', finish, { once: true });
    });
  }
}
