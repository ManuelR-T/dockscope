import { describe, expect, it } from 'vitest';
import {
  apiRequestAllowed,
  allowsUiIntent,
  pluginUiExtensionAllowed,
  pluginUiActionRef,
  type AccessRole,
} from '../access';

describe('apiRequestAllowed', () => {
  it('allows operators to use every API operation', () => {
    expect(apiRequestAllowed('operator', { method: 'DELETE', path: '/containers/abc' })).toBe(true);
    expect(
      apiRequestAllowed('operator', { method: 'POST', path: '/plugins/example/commands/run' }),
    ).toBe(true);
  });

  it.each([
    ['GET', '/graph'],
    ['GET', '/sources'],
    ['GET', '/features'],
    ['GET', '/entities/abc/operations'],
    ['GET', '/entities/abc/actions'],
    ['GET', '/entities/abc/stats'],
    ['GET', '/entities/abc/logs'],
    ['GET', '/entities/abc/inspect'],
    ['GET', '/entities/abc/history'],
    ['GET', '/entities/abc/top'],
    ['GET', '/entities/abc/diff'],
    ['GET', '/entities/abc/diagnostic'],
    ['GET', '/containers/abc/stats'],
    ['GET', '/containers/abc/logs'],
    ['GET', '/containers/abc/inspect'],
    ['GET', '/containers/abc/history'],
    ['GET', '/containers/abc/top'],
    ['GET', '/containers/abc/diff'],
    ['GET', '/containers/abc/diagnostic'],
    ['GET', '/projects'],
    ['GET', '/systems'],
    ['GET', '/system'],
    ['GET', '/connections'],
    ['GET', '/connections/providers'],
    ['GET', '/hosts'],
    ['GET', '/version'],
    ['GET', '/plugins'],
    ['GET', '/plugins/errors'],
    ['GET', '/plugins/warnings'],
    ['GET', '/plugins/health'],
    ['GET', '/plugins/ui'],
    ['GET', '/plugins/example/frontend'],
    ['GET', '/plugins/commands'],
    ['GET', '/plugins/events'],
    ['GET', '/plugins/compatibility'],
    ['GET', '/plugins/review'],
    ['GET', '/plugins/catalog'],
    ['GET', '/plugins/approvals'],
    ['GET', '/plugins/marketplace'],
    ['GET', '/plugins/catalogs'],
    ['GET', '/plugins/config'],
    ['GET', '/plugins/secrets'],
    ['GET', '/plugins/example/config'],
    ['HEAD', '/health/'],
    ['POST', '/compare'],
    ['POST', '/kubernetes/logs'],
  ])('allows a reader to observe through %s %s', (method, path) => {
    expect(apiRequestAllowed('reader', { method, path })).toBe(true);
  });

  it.each([
    ['POST', '/entities/abc/actions/restart'],
    ['POST', '/projects/demo/down'],
    ['PUT', '/plugins/example/config'],
    ['PUT', '/plugins/example/secrets/password'],
    ['DELETE', '/connections/example/provider/id'],
    ['POST', '/plugins/catalogs/preview'],
    ['GET', '/future-unclassified-read'],
    ['POST', '/future-unclassified-operation'],
  ])('denies a reader access to %s %s', (method, path) => {
    expect(apiRequestAllowed('reader', { method, path })).toBe(false);
  });

  it('allows only declared open-url plugin UI actions to readers', () => {
    const request = { method: 'POST', path: '/plugins/example/ui/docs/action' };

    expect(
      apiRequestAllowed('reader', {
        ...request,
        pluginUiAction: { type: 'open_url', url: 'https://example.test/docs' },
      }),
    ).toBe(true);
    expect(
      apiRequestAllowed('reader', {
        ...request,
        pluginUiAction: { type: 'run_command', commandId: 'restart' },
      }),
    ).toBe(false);
    expect(apiRequestAllowed('reader', request)).toBe(false);
  });

  it('allows no plugin UI action before authentication resolves', () => {
    expect(
      apiRequestAllowed(null, {
        method: 'POST',
        path: '/plugins/example/ui/docs/action',
        pluginUiAction: { type: 'open_url', url: 'https://example.test/docs' },
      }),
    ).toBe(false);
  });
});

describe('pluginUiActionRef', () => {
  it('extracts the plugin and extension from the conditional API route', () => {
    expect(pluginUiActionRef('/plugins/example.plugin/ui/open-docs/action')).toEqual({
      pluginId: 'example.plugin',
      extensionId: 'open-docs',
    });
  });

  it.each(['/plugins/example/commands/run', '/plugins/example/ui/action', '/graph'])(
    'does not classify %s as a plugin UI action',
    (path) => expect(pluginUiActionRef(path)).toBeUndefined(),
  );
});

describe('allowsUiIntent', () => {
  it.each<AccessRole>(['reader', 'operator'])('lets %s use observational UI', (role) => {
    expect(allowsUiIntent(role, 'observe')).toBe(true);
  });

  it.each(['mutation', 'exec', 'plugin-command'] as const)(
    'keeps %s affordances operator-only',
    (intent) => {
      expect(allowsUiIntent('reader', intent)).toBe(false);
      expect(allowsUiIntent('operator', intent)).toBe(true);
    },
  );

  it('allows no affordances before authentication resolves', () => {
    expect(allowsUiIntent(null, 'observe')).toBe(false);
    expect(allowsUiIntent(undefined, 'mutation')).toBe(false);
  });
});

describe('pluginUiExtensionAllowed', () => {
  it('preserves static and external-link extensions for readers', () => {
    expect(pluginUiExtensionAllowed('reader', undefined)).toBe(true);
    expect(
      pluginUiExtensionAllowed('reader', {
        type: 'open_url',
        url: 'https://example.test/docs',
      }),
    ).toBe(true);
  });

  it('hides command-backed extensions from readers and everything from signed-out users', () => {
    expect(pluginUiExtensionAllowed('reader', { type: 'run_command', commandId: 'restart' })).toBe(
      false,
    );
    expect(pluginUiExtensionAllowed(null, undefined)).toBe(false);
  });
});
