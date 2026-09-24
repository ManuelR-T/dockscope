import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { statePath } from '../paths.js';
import type { WSMessage } from '../types.js';
import { readWebhookConfig, WebhookNotifier, type WebhookConfig } from './webhooks.js';
import { asyncRoute } from './errors.js';

/** Owns persisted configuration and swaps delivery workers when settings change. */
export class WebhookSettings {
  private notifier: WebhookNotifier;
  private pending: Promise<void> = Promise.resolve();
  private stopped = false;

  private constructor(
    private readonly file: string,
    private config: WebhookConfig | null,
    private readonly managedByEnv: boolean,
  ) {
    this.notifier = new WebhookNotifier(config);
  }

  static async open(env: NodeJS.ProcessEnv): Promise<WebhookSettings> {
    const file = statePath(env, 'webhook.json');
    const configured = readWebhookConfig(env);
    if (configured) {
      return new WebhookSettings(file, configured, true);
    }
    let config: WebhookConfig | null = null;
    try {
      const stored = JSON.parse(await readFile(file, 'utf8'));
      if (stored !== null) {
        if (typeof stored.url !== 'string' || typeof stored.format !== 'string') {
          throw new Error('Invalid stored webhook configuration');
        }
        config = readWebhookConfig({
          DOCKSCOPE_WEBHOOK_URL: stored.url,
          DOCKSCOPE_WEBHOOK_FORMAT: stored.format,
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // JSON parse errors can include the secret URL. Do not expose their cause.
        // eslint-disable-next-line preserve-caught-error
        throw new Error('Could not read webhook.json; check its contents and permissions');
      }
    }
    return new WebhookSettings(file, config, false);
  }

  status() {
    return {
      enabled: this.config !== null,
      managedByEnv: this.managedByEnv,
      format: this.config?.format ?? 'json',
      destination: this.config ? new URL(this.config.url).host : null,
    };
  }

  notify(message: WSMessage): void {
    this.notifier.notify(message);
  }

  update(input: unknown): Promise<void> {
    const operation = this.pending.then(async () => {
      if (this.stopped) {
        throw new Error('Server is shutting down');
      }
      if (this.managedByEnv) {
        throw new Error('Webhook is managed by environment variables');
      }
      let next: WebhookConfig | null = null;
      if (input !== null) {
        if (
          typeof input !== 'object' ||
          !input ||
          !('url' in input) ||
          !('format' in input) ||
          typeof input.url !== 'string' ||
          typeof input.format !== 'string'
        ) {
          throw new Error('Provide a webhook URL and format');
        }
        const url = input.url.trim() || this.config?.url;
        if (!url) {
          throw new Error('A webhook URL is required');
        }
        next = readWebhookConfig({
          DOCKSCOPE_WEBHOOK_URL: url,
          DOCKSCOPE_WEBHOOK_FORMAT: input.format,
        });
      }
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
        await rename(temporary, this.file);
      } finally {
        await rm(temporary, { force: true });
      }
      await this.notifier.stop();
      this.config = next;
      this.notifier = new WebhookNotifier(next);
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.pending;
    await this.notifier.stop();
  }
}

export function setupWebhookRoutes(app: Express, settings: WebhookSettings): void {
  app.get('/api/webhook', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(settings.status());
  });
  for (const method of ['put', 'delete'] as const) {
    app[method](
      '/api/webhook',
      asyncRoute(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (settings.status().managedByEnv) {
          res.status(409).json({
            error: 'Webhook is managed by environment variables. Change it on the server.',
          });
          return;
        }
        try {
          await settings.update(method === 'delete' ? null : req.body);
          res.json(settings.status());
        } catch (error) {
          // Filesystem errors can include paths; only expose our validation messages.
          const message =
            error instanceof Error && !('code' in error)
              ? error.message
                  .replaceAll('DOCKSCOPE_WEBHOOK_URL', 'Webhook URL')
                  .replaceAll('DOCKSCOPE_WEBHOOK_FORMAT', 'Webhook format')
              : 'Could not save webhook settings';
          res
            .status(error instanceof Error && 'code' in error ? 500 : 400)
            .json({ error: message });
        }
      }),
    );
  }
}
