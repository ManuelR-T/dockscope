<!-- Container for Tab items. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** `section` adds the bar padding and underline the sidebar tabs use. */
    variant?: 'panel' | 'section';
    /** Allow tabs to wrap onto multiple rows when there are many of them. */
    wrap?: boolean;
    ariaLabel?: string;
    children: Snippet;
  }

  let { variant = 'panel', wrap = false, ariaLabel, children }: Props = $props();
</script>

<div
  class="ds-tabbar ds-tabbar--{variant}"
  class:ds-tabbar--wrap={wrap}
  role="tablist"
  aria-label={ariaLabel}
>
  {@render children()}
</div>

<style>
  .ds-tabbar {
    display: flex;
    gap: 2px;
    min-width: 0;
  }

  .ds-tabbar--section {
    padding: 0 20px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .ds-tabbar--wrap {
    flex-wrap: wrap;
  }
</style>
