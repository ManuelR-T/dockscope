import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The store is a rune module and needs the Svelte compiler, which the test
// runner does not load. Stubbing it also keeps these tests on the action's own
// behaviour: what it binds, and when.
const shown: { text: string }[] = [];
let hidden = 0;
vi.mock('../../stores/tooltip.svelte', () => ({
  showTooltip: (_node: unknown, content: { text: string }) => shown.push(content),
  hideTooltip: () => {
    hidden += 1;
  },
}));

const { TOOLTIP_ID, tooltip } = await import('../tooltip');

/**
 * The action is applied by every primitive that accepts a `title`, including
 * typography ones that usually have none, so what it does when there is nothing
 * to show matters as much as what it does when there is.
 */

/** Minimal element stand-in: the action only needs listeners and attributes. */
function fakeNode() {
  const listeners = new Map<string, Set<EventListener>>();
  const attributes = new Map<string, string>();

  const node = {
    addEventListener(type: string, handler: EventListener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)!.add(handler);
    },
    removeEventListener(type: string, handler: EventListener) {
      listeners.get(type)?.delete(handler);
    },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    textContent: '',
    isConnected: true,
  } as unknown as HTMLElement;

  return {
    node,
    attributes,
    count: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
    fire: (type: string) => listeners.get(type)?.forEach((handler) => handler(new Event(type))),
  };
}

describe('tooltip action', () => {
  beforeEach(() => {
    shown.length = 0;
    hidden = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Otherwise every Chip and Text in the app carries six dead listeners.
  it('attaches nothing when there is no tooltip text', () => {
    const { node, count } = fakeNode();
    tooltip(node, undefined);
    expect(count()).toBe(0);
  });

  it.each(['', '   '])('treats %o as no tooltip', (text) => {
    const { node, count } = fakeNode();
    tooltip(node, text);
    expect(count()).toBe(0);
  });

  it('attaches once there is text', () => {
    const { node, count } = fakeNode();
    tooltip(node, 'Plugins');
    expect(count()).toBeGreaterThan(0);
  });

  it('starts listening when text arrives later', () => {
    const { node, count } = fakeNode();
    const handle = tooltip(node, undefined);
    expect(count()).toBe(0);

    handle.update('Plugins');
    expect(count()).toBeGreaterThan(0);
  });

  it('stops listening when the text goes away', () => {
    const { node, count } = fakeNode();
    const handle = tooltip(node, 'Plugins');
    handle.update(undefined);
    expect(count()).toBe(0);
  });

  it('detaches everything on destroy', () => {
    const { node, count } = fakeNode();
    tooltip(node, 'Plugins').destroy();
    expect(count()).toBe(0);
  });

  it('shows on hover and describes the trigger', () => {
    const { node, attributes, fire } = fakeNode();
    tooltip(node, 'Plugins');

    fire('mouseenter');

    expect(shown).toEqual([{ text: 'Plugins' }]);
    expect(attributes.get('aria-describedby')).toBe(TOOLTIP_ID);
  });

  it('hides again on leave', () => {
    const { node, attributes, fire } = fakeNode();
    tooltip(node, 'Plugins');

    fire('mouseenter');
    fire('mouseleave');

    expect(hidden).toBe(1);
    expect(attributes.get('aria-describedby')).toBeUndefined();
  });

  // Otherwise the browser draws its own tooltip next to this one.
  it('takes over the native title attribute', () => {
    const { node, attributes } = fakeNode();
    attributes.set('title', 'Plugins');

    const handle = tooltip(node, 'Plugins');
    expect(attributes.get('title')).toBeUndefined();
    // An icon-only control would otherwise lose its accessible name with it.
    expect(attributes.get('aria-label')).toBe('Plugins');

    handle.destroy();
    expect(attributes.get('title')).toBe('Plugins');
  });
});
