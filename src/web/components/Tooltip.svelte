<script lang="ts">
  import { getTooltipState, hideTooltip } from '../stores/tooltip.svelte';
  import { resolveTooltipPosition } from '../lib/tooltipPosition';
  import { TOOLTIP_ID } from '../lib/tooltip';

  const tooltips = getTooltipState();

  let bubble: HTMLDivElement | undefined = $state();
  let left = $state(0);
  let top = $state(0);
  let placement = $state<'top' | 'bottom' | 'left' | 'right'>('top');
  let arrowOffset = $state(0);
  let measured = $state(false);

  function reposition() {
    const active = tooltips.active;
    if (!active || !bubble) {
      return;
    }
    // A trigger that has left the document can no longer be described, and its
    // rect would read as zeros in the top-left corner.
    if (!active.element.isConnected) {
      hideTooltip();
      return;
    }

    const trigger = active.element.getBoundingClientRect();
    const self = bubble.getBoundingClientRect();
    const resolved = resolveTooltipPosition(
      { left: trigger.left, top: trigger.top, width: trigger.width, height: trigger.height },
      { left: 0, top: 0, width: self.width, height: self.height },
      { width: window.innerWidth, height: window.innerHeight },
      active.placement ?? 'top',
    );
    left = resolved.left;
    top = resolved.top;
    placement = resolved.placement;
    arrowOffset = resolved.arrowOffset;
    measured = true;
  }

  /**
   * Position after the bubble has rendered, because its size depends on the
   * text. Until then it is held invisible rather than unmounted, so there is
   * something to measure.
   */
  $effect(() => {
    if (!tooltips.active || !bubble) {
      measured = false;
      return;
    }
    reposition();
  });

  /**
   * Follow the trigger rather than dismissing when something moves.
   *
   * Dismissing on any scroll looks equivalent and is not: scroll events arrive
   * constantly from panes that are not involved, and the log view auto-scrolls
   * on every chunk, so a streaming container made every tooltip in the app
   * disappear on sight.
   */
  $effect(() => {
    if (!tooltips.active) {
      return;
    }
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('blur', hideTooltip);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('blur', hideTooltip);
    };
  });
</script>

{#if tooltips.active}
  <div
    bind:this={bubble}
    id={TOOLTIP_ID}
    class="tip tip--{placement}"
    class:measured
    role="tooltip"
    style="left: {left}px; top: {top}px; --arrow-offset: {arrowOffset}px;"
  >
    <span class="tip-text">{tooltips.active.text}</span>
    {#if tooltips.active.shortcut}
      <kbd class="tip-key">{tooltips.active.shortcut}</kbd>
    {/if}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    /* Above every modal: a tooltip describes whatever is on top. */
    z-index: 500;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 260px;
    padding: 5px 8px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 1.4;
    color: var(--text-primary);
    background: var(--bg-surface-solid);
    border: 1px solid var(--border-glow);
    border-radius: var(--radius-control);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    /* It follows the pointer's target, so it must never intercept the pointer
       or hovering the bubble would re-trigger its own trigger. */
    pointer-events: none;
    /* Hidden until measured, so the first frame is not drawn at 0,0. */
    opacity: 0;
    transition: opacity 90ms ease-out;
  }

  .tip.measured {
    opacity: 1;
  }

  .tip-text {
    white-space: pre-wrap;
  }

  .tip-key {
    flex-shrink: 0;
    padding: 1px 5px;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--accent-cyan);
    background: var(--accent-cyan-dim);
    border: 1px solid var(--border-glow);
    border-radius: var(--radius-sm);
  }

  /* Arrow: a rotated square tucked under the matching edge. */
  .tip::after {
    content: '';
    position: absolute;
    width: 6px;
    height: 6px;
    background: var(--bg-surface-solid);
    border: 1px solid var(--border-glow);
    transform: rotate(45deg);
  }

  .tip--top::after {
    bottom: -4px;
    left: var(--arrow-offset);
    margin-left: -3px;
    border-top: none;
    border-left: none;
  }

  .tip--bottom::after {
    top: -4px;
    left: var(--arrow-offset);
    margin-left: -3px;
    border-bottom: none;
    border-right: none;
  }

  .tip--left::after {
    right: -4px;
    top: var(--arrow-offset);
    margin-top: -3px;
    border-bottom: none;
    border-left: none;
  }

  .tip--right::after {
    left: -4px;
    top: var(--arrow-offset);
    margin-top: -3px;
    border-top: none;
    border-right: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .tip {
      transition: none;
    }
  }
</style>
