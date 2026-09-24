import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    });
    expect(JSON.stringify(settings.status())).not.toContain('secret');
    expect((await stat(path.join(directory, 'webhook.json'))).mode & 0o777).toBe(0o600);
    const restarted = await open();
    expect(restarted.status()).toEqual(settings.status());
    await restarted.update({ url: '', format: 'discord' });
    expect(JSON.parse(await readFile(path.join(directory, 'webhook.json'), 'utf8'))).toEqual({
      url: 'https://example.test/secret',
      format: 'discord',
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
