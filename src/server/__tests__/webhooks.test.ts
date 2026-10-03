import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Anomaly, CrashDiagnostic, WSMessage } from '../../types';
import { DEFAULT_WEBHOOK_EVENTS, defaultWebhookScope } from '../../shared/webhooks';
import type { WebhookAlert } from '../webhookEvents';
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
    expect(readWebhookConfig({ DOCKSCOPE_WEBHOOK_URL: config.url })).toEqual({
      ...config,
      events: DEFAULT_WEBHOOK_EVENTS,
      scope: defaultWebhookScope(),
    });
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
    notifier.notify({ type: 'anomaly', data: { ...anomaly, time: 1235 } });
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
      notifier.notify({ type: 'anomaly', data: { ...anomaly, time: 1235 + i } });
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

const scopedAnomaly: WebhookAlert = {
  type: 'anomaly',
  data: anomaly,
  family: 'cpu',
  eventType: 'anomaly.cpu',
  time: 1234,
  sourceId: 'east',
  workload: { entityId: 'abc', name: 'web', project: 'prod' },
};
function selected(
  events: NonNullable<import('../webhooks').WebhookConfig['events']>,
  scope = defaultWebhookScope(),
) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  const notifier = new WebhookNotifier({ ...config, events, scope }, { fetch: fetcher });
  notifiers.push(notifier);
  return { notifier, fetcher };
}
function transition(
  eventType: string,
  family: 'health' | 'connectivity' | 'lifecycle' | 'recovery',
  time = Date.now(),
): WebhookAlert {
  return {
    ...scopedAnomaly,
    type: 'transition',
    family,
    eventType,
    time,
    data: { message: eventType },
  };
}
describe('webhook selection and transitions', () => {
  it('filters before enqueueing and keeps identically named workloads on different sources separate', async () => {
    const { notifier, fetcher } = selected(['cpu'], {
      sources: ['east'],
      projects: [{ sourceId: 'east', project: 'prod' }],
      workloads: [{ sourceId: 'east', entityId: 'abc' }],
    });
    notifier.notifyAlert({ ...scopedAnomaly, sourceId: 'west' });
    notifier.notifyAlert({
      ...scopedAnomaly,
      workload: { entityId: 'other', name: 'web', project: 'prod' },
    });
    notifier.notifyAlert({
      ...scopedAnomaly,
      workload: { entityId: 'abc', name: 'web', project: 'dev' },
    });
    notifier.notifyAlert({ ...scopedAnomaly, family: 'memory' });
    expect(fetcher).not.toHaveBeenCalled();
    notifier.notifyAlert(scopedAnomaly);
    notifier.notifyAlert(scopedAnomaly);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      sourceId: 'east',
      workload: { entityId: 'abc' },
      eventType: 'anomaly.cpu',
      time: 1234,
    });
  });
  it('uses only source filters for connectivity, and supports an empty event selection', async () => {
    const { notifier, fetcher } = selected(['connectivity'], {
      sources: ['east'],
      projects: [{ sourceId: 'west', project: 'none' }],
      workloads: [],
    });
    notifier.notifyAlert({
      ...transition('source.disconnected', 'connectivity'),
      workload: undefined,
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const paused = selected([]);
    paused.notifier.notifyAlert(scopedAnomaly);
    expect(paused.fetcher).not.toHaveBeenCalled();
  });
  it('coalesces flapping health to the latest state and cancels pending alerts at shutdown', async () => {
    vi.useFakeTimers();
    const { notifier, fetcher } = selected(['health']);
    notifier.notifyAlert(transition('health.unhealthy', 'health', 1));
    notifier.notifyAlert(transition('health.healthy', 'health', 2));
    notifier.notifyAlert(transition('health.unhealthy', 'health', 3));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledOnce();
    notifier.notifyAlert(transition('health.healthy', 'health', 4));
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    notifier.notifyAlert(transition('health.unhealthy', 'health', 5));
    await notifier.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('delivers a final recovery after the connectivity cooldown', async () => {
    vi.useFakeTimers();
    const { notifier, fetcher } = selected(['connectivity']);
    notifier.notifyAlert(transition('source.disconnected', 'connectivity', 1));
    notifier.notifyAlert(transition('source.reconnected', 'connectivity', 2));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
      version: 2,
      eventType: 'source.reconnected',
    });
  });
  it('sends crash diagnostics instead of redundant stops, while lifecycle-only subscribers still receive crashes as stops', async () => {
    const stop = {
      ...transition('lifecycle.stopped', 'lifecycle'),
      data: { message: 'web stopped', crash: true },
    } as WebhookAlert;
    const both = selected(['crash', 'lifecycle']);
    both.notifier.notifyAlert({
      ...scopedAnomaly,
      type: 'diagnostic',
      data: diagnostic,
      family: 'crash',
      eventType: 'crash',
    });
    both.notifier.notifyAlert(stop);
    await vi.waitFor(() => expect(both.fetcher).toHaveBeenCalledOnce());
    const lifecycle = selected(['lifecycle']);
    lifecycle.notifier.notifyAlert(stop);
    await vi.waitFor(() => expect(lifecycle.fetcher).toHaveBeenCalledOnce());
  });
});

it('expires duplicate suppression after one minute', async () => {
  vi.useFakeTimers();
  const { notifier, fetcher } = selected(['cpu']);
  notifier.notifyAlert(scopedAnomaly);
  await vi.advanceTimersByTimeAsync(60_000);
  notifier.notifyAlert(scopedAnomaly);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
