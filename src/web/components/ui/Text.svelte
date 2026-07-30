<!--
  Typography primitive.

  Every size maps onto the `--text-*` scale in App.css, so there is no way to
  introduce an off-scale value through this component. Before it existed the app
  had 16 distinct font sizes including 8px, 9.5px, 10.5px and 11.5px, which is
  the drift this is meant to stop.

  `as` picks the element so headings stay headings for assistive tech while the
  visual size is chosen independently.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Named steps on the type scale, smallest to largest. */
  type Size = '2xs' | 'xs' | 'sm' | 'base' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  type Tone = 'primary' | 'secondary' | 'dim' | 'accent' | 'success' | 'warn' | 'danger';
  type Weight = 'normal' | 'medium' | 'semibold' | 'bold';

  interface Props {
    as?: 'span' | 'div' | 'p' | 'h2' | 'h3' | 'h4' | 'label' | 'strong' | 'small';
    size?: Size;
    tone?: Tone;
    weight?: Weight;
    mono?: boolean;
    /** Uppercase with tracking, for section labels. */
    caps?: boolean;
    /** Truncate to a single line with an ellipsis. */
    truncate?: boolean;
    title?: string;
    children: Snippet;
  }

  let {
    as = 'span',
    size = 'base',
    tone = 'primary',
    weight = 'normal',
    mono = false,
    caps = false,
    truncate = false,
    title,
    children,
  }: Props = $props();
</script>

<svelte:element
  this={as}
  class="ds-text ds-text--{size} ds-text--{tone} ds-text--w-{weight}"
  class:ds-text--mono={mono}
  class:ds-text--caps={caps}
  class:ds-text--truncate={truncate}
  {title}
>
  {@render children()}
</svelte:element>

<style>
  .ds-text {
    font-family: inherit;
    line-height: 1.45;
  }

  /* ---- size: every step comes from the shared scale ---- */
  .ds-text--2xs {
    font-size: var(--text-2xs);
  }
  .ds-text--xs {
    font-size: var(--text-xs);
  }
  .ds-text--sm {
    font-size: var(--text-sm);
  }
  .ds-text--base {
    font-size: var(--text-base);
  }
  .ds-text--md {
    font-size: var(--text-md);
  }
  .ds-text--lg {
    font-size: var(--text-lg);
  }
  .ds-text--xl {
    font-size: var(--text-xl);
  }
  .ds-text--2xl {
    font-size: var(--text-2xl);
  }
  .ds-text--3xl {
    font-size: var(--text-3xl);
  }

  /* ---- tone ---- */
  .ds-text--primary {
    color: var(--text-primary);
  }
  .ds-text--secondary {
    color: var(--text-secondary);
  }
  .ds-text--dim {
    color: var(--text-dim);
  }
  .ds-text--accent {
    color: var(--accent-cyan);
  }
  .ds-text--success {
    color: var(--accent-green);
  }
  .ds-text--warn {
    color: var(--accent-amber);
  }
  .ds-text--danger {
    color: var(--accent-red);
  }

  /* ---- weight ---- */
  .ds-text--w-normal {
    font-weight: 400;
  }
  .ds-text--w-medium {
    font-weight: 500;
  }
  .ds-text--w-semibold {
    font-weight: 600;
  }
  .ds-text--w-bold {
    font-weight: 700;
  }

  .ds-text--mono {
    font-family: var(--font-mono);
  }

  .ds-text--caps {
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .ds-text--truncate {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
