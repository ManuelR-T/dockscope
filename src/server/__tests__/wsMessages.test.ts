import { describe, expect, it } from 'vitest';
import { parseInboundWSMessage } from '../wsMessages';

describe('parseInboundWSMessage', () => {
  it('returns null for malformed JSON and unknown message types', () => {
    expect(parseInboundWSMessage('{bad json')).toBeNull();
    expect(parseInboundWSMessage(JSON.stringify({ type: 'graph', data: {} }))).toBeNull();
    expect(parseInboundWSMessage(JSON.stringify({ data: {} }))).toBeNull();
  });

  it('validates log subscription messages', () => {
    expect(
      parseInboundWSMessage(
        JSON.stringify({ type: 'subscribe_logs', data: { containerId: '123456789abc' } }),
      ),
    ).toEqual({ type: 'subscribe_logs', data: { containerId: '123456789abc' } });
    expect(parseInboundWSMessage(JSON.stringify({ type: 'subscribe_logs', data: {} }))).toBeNull();
    expect(parseInboundWSMessage(JSON.stringify({ type: 'unsubscribe_logs' }))).toEqual({
      type: 'unsubscribe_logs',
    });
  });

  it('validates exec messages', () => {
    expect(
      parseInboundWSMessage(
        JSON.stringify({
          type: 'exec_start',
          data: { containerId: '123456789abc', cmd: ['/bin/sh'] },
        }),
      ),
    ).toEqual({
      type: 'exec_start',
      data: { containerId: '123456789abc', cmd: ['/bin/sh'] },
    });
    expect(
      parseInboundWSMessage(
        JSON.stringify({ type: 'exec_start', data: { containerId: '123456789abc', cmd: 'sh' } }),
      ),
    ).toBeNull();
    expect(
      parseInboundWSMessage(JSON.stringify({ type: 'exec_input', data: { text: 'ls\n' } })),
    ).toEqual({ type: 'exec_input', data: { text: 'ls\n' } });
    expect(parseInboundWSMessage(JSON.stringify({ type: 'exec_stop' }))).toEqual({
      type: 'exec_stop',
    });
  });
});
