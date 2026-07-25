import { describe, expect, it } from 'vitest';
import {
  isAllowedCorsOrigin,
  isAllowedWsOrigin,
  isLoopbackHost,
  parseAllowedOrigins,
} from '../origin';

describe('parseAllowedOrigins', () => {
  it('parses a comma-separated, lowercased set and drops blanks', () => {
    const set = parseAllowedOrigins({
      DOCKSCOPE_ALLOWED_ORIGINS: 'https://Dock.Example.com, , http://ui.local:3000',
    });
    expect(set).toEqual(new Set(['https://dock.example.com', 'http://ui.local:3000']));
  });

  it('is empty when unset', () => {
    expect(parseAllowedOrigins({})).toEqual(new Set());
  });
});

describe('isLoopbackHost', () => {
  it('recognises loopback hostnames', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.5.6.7')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
  });

  it('rejects non-loopback hosts', () => {
    expect(isLoopbackHost('evil.example')).toBe(false);
    expect(isLoopbackHost('192.168.1.5')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.evil.example')).toBe(false);
  });
});

describe('isAllowedWsOrigin', () => {
  const allowedOrigins = new Set<string>();

  it('allows non-browser clients that send no Origin', () => {
    expect(isAllowedWsOrigin({ origin: undefined, host: 'localhost:4681', allowedOrigins })).toBe(
      true,
    );
  });

  it('allows same-origin handshakes (Origin authority matches Host)', () => {
    expect(
      isAllowedWsOrigin({
        origin: 'http://192.168.1.5:4681',
        host: '192.168.1.5:4681',
        allowedOrigins,
      }),
    ).toBe(true);
  });

  it('allows loopback origins regardless of Host', () => {
    expect(
      isAllowedWsOrigin({
        origin: 'http://localhost:4681',
        host: 'localhost:4681',
        allowedOrigins,
      }),
    ).toBe(true);
    expect(
      isAllowedWsOrigin({
        origin: 'http://127.0.0.1:4681',
        host: 'localhost:4681',
        allowedOrigins,
      }),
    ).toBe(true);
  });

  it('rejects a forged cross-origin handshake (the drive-by exec vector)', () => {
    expect(
      isAllowedWsOrigin({
        origin: 'https://evil.example',
        host: 'localhost:4681',
        allowedOrigins,
      }),
    ).toBe(false);
  });

  it('rejects a malformed Origin', () => {
    expect(isAllowedWsOrigin({ origin: 'not a url', host: 'localhost:4681', allowedOrigins })).toBe(
      false,
    );
  });

  it('honours the explicit allow-list', () => {
    const list = new Set(['https://dock.example.com']);
    expect(
      isAllowedWsOrigin({
        origin: 'https://dock.example.com',
        host: 'localhost:4681',
        allowedOrigins: list,
      }),
    ).toBe(true);
  });
});

describe('isAllowedCorsOrigin', () => {
  const allowedOrigins = new Set<string>();

  it('allows same-origin / non-browser requests without an Origin', () => {
    expect(isAllowedCorsOrigin({ origin: undefined, allowedOrigins })).toBe(true);
  });

  it('allows loopback and allow-listed origins', () => {
    expect(isAllowedCorsOrigin({ origin: 'http://localhost:4681', allowedOrigins })).toBe(true);
    expect(
      isAllowedCorsOrigin({
        origin: 'https://dock.example.com',
        allowedOrigins: new Set(['https://dock.example.com']),
      }),
    ).toBe(true);
  });

  it('rejects cross-origin reads from other sites', () => {
    expect(isAllowedCorsOrigin({ origin: 'https://evil.example', allowedOrigins })).toBe(false);
  });
});
