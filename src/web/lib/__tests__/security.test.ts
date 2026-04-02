import { describe, it, expect } from 'vitest';
import { maskValue } from '../security';

describe('maskValue', () => {
  it('masks password values', () => {
    expect(maskValue('DB_PASSWORD=secret123', false)).toBe('DB_PASSWORD=*********');
  });

  it('masks token values', () => {
    expect(maskValue('API_TOKEN=abc', false)).toBe('API_TOKEN=***');
  });

  it('masks secret values', () => {
    expect(maskValue('APP_SECRET=supersecret', false)).toBe('APP_SECRET=***********');
  });

  it('masks auth values', () => {
    expect(maskValue('AUTH_KEY=key123', false)).toBe('AUTH_KEY=******');
  });

  it('masks credential values', () => {
    expect(maskValue('CREDENTIAL=cred', false)).toBe('CREDENTIAL=****');
  });

  it('masks api_key values', () => {
    expect(maskValue('MY_API_KEY=abc123', false)).toBe('MY_API_KEY=******');
  });

  it('shows secrets when showSecrets is true', () => {
    expect(maskValue('DB_PASSWORD=secret123', true)).toBe('DB_PASSWORD=secret123');
  });

  it('does not mask non-sensitive vars', () => {
    expect(maskValue('NODE_ENV=production', false)).toBe('NODE_ENV=production');
    expect(maskValue('PORT=3000', false)).toBe('PORT=3000');
  });

  it('handles lines without equals', () => {
    expect(maskValue('NO_EQUALS_HERE', false)).toBe('NO_EQUALS_HERE');
  });

  it('caps mask length at 16 characters', () => {
    const longVal = 'a'.repeat(30);
    expect(maskValue(`SECRET=${longVal}`, false)).toBe(`SECRET=${'*'.repeat(16)}`);
  });

  it('is case-insensitive for key matching', () => {
    expect(maskValue('password=test', false)).toBe('password=****');
    expect(maskValue('Password=test', false)).toBe('Password=****');
  });
});
