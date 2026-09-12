import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiErrorMessage, getJson, isAbortError, postJson } from '../api';
import { DockscopeError } from '../../../core/errors';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

describe('api helpers', () => {
  it('reads successful JSON responses', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: true })) as typeof fetch;

    await expect(getJson('/api/example')).resolves.toEqual({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/example', { method: 'GET' });
  });

  it('posts JSON bodies with content type', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: true })) as typeof fetch;

    await postJson('/api/example', { id: 'abc' });

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(init?.method).toBe('POST');
    expect((init?.headers as Headers).get('Content-Type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ id: 'abc' }));
  });

  it('throws ApiError with server error details', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'container not found' }, { status: 404, statusText: 'Not Found' }),
    ) as typeof fetch;

    await expect(getJson('/api/missing')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'container not found',
      code: 'API_REQUEST_FAILED',
      category: 'not_found',
    });
  });

  it('preserves server error codes and derives classification from the HTTP status', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(
        { error: 'Name is required', code: 'PLUGIN_CONFIG_INVALID', category: 'permission' },
        { status: 400 },
      ),
    ) as typeof fetch;
    await expect(getJson('/api/example')).rejects.toMatchObject({
      code: 'PLUGIN_CONFIG_INVALID',
      category: 'validation',
      message: 'Name is required',
    });
    expect(new ApiError('Fallback', 500, { code: '<invalid>' })).toMatchObject({
      code: 'API_REQUEST_FAILED',
      category: 'internal',
    });
    expect(new ApiError('Fallback', 500, null)).toBeInstanceOf(DockscopeError);
  });

  it('extracts user-facing error messages', () => {
    expect(apiErrorMessage(new ApiError('fallback', 500, { error: 'boom' }))).toBe('boom');
    expect(apiErrorMessage(new Error('network failed'))).toBe('network failed');
    expect(apiErrorMessage('unknown')).toBe('');
  });

  it('detects abort and timeout DOM exceptions', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new DOMException('timeout', 'TimeoutError'))).toBe(true);
    expect(isAbortError(new Error('AbortError'))).toBe(false);
  });
});
