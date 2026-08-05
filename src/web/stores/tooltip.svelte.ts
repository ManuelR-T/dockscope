import { TooltipScheduler, type ActiveTooltip, type TooltipContent } from '../lib/tooltipSchedule';

export type { TooltipContent } from '../lib/tooltipSchedule';

/**
 * One bubble, many triggers.
 *
 * A tooltip per trigger would mean dozens of hidden nodes and dozens of
 * listeners; a single shared element is cheaper and makes the "only one can be
 * open" rule true by construction. Timing lives in TooltipScheduler.
 */
let active = $state<ActiveTooltip | null>(null);

const scheduler = new TooltipScheduler((next) => {
  active = next;
});

export function getTooltipState() {
  return {
    get active() {
      return active;
    },
  };
}

export function showTooltip(element: HTMLElement, content: TooltipContent): void {
  scheduler.request(element, content);
}

export function hideTooltip(): void {
  scheduler.cancel();
}

export function resetTooltips(): void {
  scheduler.reset();
}
