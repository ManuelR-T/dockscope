import { TOOLTIP } from './constants';
import type { Placement } from './tooltipPosition';

export interface TooltipContent {
  text: string;
  /** Keyboard shortcut shown as a chip, e.g. `F` for zoom to fit. */
  shortcut?: string;
  placement?: Placement;
}

export interface ActiveTooltip extends TooltipContent {
  /**
   * The element described, not a snapshot of its box, so the bubble can be
   * re-measured when something moves it instead of being dismissed.
   */
  element: HTMLElement;
}

/**
 * When a tooltip opens, and how quickly.
 *
 * Kept out of the store so it can be tested with fake timers: the store is a
 * `.svelte.ts` rune module, which needs the Svelte compiler to run at all.
 */
export class TooltipScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private warmUntil = 0;
  private showing = false;

  constructor(
    private readonly onChange: (active: ActiveTooltip | null) => void,
    private readonly showDelay = TOOLTIP.showDelay,
    private readonly warmWindow = TOOLTIP.warmWindow,
    private readonly now: () => number = Date.now,
  ) {}

  private clear() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Ask for a tooltip. It appears after the delay, or at once if another one
   * was showing moments ago: waiting again while sweeping along a toolbar is
   * what makes a row of icon buttons feel like separate controls.
   */
  request(element: HTMLElement, content: TooltipContent): void {
    this.clear();
    const next: ActiveTooltip = { ...content, element };

    if (this.now() < this.warmUntil) {
      this.showing = true;
      this.onChange(next);
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.showing = true;
      this.onChange(next);
    }, this.showDelay);
  }

  cancel(): void {
    this.clear();
    // Only a tooltip that actually appeared keeps the group warm; otherwise a
    // stray mouseleave would make the next one open with no delay.
    if (this.showing) {
      this.warmUntil = this.now() + this.warmWindow;
      this.showing = false;
    }
    this.onChange(null);
  }

  /** Cancels and forgets the warm window, so the next hover feels fresh. */
  reset(): void {
    this.clear();
    this.showing = false;
    this.warmUntil = 0;
    this.onChange(null);
  }
}
