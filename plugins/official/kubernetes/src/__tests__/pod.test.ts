import type { V1Pod } from '@kubernetes/client-node';
import { describe, expect, it } from 'vitest';
import podNode from '../graph/pod';

describe('pod phase mapping', () => {
  it.each([
    ['Running', 'running', 'healthy'],
    ['RUNNING', 'running', 'healthy'],
    ['pending', 'pending', 'starting'],
    ['Succeeded', 'exited', 'none'],
    ['Failed', 'dead', 'unhealthy'],
    ['Unknown', 'unknown', 'none'],
    ['future-phase', 'unknown', 'none'],
    ['constructor', 'unknown', 'none'],
    ['__proto__', 'unknown', 'none'],
    ['', 'unknown', 'none'],
    [undefined, 'unknown', 'none'],
  ])('maps phase %s without letting readiness override the phase', (phase, status, health) => {
    expect(
      podNode({ status: { phase, conditions: [{ type: 'Ready', status: 'True' }] } }),
    ).toMatchObject({ status, health });
  });

  it.each(['True', 'False', 'Unknown', 'true', undefined])(
    'uses readiness %s for running pods',
    (ready) => {
      const pod: V1Pod = {
        status: {
          phase: 'Running',
          conditions: ready === undefined ? [] : [{ type: 'Ready', status: ready }],
        },
      };
      expect(podNode(pod)).toMatchObject({
        status: 'running',
        health: ready === 'True' ? 'healthy' : 'starting',
      });
    },
  );

  it('uses only the first Ready condition and ignores unrelated conditions', () => {
    expect(
      podNode({
        status: {
          phase: 'Running',
          conditions: [
            { type: 'Initialized', status: 'True' },
            { type: 'Ready', status: 'False' },
            { type: 'Ready', status: 'True' },
          ],
        },
      }),
    ).toMatchObject({ status: 'running', health: 'starting' });
  });

  it('handles pods without status or conditions', () => {
    expect(podNode({})).toMatchObject({ status: 'unknown', health: 'none' });
    expect(podNode({ status: { phase: 'Running' } })).toMatchObject({
      status: 'running',
      health: 'starting',
    });
  });
});
