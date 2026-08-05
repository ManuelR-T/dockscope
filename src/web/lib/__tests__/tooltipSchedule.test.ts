import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipScheduler, type ActiveTooltip } from '../tooltipSchedule';

// The scheduler only carries the element through; measuring is the
// component's job, so a stand-in is enough here.
const element = { isConnected: true } as unknown as HTMLElement;
const DELAY = 400;
const WARM = 500;

function scheduler() {
  const seen: (ActiveTooltip | null)[] = [];
  const instance = new TooltipScheduler(
    (active) => seen.push(active),
    DELAY,
    WARM,
    () => Date.now(),
  );
  return { instance, seen, current: () => seen.at(-1) ?? null };
}

describe('TooltipScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits before showing, so a cursor passing over stays quiet', () => {
    const { instance, current } = scheduler();

    instance.request(element, { text: 'Plugins' });
    vi.advanceTimersByTime(DELAY - 1);
    expect(current()).toBeNull();

    vi.advanceTimersByTime(1);
    expect(current()).toMatchObject({ text: 'Plugins' });
  });

  it('shows nothing when the pointer leaves before the delay elapses', () => {
    const { instance, seen } = scheduler();

    instance.request(element, { text: 'Plugins' });
    vi.advanceTimersByTime(DELAY - 1);
    instance.cancel();
    vi.advanceTimersByTime(DELAY);

    expect(seen.some((entry) => entry !== null)).toBe(false);
  });

  it('carries the trigger box and shortcut through', () => {
    const { instance, current } = scheduler();

    instance.request(element, { text: 'Zoom to fit', shortcut: 'F' });
    vi.advanceTimersByTime(DELAY);

    expect(current()).toMatchObject({ text: 'Zoom to fit', shortcut: 'F', element });
  });

  // Sweeping along a toolbar should not mean waiting out the delay on every
  // button, which is what makes a row of icons feel like one control strip.
  it('opens the next one immediately while the group is warm', () => {
    const { instance, current } = scheduler();

    instance.request(element, { text: 'First' });
    vi.advanceTimersByTime(DELAY);
    instance.cancel();

    instance.request(element, { text: 'Second' });
    expect(current()).toMatchObject({ text: 'Second' });
  });

  it('goes back to waiting once the group has gone cold', () => {
    const { instance, current } = scheduler();

    instance.request(element, { text: 'First' });
    vi.advanceTimersByTime(DELAY);
    instance.cancel();
    vi.advanceTimersByTime(WARM + 1);

    instance.request(element, { text: 'Second' });
    expect(current()).toBeNull();

    vi.advanceTimersByTime(DELAY);
    expect(current()).toMatchObject({ text: 'Second' });
  });

  // Otherwise a stray mouseleave would make the next tooltip open instantly.
  it('does not warm the group when nothing was showing', () => {
    const { instance, current } = scheduler();

    instance.cancel();
    instance.request(element, { text: 'Plugins' });
    expect(current()).toBeNull();
  });

  it('replaces a pending tooltip rather than queueing both', () => {
    const { instance, seen, current } = scheduler();

    instance.request(element, { text: 'First' });
    vi.advanceTimersByTime(DELAY - 10);
    instance.request(element, { text: 'Second' });
    vi.advanceTimersByTime(DELAY);

    expect(current()).toMatchObject({ text: 'Second' });
    expect(seen.filter((entry) => entry !== null)).toHaveLength(1);
  });

  it('clears the warm window on reset', () => {
    const { instance, current } = scheduler();

    instance.request(element, { text: 'First' });
    vi.advanceTimersByTime(DELAY);
    instance.reset();

    instance.request(element, { text: 'Second' });
    expect(current()).toBeNull();
  });

  it('stops a pending tooltip from firing after a reset', () => {
    const { instance, seen } = scheduler();

    instance.request(element, { text: 'Plugins' });
    instance.reset();
    vi.advanceTimersByTime(DELAY * 2);

    expect(seen.some((entry) => entry !== null)).toBe(false);
  });
});
