<!-- Container for Tab items. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** `section` adds the bar padding and underline the sidebar tabs use. */
    variant?: 'panel' | 'section';
    ariaLabel?: string;
    children: Snippet;
  }

  let { variant = 'panel', ariaLabel, children }: Props = $props();
</script>

<div class="ds-tabbar ds-tabbar--{variant}" role="tablist" aria-label={ariaLabel}>
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
</style>
