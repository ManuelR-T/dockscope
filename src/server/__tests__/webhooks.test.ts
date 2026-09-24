import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Anomaly, CrashDiagnostic, WSMessage } from '../../types';
import { readWebhookConfig, WebhookNotifier } from '../webhooks';

const anomaly: Anomaly = {
  containerId: 'remote:abc',
  containerName: 'web',
  metric: 'cpu',
  value: 95,
  average: 12,
  threshold: 70,
  time: 1234,
};
const diagnostic: CrashDiagnostic = {
  containerId: 'remote:abc',
  containerName: 'web',
  exitCode: 137,
  oomKilled: true,
  cause: 'Out of memory',
  details: ['memory limit reached'],
  logSnippet: ['allocation failed'],
  time: 1234,
};
const alert: WSMessage = { type: 'anomaly', data: anomaly };
const config = { url: 'https://example.test/secret', format: 'json' as const };
const notifiers: WebhookNotifier[] = [];
function setup(
  fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
  format: 'json' | 'slack' | 'discord' = 'json',
) {
  const warn = vi.fn();
  const notifier = new WebhookNotifier({ ...config, format }, { fetch: fetcher, warn });
  notifiers.push(notifier);
  return { notifier, fetcher, warn };
}
afterEach(async () => {
  await Promise.all(notifiers.splice(0).map((notifier) => notifier.stop()));
  vi.useRealTimers();
});

describe('webhook configuration', () => {
  it('is disabled by default and defaults to JSON when configured', () => {
    expect(readWebhookConfig({})).toBeNull();
    expect(readWebhookConfig({ DOCKSCOPE_WEBHOOK_URL: config.url })).toEqual(config);
  });
  it.each([
    'secret-not-a-url',
    'file:///secret',
    'https://user:secret@example.test',
    'https://example.test/#secret',
  ])('rejects invalid destinations without echoing them', (url) => {
    expect(() => readWebhookConfig({ DOCKSCOPE_WEBHOOK_URL: url })).toThrow(
      /DOCKSCOPE_WEBHOOK_URL/,
    );
    try {
      readWebhookConfig({ DOCKSCOPE_WEBHOOK_URL: url });
    } catch (error) {
      expect(String(error)).not.toContain(url);
    }
  });
  it('validates the formatter', () => {
    expect(() =>
      readWebhookConfig({ DOCKSCOPE_WEBHOOK_URL: config.url, DOCKSCOPE_WEBHOOK_FORMAT: 'typo' }),
    ).toThrow(/FORMAT/);
  });
});

describe('WebhookNotifier', () => {
  it('posts JSON anomalies and diagnostics, excluding ordinary monitor messages', async () => {
    const { notifier, fetcher } = setup();
    notifier.notify({ type: 'graph', data: { nodes: [], links: [] } });
    notifier.notify(alert);
    notifier.notify({ type: 'diagnostic', data: diagnostic });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const requests = fetcher.mock.calls.map(([, init]) => init!);
    expect(JSON.parse(String(requests[0].body))).toMatchObject({
      version: 1,
      app: 'dockscope',
      type: 'anomaly',
      data: anomaly,
    });
    expect(JSON.parse(String(requests[1].body))).toMatchObject({
      type: 'diagnostic',
      data: diagnostic,
    });
    expect(requests[0]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
    });
  });
  it.each(['slack', 'discord'] as const)(
    'formats %s alerts with mentions disabled',
    async (format) => {
      const { notifier, fetcher } = setup(undefined, format);
      notifier.notify({
        type: 'diagnostic',
        data: { ...diagnostic, containerName: '<!channel> @everyone' },
      });
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
      if (format === 'slack') {
        expect(body.blocks[0].text.type).toBe('plain_text');
        expect(body.text).toContain('&lt;!channel&gt;');
      } else {
        expect(body.allowed_mentions).toEqual({ parse: [] });
        expect(body.content.length).toBeLessThanOrEqual(2000);
      }
      expect(JSON.stringify(body)).toContain('OOM killed: yes');
    },
  );
  it('retries transient failures with the same event ID', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { notifier, warn } = setup(fetcher);
    notifier.notify(alert);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[2][1]?.body);
    expect(warn).not.toHaveBeenCalled();
  });
  it('drops permanent failures and continues processing later alerts', async () => {
    const { notifier, fetcher, warn } = setup(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 400 }))
        .mockResolvedValueOnce(new Response(null, { status: 204 })),
    );
    notifier.notify(alert);
    notifier.notify(alert);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(warn).toHaveBeenCalledWith('Webhook delivery: HTTP 400; dropping alert');
  });
  it('limits retries and never logs endpoint credentials or exception details', async () => {
    vi.useFakeTimers();
    const { notifier, fetcher, warn } = setup(
      vi.fn<typeof fetch>().mockRejectedValue(new Error(config.url)),
    );
    notifier.notify(alert);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });
  it('aborts a stalled request on shutdown and discards queued alerts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const { notifier, warn } = setup(fetcher);
    notifier.notify(alert);
    for (let i = 0; i < 101; i++) {
      notifier.notify(alert);
    }
    expect(fetcher).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('Webhook delivery: queue full; dropping newest alert');
    await notifier.stop();
    notifier.notify(alert);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('drops excessive payloads and overly long Retry-After delays', async () => {
    const { notifier, fetcher, warn } = setup(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '3600' } })),
    );
    notifier.notify({
      type: 'diagnostic',
      data: { ...diagnostic, logSnippet: ['x'.repeat(300_000)] },
    });
    expect(fetcher).not.toHaveBeenCalled();
    notifier.notify(alert);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('times out a stalled receiver and cancels its retry on shutdown', async () => {
    let timedOut = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            'abort',
            () => {
              timedOut = true;
              reject(new Error('timeout'));
            },
            { once: true },
          );
        }),
    );
    const { notifier } = setup(fetcher);
    notifier.notify(alert);
    await vi.waitFor(() => expect(timedOut).toBe(true), { timeout: 6000 });
    await notifier.stop();
    expect(fetcher).toHaveBeenCalledOnce();
  }, 7000);

  it('does nothing when disabled', () => {
    const fetcher = vi.fn<typeof fetch>();
    const notifier = new WebhookNotifier(null, { fetch: fetcher });
    notifier.notify(alert);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
