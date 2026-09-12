import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockscopeError, type ErrorCategory } from '../../core/errors';
import { PluginConfigError } from '../../core/plugin-contract/config';
import { asyncRoute } from '../errors';

let server: Server | undefined;
afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

async function request(error: unknown, logger = { error: vi.fn() }) {
  const app = express();
  app.get(
    '/error',
    asyncRoute(async () => {
      throw error;
    }, logger),
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  return {
    response: await fetch(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/error`),
    logger,
  };
}

describe('central HTTP error handling', () => {
  it.each<[ErrorCategory, number]>([
    ['validation', 400],
    ['unauthenticated', 401],
    ['permission', 403],
    ['not_found', 404],
    ['conflict', 409],
    ['upstream', 502],
    ['unavailable', 503],
    ['timeout', 504],
  ])('maps %s without knowing any specialized error classes', async (category, status) => {
    const { response } = await request(
      new DockscopeError('Safe explanation', { code: 'DEMO_ERROR', category }),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Safe explanation', code: 'DEMO_ERROR' });
  });

  it('preserves known validation messages but never exposes the underlying cause', async () => {
    const { response, logger } = await request(
      new PluginConfigError('Name is required', { cause: new Error('token=private') }),
    );
    expect(await response.json()).toEqual({
      error: 'Name is required',
      code: 'PLUGIN_CONFIG_INVALID',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    new Error('token=private'),
    new DockscopeError('token=private', {
      code: 'PRIVATE_DETAILS',
      category: 'internal',
      cause: new Error('original cause'),
    }),
    { status: 400, code: 'FAKE', message: 'token=private' },
    'token=private',
  ])('logs unexpected failures but sends a generic 500 (%#)', async (error) => {
    const { response, logger } = await request(error);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
    expect(logger.error).toHaveBeenCalledWith('DockScope request failed', error);
  });
});
