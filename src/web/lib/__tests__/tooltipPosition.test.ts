import { describe, expect, it } from 'vitest';
import {
  TOOLTIP_OFFSET,
  VIEWPORT_PADDING,
  resolveTooltipPosition,
  type Box,
  type Viewport,
} from '../tooltipPosition';

const viewport: Viewport = { width: 1000, height: 800 };
const tip: Box = { left: 0, top: 0, width: 100, height: 30 };

/** A trigger centred at (x, y). */
function trigger(x: number, y: number, width = 20, height = 20): Box {
  return { left: x - width / 2, top: y - height / 2, width, height };
}

describe('resolveTooltipPosition', () => {
  it('centres above the trigger by default', () => {
    const position = resolveTooltipPosition(trigger(500, 400), tip, viewport);

    expect(position.placement).toBe('top');
    expect(position.left).toBe(450);
    expect(position.top).toBe(400 - 10 - tip.height - TOOLTIP_OFFSET);
  });

  it.each(['top', 'bottom', 'left', 'right'] as const)('honours the requested %s', (placement) => {
    expect(resolveTooltipPosition(trigger(500, 400), tip, viewport, placement).placement).toBe(
      placement,
    );
  });

  // A toolbar at the top of the window is the common case for this app.
  it('flips below when there is no room above', () => {
    const position = resolveTooltipPosition(trigger(500, 12), tip, viewport, 'top');

    expect(position.placement).toBe('bottom');
    expect(position.top).toBe(22 + TOOLTIP_OFFSET);
  });

  it('flips above when there is no room below', () => {
    const position = resolveTooltipPosition(trigger(500, 790), tip, viewport, 'bottom');
    expect(position.placement).toBe('top');
  });

  it.each([
    ['left', 'right', trigger(12, 400)],
    ['right', 'left', trigger(988, 400)],
  ] as const)('flips %s to %s at the edge', (preferred, expected, box) => {
    expect(resolveTooltipPosition(box, tip, viewport, preferred).placement).toBe(expected);
  });

  it('keeps the bubble inside the viewport near a corner', () => {
    const position = resolveTooltipPosition(trigger(4, 400), tip, viewport, 'top');

    expect(position.left).toBeGreaterThanOrEqual(VIEWPORT_PADDING);
    expect(position.left + tip.width).toBeLessThanOrEqual(viewport.width - VIEWPORT_PADDING);
  });

  it('clamps against the right edge too', () => {
    const position = resolveTooltipPosition(trigger(996, 400), tip, viewport, 'top');
    expect(position.left + tip.width).toBeLessThanOrEqual(viewport.width - VIEWPORT_PADDING);
  });

  // Clamping must not slide the bubble over the thing it describes, so only
  // the cross axis is adjusted.
  it('never shifts along the axis it points at', () => {
    const box = trigger(500, 12);
    const position = resolveTooltipPosition(box, tip, viewport, 'top');
    expect(position.top).toBe(box.top + box.height + TOOLTIP_OFFSET);
  });

  it('gives up and keeps the preferred side when neither fits', () => {
    const tall: Box = { left: 0, top: 0, width: 100, height: 700 };
    const position = resolveTooltipPosition(trigger(500, 400), tall, viewport, 'top');
    expect(position.placement).toBe('top');
  });

  describe('arrow', () => {
    it('sits at the centre of an unclamped bubble', () => {
      const position = resolveTooltipPosition(trigger(500, 400), tip, viewport, 'top');
      expect(position.arrowOffset).toBe(tip.width / 2);
    });

    // The bubble slides sideways at the edge; the arrow has to follow or it
    // ends up pointing at empty space.
    it('follows the trigger when the bubble is clamped', () => {
      const box = trigger(20, 400);
      const position = resolveTooltipPosition(box, tip, viewport, 'top');

      const arrowScreenX = position.left + position.arrowOffset;
      expect(arrowScreenX).toBeCloseTo(box.left + box.width / 2, 5);
    });

    it('stops short of the corners', () => {
      const position = resolveTooltipPosition(trigger(0, 400), tip, viewport, 'top');
      expect(position.arrowOffset).toBeGreaterThanOrEqual(10);
      expect(position.arrowOffset).toBeLessThanOrEqual(tip.width - 10);
    });

    it('runs along the vertical edge for side placements', () => {
      const box = trigger(500, 400);
      const position = resolveTooltipPosition(box, tip, viewport, 'right');
      expect(position.top + position.arrowOffset).toBeCloseTo(box.top + box.height / 2, 5);
    });
  });
});
