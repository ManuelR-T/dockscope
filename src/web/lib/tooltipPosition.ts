/**
 * Placement maths for the tooltip, kept free of the DOM so it can be tested.
 *
 * The bubble is rendered at the document root and positioned with viewport
 * coordinates rather than being nested next to its trigger. Nesting looks
 * simpler right up until an ancestor clips or contains it: the status bar sets
 * both `overflow: hidden` and `backdrop-filter`, and the latter makes it a
 * containing block for fixed-position children.
 */

export type Placement = 'top' | 'bottom' | 'left' | 'right';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Positioned {
  left: number;
  top: number;
  placement: Placement;
  /**
   * Where the arrow sits along the bubble's edge, in pixels from its leading
   * corner. Needed because a clamped bubble is no longer centred on its
   * trigger, and an arrow stuck at 50% would point at nothing.
   */
  arrowOffset: number;
}

/** Gap between the trigger and the bubble, leaving room for the arrow. */
export const TOOLTIP_OFFSET = 8;

/** Closest the bubble may sit to the viewport edge. */
export const VIEWPORT_PADDING = 6;

const OPPOSITE: Record<Placement, Placement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/** Distance the arrow keeps from the bubble's corners. */
const ARROW_INSET = 10;

function coordsFor(
  placement: Placement,
  trigger: Box,
  tooltip: Box,
): Omit<Positioned, 'arrowOffset'> {
  const centreX = trigger.left + trigger.width / 2 - tooltip.width / 2;
  const centreY = trigger.top + trigger.height / 2 - tooltip.height / 2;

  switch (placement) {
    case 'top':
      return { left: centreX, top: trigger.top - tooltip.height - TOOLTIP_OFFSET, placement };
    case 'bottom':
      return { left: centreX, top: trigger.top + trigger.height + TOOLTIP_OFFSET, placement };
    case 'left':
      return { left: trigger.left - tooltip.width - TOOLTIP_OFFSET, top: centreY, placement };
    case 'right':
      return { left: trigger.left + trigger.width + TOOLTIP_OFFSET, top: centreY, placement };
  }
}

function fitsInViewport(
  position: Omit<Positioned, 'arrowOffset'>,
  tooltip: Box,
  viewport: Viewport,
): boolean {
  return (
    position.left >= VIEWPORT_PADDING &&
    position.top >= VIEWPORT_PADDING &&
    position.left + tooltip.width <= viewport.width - VIEWPORT_PADDING &&
    position.top + tooltip.height <= viewport.height - VIEWPORT_PADDING
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Where to put the bubble.
 *
 * Tries the requested side, flips to the opposite side when that would leave
 * the viewport, and finally clamps along the cross axis so a tooltip on a
 * button at the very edge of the screen stays readable rather than being cut
 * off. Clamping never happens on the axis that points at the trigger, so the
 * bubble cannot end up sitting on top of what it describes.
 */
export function resolveTooltipPosition(
  trigger: Box,
  tooltip: Box,
  viewport: Viewport,
  preferred: Placement = 'top',
): Positioned {
  const candidate = coordsFor(preferred, trigger, tooltip);
  const chosen = fitsInViewport(candidate, tooltip, viewport)
    ? candidate
    : (() => {
        const flipped = coordsFor(OPPOSITE[preferred], trigger, tooltip);
        return fitsInViewport(flipped, tooltip, viewport) ? flipped : candidate;
      })();

  const maxLeft = Math.max(VIEWPORT_PADDING, viewport.width - tooltip.width - VIEWPORT_PADDING);
  const maxTop = Math.max(VIEWPORT_PADDING, viewport.height - tooltip.height - VIEWPORT_PADDING);

  const vertical = chosen.placement === 'top' || chosen.placement === 'bottom';
  // Only the cross axis is clamped: nudging along the pointing axis would
  // slide the bubble over the trigger.
  const left = vertical ? clamp(chosen.left, VIEWPORT_PADDING, maxLeft) : chosen.left;
  const top = vertical ? chosen.top : clamp(chosen.top, VIEWPORT_PADDING, maxTop);

  // The arrow tracks the trigger's centre even when clamping has pushed the
  // bubble sideways, stopping just short of the rounded corners.
  const arrowOffset = vertical
    ? clamp(
        trigger.left + trigger.width / 2 - left,
        ARROW_INSET,
        Math.max(ARROW_INSET, tooltip.width - ARROW_INSET),
      )
    : clamp(
        trigger.top + trigger.height / 2 - top,
        ARROW_INSET,
        Math.max(ARROW_INSET, tooltip.height - ARROW_INSET),
      );

  return { placement: chosen.placement, left, top, arrowOffset };
}
