import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WEBHOOK_EVENTS, defaultWebhookScope } from '../../shared/webhooks';
import { WebhookSettings } from '../webhookSettings';

let directory: string;
const services: WebhookSettings[] = [];
async function open(extra: NodeJS.ProcessEnv = {}) {
  const settings = await WebhookSettings.open({ DOCKSCOPE_STATE_DIR: directory, ...extra });
  services.push(settings);
  return settings;
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'dockscope-webhook-settings-'));
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((settings) => settings.stop()));
  await rm(directory, { recursive: true, force: true });
});

describe('WebhookSettings', () => {
  it('persists private settings, retains a hidden URL, and disables across restarts', async () => {
    const settings = await open();
    expect(settings.status().enabled).toBe(false);
    await settings.update({ url: 'https://example.test/secret', format: 'slack' });
    expect(settings.status()).toEqual({
      enabled: true,
      managedByEnv: false,
      destination: 'example.test',
      format: 'slack',
      events: DEFAULT_WEBHOOK_EVENTS,
      scope: defaultWebhookScope(),
    });
    expect(JSON.stringify(settings.status())).not.toContain('secret');
    expect((await stat(path.join(directory, 'webhook.json'))).mode & 0o777).toBe(0o600);
    const restarted = await open();
    expect(restarted.status()).toEqual(settings.status());
    await restarted.update({ url: '', format: 'discord' });
    expect(JSON.parse(await readFile(path.join(directory, 'webhook.json'), 'utf8'))).toEqual({
      url: 'https://example.test/secret',
      format: 'discord',
      events: DEFAULT_WEBHOOK_EVENTS,
      scope: defaultWebhookScope(),
    });
    await restarted.update(null);
    expect((await open()).status().enabled).toBe(false);
  });
  it('lets the environment override stored settings and refuses dashboard edits', async () => {
    const settings = await open();
    await settings.update({ url: 'https://saved.test/secret', format: 'json' });
    const managed = await open({
      DOCKSCOPE_WEBHOOK_URL: 'https://env.test/secret',
      DOCKSCOPE_WEBHOOK_FORMAT: 'slack',
    });
    expect(managed.status()).toMatchObject({
      destination: 'env.test',
      format: 'slack',
      managedByEnv: true,
    });
    await expect(managed.update(null)).rejects.toThrow('environment');
    expect((await open()).status().destination).toBe('saved.test');
  });
  it('rejects invalid inputs without overwriting a working configuration', async () => {
    const settings = await open();
    await expect(settings.update({ url: '', format: 'json' })).rejects.toThrow('required');
    await settings.update({ url: 'https://example.test/hook', format: 'json' });
    await expect(settings.update({ url: 'file:///private', format: 'json' })).rejects.toThrow(
      'HTTP',
    );
    await expect(settings.update({ url: '', format: 'bad' })).rejects.toThrow('FORMAT');
    expect((await open()).status().destination).toBe('example.test');
  });
  it('serializes concurrent changes and leaves the last configuration on disk', async () => {
    const settings = await open();
    await Promise.all([
      settings.update({ url: 'https://first.test/hook', format: 'json' }),
      settings.update({ url: 'https://second.test/hook', format: 'slack' }),
    ]);
    expect((await open()).status()).toEqual(settings.status());
    expect(settings.status().destination).toBe('second.test');
  });
  it('reports unreadable state without exposing its secret contents', async () => {
    await writeFile(path.join(directory, 'webhook.json'), 'secret-invalid-json');
    await expect(open()).rejects.toThrow('Could not read webhook.json');
  });
});

it('migrates legacy files and persists event and source-qualified scope selections', async () => {
  await writeFile(
    path.join(directory, 'webhook.json'),
    JSON.stringify({ url: 'https://test.example/secret', format: 'json' }),
  );
  const settings = await open();
  expect(settings.status().events).toEqual(DEFAULT_WEBHOOK_EVENTS);
  const selection = {
    events: ['health', 'recovery'],
    scope: {
      sources: ['remote'],
      projects: [{ sourceId: 'remote', project: 'prod' }],
      workloads: [{ sourceId: 'remote', entityId: 'abc' }],
    },
  };
  await settings.update({ url: '', format: 'json', ...selection });
  expect((await open()).status()).toMatchObject(selection);
  await settings.update({ url: '', format: 'slack' });
  expect((await open()).status()).toMatchObject(selection);
  await expect(settings.update({ url: '', format: 'json', events: ['typo'] })).rejects.toThrow(
    'event',
  );
  await expect(
    settings.update({ url: '', format: 'json', scope: { workloads: ['abc'] } }),
  ).rejects.toThrow('scope');
  await expect(
    settings.update({ url: '', format: 'json', scope: { project: 'typo' } }),
  ).rejects.toThrow('scope');
  expect((await open()).status()).toMatchObject(selection);
});
it('applies environment event and scope selection without leaking URLs', async () => {
  const selection = {
    events: ['health', 'connectivity'],
    scope: { ...defaultWebhookScope(), sources: ['remote'] },
  };
  const settings = await open({
    DOCKSCOPE_WEBHOOK_URL: 'https://env.example/secret',
    DOCKSCOPE_WEBHOOK_EVENTS: 'health,connectivity',
    DOCKSCOPE_WEBHOOK_SCOPE: JSON.stringify(selection.scope),
  });
  expect(settings.status()).toMatchObject({ ...selection, managedByEnv: true });
  expect(JSON.stringify(settings.status())).not.toContain('secret');
  await expect(settings.update({ events: [] })).rejects.toThrow('environment');
});
