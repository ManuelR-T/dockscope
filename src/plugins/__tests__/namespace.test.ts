import { describe, expect, it } from 'vitest';
import {
  assertReservedPluginNamespace,
  isReservedPluginId,
  RESERVED_NAMESPACE_OVERRIDE_ENV,
  reservedNamespaceOverrideEnabled,
} from '../namespace';

describe('isReservedPluginId', () => {
  it('matches the reserved namespace regardless of case or padding', () => {
    expect(isReservedPluginId('official.kubernetes')).toBe(true);
    expect(isReservedPluginId('Official.Kubernetes')).toBe(true);
    expect(isReservedPluginId('  official.backups')).toBe(true);
  });

  it('does not match third-party namespaces', () => {
    expect(isReservedPluginId('acme.hello')).toBe(false);
    expect(isReservedPluginId('officially.mine')).toBe(false);
    expect(isReservedPluginId('unofficial.thing')).toBe(false);
    expect(isReservedPluginId('my.official.plugin')).toBe(false);
  });
});

describe('reservedNamespaceOverrideEnabled', () => {
  it('is enabled only for an explicit "1"', () => {
    expect(reservedNamespaceOverrideEnabled({ [RESERVED_NAMESPACE_OVERRIDE_ENV]: '1' })).toBe(true);
    expect(reservedNamespaceOverrideEnabled({ [RESERVED_NAMESPACE_OVERRIDE_ENV]: 'true' })).toBe(
      false,
    );
    expect(reservedNamespaceOverrideEnabled({})).toBe(false);
  });
});

describe('assertReservedPluginNamespace', () => {
  const env = {};

  it('rejects an unsigned plugin claiming the reserved namespace', () => {
    expect(() =>
      assertReservedPluginNamespace({
        id: 'official.totally-legit',
        signatureVerified: undefined,
        env,
      }),
    ).toThrow(/reserved "official\." namespace/);
  });

  it('rejects a reserved id whose signature did not verify', () => {
    expect(() =>
      assertReservedPluginNamespace({ id: 'official.kubernetes', signatureVerified: false, env }),
    ).toThrow(/verified package signature/);
  });

  it('suggests a third-party namespace in the error', () => {
    expect(() =>
      assertReservedPluginNamespace({ id: 'official.backups', signatureVerified: false, env }),
    ).toThrow(/acme\.backups/);
  });

  it('allows a reserved id with a verified package signature', () => {
    expect(() =>
      assertReservedPluginNamespace({ id: 'official.kubernetes', signatureVerified: true, env }),
    ).not.toThrow();
  });

  it('allows third-party ids regardless of signature state', () => {
    expect(() =>
      assertReservedPluginNamespace({ id: 'acme.hello', signatureVerified: undefined, env }),
    ).not.toThrow();
  });

  it('allows the reserved namespace when the override is set', () => {
    expect(() =>
      assertReservedPluginNamespace({
        id: 'official.kubernetes',
        signatureVerified: undefined,
        env: { [RESERVED_NAMESPACE_OVERRIDE_ENV]: '1' },
      }),
    ).not.toThrow();
  });
});
