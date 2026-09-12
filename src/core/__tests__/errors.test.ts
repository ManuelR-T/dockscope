import { describe, expect, it } from 'vitest';
import { DockscopeError, deserializeError, isDockscopeError, serializeError } from '../errors';
import { errorHttpStatus } from '../errorStatus';
import { PluginOperationError, PluginManifestError } from '../plugin-contract/manifest';
import { PluginConfigError } from '../plugin-contract/config';
import { PluginCompatibilityError } from '../plugin-contract/compatibility';
import { PluginPermissionError } from '../../plugins/hostApi';

describe('shared application errors', () => {
  it('retains the cause locally and exposes stable classification through existing classes', () => {
    const cause = new Error('private detail');
    const error = new PluginConfigError('Invalid configuration', { cause });
    expect(error).toBeInstanceOf(DockscopeError);
    expect(error).toMatchObject({
      name: 'PluginConfigError',
      code: 'PLUGIN_CONFIG_INVALID',
      category: 'validation',
      cause,
    });
    expect(isDockscopeError(new PluginManifestError('Invalid manifest'))).toBe(true);
    expect(new PluginCompatibilityError('Upgrade required').code).toBe('PLUGIN_INCOMPATIBLE');
    expect(new PluginPermissionError('secrets.read', 'demo').category).toBe('permission');
  });

  it.each([400, 401, 403, 404, 409, 500, 502, 503, 504])(
    'preserves legacy operation status %i',
    (status) => {
      const error = new PluginOperationError(status, 'Operation failed');
      expect(error.status).toBe(status);
      expect(errorHttpStatus(error.category)).toBe(status);
      expect(errorHttpStatus(deserializeError(serializeError(error)).category)).toBe(status);
    },
  );

  it('does not trust arbitrary status/code properties or invalid classification', () => {
    expect(
      isDockscopeError({
        code: 'VALIDATION',
        category: 'validation',
        message: 'fake',
        status: 400,
      }),
    ).toBe(false);
    expect(
      isDockscopeError(
        Object.assign(new Error('fake'), {
          status: 400,
          code: 'VALIDATION',
          category: 'validation',
        }),
      ),
    ).toBe(false);
    expect(
      () => new DockscopeError('bad', { code: 'invalid code', category: 'validation' }),
    ).toThrow(TypeError);
    expect(errorHttpStatus(new PluginOperationError(200, 'Invalid status').category)).toBe(500);
  });

  it('round-trips only bounded classification and message fields, never causes or custom data', () => {
    const error = Object.assign(
      new PluginConfigError('Safe message', { cause: new Error('password') }),
      { token: 'secret' },
    );
    const serialized = serializeError(error);
    expect(serialized).toEqual({
      version: 1,
      name: 'PluginConfigError',
      message: 'Safe message',
      code: 'PLUGIN_CONFIG_INVALID',
      category: 'validation',
    });
    expect(deserializeError(JSON.parse(JSON.stringify(serialized)))).toMatchObject({
      name: 'PluginConfigError',
      message: 'Safe message',
      code: 'PLUGIN_CONFIG_INVALID',
      category: 'validation',
    });
    expect(deserializeError(serialized).cause).toBeUndefined();
    expect(JSON.stringify(serialized)).not.toMatch(/password|secret|stack/);
    expect(serializeError(new Error('a'.repeat(5000))).message).toHaveLength(4096);
  });

  it.each([
    null,
    'error',
    [],
    {},
    { version: 2, name: 'Error', code: 'INVALID', category: 'validation', message: 'fake' },
    { version: 1, name: 'Error', code: 'INVALID', category: 'constructor', message: 'fake' },
    { version: 1, name: 'Error', code: '<script>', category: 'validation', message: 'fake' },
    {
      version: 1,
      name: 'Error',
      code: 'INVALID',
      category: 'validation',
      message: 'x'.repeat(4097),
    },
  ])('fails closed on a malformed IPC envelope (%#)', (raw) => {
    const error = deserializeError(raw, 'Diagnostic detail');
    expect(error).toMatchObject({
      code: 'INTERNAL_ERROR',
      category: 'internal',
      message: 'Diagnostic detail',
    });
  });

  it('ignores worker-provided status, stack and cause, using only the validated category', () => {
    const raw = {
      ...serializeError(new PluginConfigError('Safe')),
      status: 200,
      stack: 'private',
      cause: 'private',
    };
    const error = deserializeError(raw);
    expect(errorHttpStatus(error.category)).toBe(400);
    expect(error.cause).toBeUndefined();
    expect(error.stack).not.toBe('private');
  });

  it('treats old workers, foreign Error instances and non-Error throws as internal diagnostics', () => {
    expect(deserializeError(undefined, 'old worker')).toMatchObject({
      message: 'old worker',
      category: 'internal',
    });
    expect(serializeError(new Error('database password'))).toMatchObject({
      message: 'database password',
      code: 'INTERNAL_ERROR',
      category: 'internal',
    });
    expect(serializeError({ token: 'private' })).toMatchObject({
      message: 'Unknown error',
      category: 'internal',
    });
  });
});
