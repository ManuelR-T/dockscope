import { describe, expect, it } from 'vitest';
import { createDockerPlugin } from '../plugin';
import type { EntityRef } from '../../core/entities/operations';

function actions(status?: string, name = 'web') {
  const ref: EntityRef = { entityId: 'container-id', context: { nodeId: 'node-id', name, status } };
  return createDockerPlugin().getActionProviders!()[0].listActions(ref);
}

describe('Docker action tables', () => {
  it.each([
    ['running', ['pause', 'restart', 'stop', 'kill', 'remove', 'remove-volumes']],
    ['paused', ['unpause', 'restart', 'kill', 'remove', 'remove-volumes']],
    ['exited', ['start', 'remove', 'remove-volumes']],
    ['created', ['start', 'remove', 'remove-volumes']],
    ['unknown', ['start', 'remove', 'remove-volumes']],
    ['constructor', ['start', 'remove', 'remove-volumes']],
    [undefined, ['start', 'remove', 'remove-volumes']],
  ] as const)('preserves action order for %s', async (status, expected) => {
    expect((await actions(status)).map((action) => action.id)).toEqual(expected);
  });

  it('keeps confirmations specific to each entity without sharing mutable declarations', async () => {
    const first = await actions('running', 'first');
    const second = await actions('running', 'second');
    const removed = first.find((action) => action.id === 'remove')!;
    expect(removed.confirm?.typeToConfirm).toBe('first');
    expect(second.find((action) => action.id === 'remove')?.confirm?.typeToConfirm).toBe('second');
    expect(first.find((action) => action.id === 'stop')?.confirm?.message).toContain('Stop first?');
    removed.confirm!.message = 'mutated';
    expect(
      (await actions('running', 'first')).find((action) => action.id === 'remove')?.confirm
        ?.message,
    ).toBe('Permanently remove first? This deletes the container.');
  });
});
