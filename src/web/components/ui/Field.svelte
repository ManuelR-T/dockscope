<!--
  Label + control + hint/error wrapper.

  Takes the control as a snippet rather than rendering an input itself, so it
  works for text inputs, selects, checkboxes, and composite rows alike.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label?: string;
    /** Shown below the control in the normal tone. */
    hint?: string;
    /** Shown below the control in the danger tone, and takes precedence over hint. */
    error?: string;
    children: Snippet;
  }

  let { label, hint, error, children }: Props = $props();
</script>

<div class="ds-field">
  {#if label}
    <span class="ds-field-label">{label}</span>
  {/if}
  {@render children()}
  {#if error}
    <span class="ds-field-msg ds-field-msg--error">{error}</span>
  {:else if hint}
    <span class="ds-field-msg">{hint}</span>
  {/if}
</div>

<style>
  .ds-field {
    display: grid;
    gap: var(--space-sm);
    min-width: 0;
  }

  .ds-field-label {
    font-size: var(--text-sm);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(226, 232, 240, 0.5);
  }

  .ds-field-msg {
    font-size: var(--text-sm);
    line-height: 1.45;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }

  .ds-field-msg--error {
    color: var(--danger-fg);
  }
</style>
