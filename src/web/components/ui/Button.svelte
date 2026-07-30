<!--
  Shared button primitive.

  Variants were derived from the rules that already existed across the app
  rather than invented, so migrating a component is a like-for-like swap:
    secondary -> the accent-outline button (was .save-btn / .action-btn)
    primary   -> the filled accent button  (was .save-btn.primary)
    ghost     -> bare, dim, no border      (was .close-btn / .remove-btn)
    danger    -> neutral until hover, then red (was .remove-btn:hover)
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'primary' | 'secondary' | 'ghost' | 'surface';
  /** Colour, orthogonal to shape, for semantic actions such as start and stop. */
  type Tone = 'accent' | 'success' | 'warn' | 'danger';
  type Size = 'sm' | 'md' | 'lg';

  interface Props {
    variant?: Variant;
    tone?: Tone;
    size?: Size;
    disabled?: boolean;
    /** Toggled-on state, for filter and option toggles. */
    active?: boolean;
    /** Fully rounded, for filter and reveal pills. */
    pill?: boolean;
    /** Monospace label, for the dense status-bar controls. */
    mono?: boolean;
    /** Renders as a full-width block, for stacked action groups. */
    block?: boolean;
    type?: 'button' | 'submit';
    title?: string;
    ariaLabel?: string;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  }

  let {
    variant = 'secondary',
    tone = 'accent',
    size = 'md',
    disabled = false,
    active = false,
    pill = false,
    mono = false,
    block = false,
    type = 'button',
    title,
    ariaLabel,
    onclick,
    children,
  }: Props = $props();
</script>

<button
  class="ds-btn ds-btn--{variant} ds-btn--{size} ds-btn--tone-{tone}"
  class:ds-btn--block={block}
  class:ds-btn--active={active}
  class:ds-btn--pill={pill}
  class:ds-btn--mono={mono}
  aria-pressed={active ? true : undefined}
  {type}
  {title}
  {disabled}
  aria-label={ariaLabel}
  {onclick}
>
  {@render children()}
</button>

<style>
  .ds-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    /* Never stretch to a flex parent's cross axis, so containers do not have to
       correct for it with their own rules. */
    flex: 0 0 auto;
    align-self: center;
    border-radius: var(--radius-control);
    font-family: inherit;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;
  }

  .ds-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .ds-btn--block {
    display: flex;
    width: 100%;
  }

  .ds-btn--pill {
    border-radius: 10px;
  }

  .ds-btn--mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.5px;
  }

  /* Toggled-on state. Ghost is the shape filter toggles use at rest. */
  .ds-btn--ghost.ds-btn--active {
    background: rgba(0, 228, 255, 0.06);
    border-color: rgba(0, 228, 255, 0.2);
    color: var(--text-primary);
  }

  /* ---- sizes ---- */
  .ds-btn--sm {
    padding: 3px 8px;
    font-size: var(--text-sm);
  }

  .ds-btn--md {
    padding: 6px 10px;
    font-size: var(--text-base);
  }

  .ds-btn--lg {
    padding: 9px 12px;
    font-size: var(--text-md);
    font-weight: 600;
  }

  /* ---- shape ---- */
  /* Colour comes from the tone rules below, via the --ds-btn-* custom
     properties, so shape and colour stay independent. */
  .ds-btn--secondary {
    background: var(--ds-btn-bg);
    border: 1px solid var(--ds-btn-border);
    color: var(--ds-btn-fg);
  }

  .ds-btn--secondary:hover:not(:disabled) {
    background: var(--ds-btn-bg-hover);
  }

  .ds-btn--primary {
    background: var(--ds-btn-bg-hover);
    border: 1px solid var(--ds-btn-border-strong);
    color: var(--ds-btn-fg-strong);
  }

  .ds-btn--primary:hover:not(:disabled) {
    background: var(--ds-btn-bg-active);
  }

  /* Floats over the graph: panel background with a blur behind it. */
  .ds-btn--surface {
    background: rgba(6, 8, 18, 0.84);
    border: 1px solid var(--border-glow);
    color: var(--text-secondary);
    font-weight: 400;
    backdrop-filter: blur(16px);
  }

  .ds-btn--surface:hover:not(:disabled) {
    border-color: rgba(0, 228, 255, 0.24);
    color: var(--accent-cyan);
  }

  .ds-btn--ghost {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: var(--control-ghost-fg);
    font-weight: 400;
  }

  .ds-btn--ghost:hover:not(:disabled) {
    background: var(--ds-btn-bg);
    border-color: var(--ds-btn-border);
    color: var(--ds-btn-fg);
  }

  /* ---- tones ---- */
  .ds-btn--tone-accent {
    --ds-btn-bg: var(--control-bg);
    --ds-btn-border: var(--control-border);
    --ds-btn-bg-hover: var(--control-bg-hover);
    --ds-btn-bg-active: rgba(0, 228, 255, 0.2);
    --ds-btn-border-strong: var(--control-border-strong);
    --ds-btn-fg: var(--accent-cyan);
    --ds-btn-fg-strong: var(--control-fg-strong);
  }

  .ds-btn--tone-success {
    --ds-btn-bg: rgba(0, 255, 106, 0.06);
    --ds-btn-border: rgba(0, 255, 106, 0.15);
    --ds-btn-bg-hover: rgba(0, 255, 106, 0.14);
    --ds-btn-bg-active: rgba(0, 255, 106, 0.2);
    --ds-btn-border-strong: rgba(0, 255, 106, 0.32);
    --ds-btn-fg: var(--accent-green);
    --ds-btn-fg-strong: #d6ffe8;
  }

  .ds-btn--tone-warn {
    --ds-btn-bg: rgba(255, 138, 43, 0.06);
    --ds-btn-border: rgba(255, 138, 43, 0.15);
    --ds-btn-bg-hover: rgba(255, 138, 43, 0.14);
    --ds-btn-bg-active: rgba(255, 138, 43, 0.2);
    --ds-btn-border-strong: rgba(255, 138, 43, 0.32);
    --ds-btn-fg: var(--accent-amber);
    --ds-btn-fg-strong: #ffe6d0;
  }

  .ds-btn--tone-danger {
    --ds-btn-bg: rgba(255, 43, 78, 0.06);
    --ds-btn-border: rgba(255, 43, 78, 0.15);
    --ds-btn-bg-hover: rgba(255, 43, 78, 0.14);
    --ds-btn-bg-active: rgba(255, 43, 78, 0.2);
    --ds-btn-border-strong: rgba(255, 43, 78, 0.32);
    --ds-btn-fg: var(--accent-red);
    --ds-btn-fg-strong: #ffd9df;
  }
</style>
