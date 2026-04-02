import { describe, it, expect } from 'vitest';
import { demuxLogBuffer } from '../logs';

describe('demuxLogBuffer', () => {
  it('handles TTY output (no demux headers)', () => {
    const text = 'Hello from container\nLine 2\n';
    const buf = Buffer.from(text, 'utf-8');
    expect(demuxLogBuffer(buf)).toBe(text);
  });

  it('demuxes stdout frames', () => {
    // Docker multiplexed log format: [stream_type(1), 0, 0, 0, size(4BE)] + payload
    const payload = Buffer.from('hello stdout\n', 'utf-8');
    const header = Buffer.alloc(8);
    header[0] = 1; // stdout
    header.writeUInt32BE(payload.length, 4);
    const buf = Buffer.concat([header, payload]);
    expect(demuxLogBuffer(buf)).toBe('hello stdout\n');
  });

  it('demuxes stderr frames', () => {
    const payload = Buffer.from('error msg\n', 'utf-8');
    const header = Buffer.alloc(8);
    header[0] = 2; // stderr
    header.writeUInt32BE(payload.length, 4);
    const buf = Buffer.concat([header, payload]);
    expect(demuxLogBuffer(buf)).toBe('error msg\n');
  });

  it('demuxes multiple frames', () => {
    const p1 = Buffer.from('line1\n', 'utf-8');
    const h1 = Buffer.alloc(8);
    h1[0] = 1;
    h1.writeUInt32BE(p1.length, 4);

    const p2 = Buffer.from('line2\n', 'utf-8');
    const h2 = Buffer.alloc(8);
    h2[0] = 1;
    h2.writeUInt32BE(p2.length, 4);

    const buf = Buffer.concat([h1, p1, h2, p2]);
    expect(demuxLogBuffer(buf)).toBe('line1\nline2\n');
  });

  it('handles empty buffer', () => {
    expect(demuxLogBuffer(Buffer.alloc(0))).toBe('');
  });

  it('handles truncated frame gracefully', () => {
    const header = Buffer.alloc(8);
    header[0] = 1;
    header.writeUInt32BE(100, 4); // claims 100 bytes but none follow
    const result = demuxLogBuffer(header);
    // Should not crash, returns whatever it can
    expect(typeof result).toBe('string');
  });
});
