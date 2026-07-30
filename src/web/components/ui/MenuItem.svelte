<!--
  Full-width row inside a dropdown menu. Was `.more-item` in the global stylesheet.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    tone?: 'default' | 'danger';
    disabled?: boolean;
    onclick?: () => void;
    children: Snippet;
  }

  let { tone = 'default', disabled = false, onclick, children }: Props = $props();
</script>

<button class="ds-menuitem ds-menuitem--{tone}" type="button" role="menuitem" {disabled} {onclick}>
  {@render children()}
</button>

<style>
  .ds-menuitem {
    display: block;
    width: 100%;
    padding: 6px 14px;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: var(--text-base);
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
  }

  .ds-menuitem:hover:not(:disabled) {
    background: #121428;
  }

  .ds-menuitem:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .ds-menuitem--danger {
    color: var(--accent-red);
  }

  .ds-menuitem--danger:hover:not(:disabled) {
    background: #1a0a12;
  }
</style>
