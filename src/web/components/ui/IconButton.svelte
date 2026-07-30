<!--
  Square icon-only button.

  Distinct from Button because it is sized by its box rather than its padding,
  and because it must stay square regardless of whether it holds an SVG icon or
  a glyph such as a multiplication sign.

  Variants match the shapes already in the app:
    bare    -> no border, dim glyph      (was HostManager's close/remove buttons)
    outline -> subtle border, dim glyph  (was PluginManager's close button)
    surface -> panel background + accent border on hover (was the graph controls)
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'bare' | 'outline' | 'accent' | 'surface' | 'filled';
    /** Colour for the `filled` variant, matching Button's tones. */
    tone?: 'accent' | 'success' | 'warn' | 'danger';
    size?: number;
    /** Font size for glyph content such as "×". Ignored for SVG children. */
    glyphSize?: number;
    title?: string;
    ariaLabel?: string;
    disabled?: boolean;
    danger?: boolean;
    /** Toggled-on state, rendered in the amber accent. */
    active?: boolean;
    /** Spins the icon, for an action that is in flight. */
    spinning?: boolean;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  }

  let {
    variant = 'bare',
    tone = 'accent',
    size = 26,
    glyphSize,
    title,
    ariaLabel,
    disabled = false,
    danger = false,
    active = false,
    spinning = false,
    onclick,
    children,
  }: Props = $props();
</script>

<button
  class="ds-iconbtn ds-iconbtn--{variant} ds-iconbtn--tone-{tone}"
  class:ds-iconbtn--danger={danger}
  class:ds-iconbtn--active={active}
  class:ds-iconbtn--spinning={spinning}
  aria-pressed={active}
  style:--ds-iconbtn-size="{size}px"
  style:--ds-iconbtn-glyph={glyphSize ? `${glyphSize}px` : null}
  {title}
  aria-label={ariaLabel ?? title}
  {disabled}
  {onclick}
>
  {@render children()}
</button>

<style>
  .ds-iconbtn {
    width: var(--ds-iconbtn-size);
    height: var(--ds-iconbtn-size);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    padding: 0;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: rgba(255, 255, 255, 0.35);
    font-family: inherit;
    font-size: var(--ds-iconbtn-glyph, inherit);
    line-height: 1;
    cursor: pointer;
    transition:
      color 0.15s,
      border-color 0.15s,
      background 0.15s;
  }

  .ds-iconbtn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .ds-iconbtn--spinning :global(svg) {
    animation: ds-iconbtn-spin 0.8s linear infinite;
  }

  @keyframes ds-iconbtn-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .ds-iconbtn:hover:not(:disabled) {
    color: var(--text-primary);
  }

  .ds-iconbtn--outline {
    border-color: rgba(255, 255, 255, 0.05);
  }

  .ds-iconbtn--outline:hover:not(:disabled) {
    background: rgba(0, 228, 255, 0.06);
    border-color: rgba(0, 228, 255, 0.2);
    color: var(--accent-cyan);
  }

  /* Transparent with an accent edge, for controls sitting on their own bar. */
  .ds-iconbtn--accent {
    border-color: var(--control-border);
    border-radius: var(--radius-chip);
    color: var(--text-secondary);
  }

  .ds-iconbtn--accent:hover:not(:disabled) {
    background: var(--control-bg);
    border-color: var(--control-border-strong);
    color: var(--accent-cyan);
  }

  .ds-iconbtn--surface {
    background: rgba(8, 10, 24, 0.7);
    backdrop-filter: blur(8px);
    border-color: var(--border-glow);
    border-radius: var(--radius-control);
    color: rgba(122, 133, 153, 0.8);
  }

  .ds-iconbtn--surface:hover:not(:disabled) {
    background: var(--control-bg);
    border-color: rgba(0, 228, 255, 0.25);
    color: var(--accent-cyan);
  }

  .ds-iconbtn--danger:hover:not(:disabled) {
    color: var(--accent-red);
    border-color: var(--danger-border);
  }

  /* Filled square action button, coloured by tone. */
  .ds-iconbtn--filled {
    background: var(--ds-icon-bg);
    border-color: var(--ds-icon-border);
    border-radius: var(--radius-control);
    color: var(--ds-icon-fg);
  }

  .ds-iconbtn--filled:hover:not(:disabled) {
    background: var(--ds-icon-bg-hover);
    color: var(--ds-icon-fg);
  }

  .ds-iconbtn--tone-accent {
    --ds-icon-bg: rgba(0, 228, 255, 0.06);
    --ds-icon-border: rgba(0, 228, 255, 0.12);
    --ds-icon-bg-hover: rgba(0, 228, 255, 0.14);
    --ds-icon-fg: var(--accent-cyan);
  }

  .ds-iconbtn--tone-success {
    --ds-icon-bg: rgba(0, 255, 106, 0.06);
    --ds-icon-border: rgba(0, 255, 106, 0.12);
    --ds-icon-bg-hover: rgba(0, 255, 106, 0.14);
    --ds-icon-fg: var(--accent-green);
  }

  .ds-iconbtn--tone-warn {
    --ds-icon-bg: var(--accent-amber-dim);
    --ds-icon-border: rgba(255, 138, 43, 0.12);
    --ds-icon-bg-hover: rgba(255, 138, 43, 0.2);
    --ds-icon-fg: var(--accent-amber);
  }

  .ds-iconbtn--tone-danger {
    --ds-icon-bg: rgba(255, 43, 78, 0.06);
    --ds-icon-border: rgba(255, 43, 78, 0.12);
    --ds-icon-bg-hover: rgba(255, 43, 78, 0.14);
    --ds-icon-fg: var(--accent-red);
  }

  /* Toggled-on state for the bare and outline variants. */
  .ds-iconbtn--active:not(.ds-iconbtn--filled) {
    background: rgba(0, 228, 255, 0.06);
    border-color: rgba(0, 228, 255, 0.2);
    color: var(--accent-cyan);
  }

  .ds-iconbtn--surface.ds-iconbtn--active,
  .ds-iconbtn--surface.ds-iconbtn--active:hover:not(:disabled) {
    background: var(--accent-amber-dim);
    border-color: rgba(255, 138, 43, 0.4);
    color: var(--accent-amber);
  }
</style>
