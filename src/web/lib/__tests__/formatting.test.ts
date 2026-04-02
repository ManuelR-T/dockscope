import { describe, it, expect } from 'vitest';
import { formatBytes, formatGB } from '../formatting';

describe('formatBytes', () => {
  it('returns "0 B" for zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500.0 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(10485760)).toBe('10.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1.0 GB');
  });
});

describe('formatGB', () => {
  it('converts bytes to GB with 1 decimal', () => {
    expect(formatGB(1073741824)).toBe('1.0');
    expect(formatGB(2147483648)).toBe('2.0');
    expect(formatGB(536870912)).toBe('0.5');
  });
});
