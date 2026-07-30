<!--
  Inline text that behaves as a button. Was `.copyable` in the global stylesheet,
  used for click-to-copy values, so it inherits the surrounding type rather than
  imposing its own.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    mono?: boolean;
    title?: string;
    ariaLabel?: string;
    onclick?: () => void;
    children: Snippet;
  }

  let { mono = false, title, ariaLabel, onclick, children }: Props = $props();
</script>

<button
  class="ds-textbtn"
  class:ds-textbtn--mono={mono}
  type="button"
  {title}
  aria-label={ariaLabel}
  {onclick}
>
  {@render children()}
</button>

<style>
  .ds-textbtn {
    padding: 0;
    background: none;
    border: none;
    border-radius: 3px;
    color: inherit;
    font: inherit;
    text-align: left;
    line-height: 1.5;
    word-break: break-all;
    cursor: pointer;
    transition: background 0.15s;
  }

  .ds-textbtn--mono {
    font-family: var(--font-mono);
  }

  .ds-textbtn:hover {
    background: var(--accent-cyan-dim);
    color: var(--accent-cyan);
  }
</style>
