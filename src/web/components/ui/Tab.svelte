<!--
  Tab button. Pair with TabBar.

  Two variants, both derived from tab bars that already existed:
    panel   -> inline tabs sized to their label, used inside modal panels
    section -> equal-width uppercase tabs that fill a section header

  They look different on purpose. Sharing one component keeps the active-state
  behaviour, focus handling, and ARIA wiring in one place.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    active?: boolean;
    variant?: 'panel' | 'section';
    title?: string;
    onclick?: () => void;
    children: Snippet;
  }

  let { active = false, variant = 'panel', title, onclick, children }: Props = $props();
</script>

<button
  class="ds-tab ds-tab--{variant}"
  class:ds-tab--active={active}
  {title}
  role="tab"
  aria-selected={active}
  {onclick}
>
  {@render children()}
</button>

<style>
  .ds-tab {
    display: flex;
    align-items: center;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: rgba(122, 133, 153, 0.78);
    font-family: inherit;
    font-weight: 600;
    cursor: pointer;
    transition:
      color 0.25s,
      border-color 0.25s;
  }

  .ds-tab:hover:not(.ds-tab--active) {
    color: var(--text-secondary);
  }

  .ds-tab--panel {
    gap: 5px;
    padding: 8px 11px;
    font-size: var(--text-md);
    letter-spacing: 0.3px;
    white-space: nowrap;
  }

  /* Fills its bar and shares the width evenly with its siblings. */
  .ds-tab--section {
    flex: 1;
    justify-content: center;
    padding: 12px 0;
    font-size: var(--text-base);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-dim);
  }

  .ds-tab--active {
    color: var(--accent-cyan);
    border-bottom-color: var(--accent-cyan);
  }

  .ds-tab--section.ds-tab--active {
    text-shadow: 0 0 12px var(--accent-cyan-glow);
  }
</style>
