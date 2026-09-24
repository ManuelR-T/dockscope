import { randomUUID } from 'node:crypto';
import type { Anomaly, CrashDiagnostic, WSMessage } from '../types.js';

type WebhookFormat = 'json' | 'slack' | 'discord';
export interface WebhookConfig {
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
  return { url: raw, format };
}

type Alert = { type: 'anomaly'; data: Anomaly } | { type: 'diagnostic'; data: CrashDiagnostic };

function alertText(alert: Alert): string {
  const data = alert.data;
  const heading = `DockScope: ${data.containerName} (${data.containerId})`;
  if (alert.type === 'anomaly') {
    const a = alert.data;
    return `${heading}\n${a.metric.toUpperCase()} anomaly: ${a.value.toFixed(1)}% (average ${a.average.toFixed(1)}%, threshold ${a.threshold.toFixed(1)}%)`;
  }
  const d = alert.data;
  return `${heading}\nCrash: ${d.cause}\nExit code: ${d.exitCode}; OOM killed: ${d.oomKilled ? 'yes' : 'no'}`;
}

function payload(alert: Alert, format: WebhookFormat, id: string): unknown {
  if (format === 'json') {
    return { version: 1, app: 'dockscope', id, ...alert };
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

  constructor(
    private readonly config: WebhookConfig | null,
    private readonly dependencies: {
      fetch?: typeof fetch;
      warn?: (message: string) => void;
    } = {},
  ) {}

  notify(message: WSMessage): void {
    if (
      !this.config ||
      this.controller.signal.aborted ||
      (message.type !== 'anomaly' && message.type !== 'diagnostic')
    ) {
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
