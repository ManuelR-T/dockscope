<!--
  Shared badge/chip primitive for short status and metadata labels.

  Tones map onto the existing accent tokens. `uppercase` matches the badge style
  used for status labels, while the default lowercase form suits metadata facts
  such as tag counts and licences.
-->
<script lang="ts">
  import { tooltip } from '../../lib/tooltip';
  import type { Snippet } from 'svelte';

  type Tone = 'neutral' | 'accent' | 'warn' | 'danger' | 'success' | 'info';

  interface Props {
    tone?: Tone;
    /** Uppercase, letter-spaced status badge instead of a plain metadata chip. */
    uppercase?: boolean;
    /** Rounded pill with more horizontal padding, for prominent status labels. */
    pill?: boolean;
    /** Heavier label, for state badges. */
    bold?: boolean;
    mono?: boolean;
    title?: string;
    children: Snippet;
  }

  let {
    tone = 'neutral',
    uppercase = false,
    pill = false,
    bold = false,
    mono = false,
    title,
    children,
  }: Props = $props();
</script>

<span
  class="ds-chip ds-chip--{tone}"
  class:ds-chip--uppercase={uppercase}
  class:ds-chip--pill={pill}
  class:ds-chip--bold={bold}
  class:ds-chip--mono={mono}
  use:tooltip={title}
>
  {@render children()}
</span>

<style>
  .ds-chip {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    /* A badge labels its container; it must not stretch to the container's
       height when it sits in a tall flex row. */
    align-self: flex-start;
    padding: 2px 6px;
    border-radius: var(--radius-chip);
    font-size: var(--text-sm);
    line-height: 1.4;
    white-space: nowrap;
  }

  .ds-chip--uppercase {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: var(--text-xs);
  }

  .ds-chip--bold {
    font-weight: 700;
  }

  .ds-chip--pill {
    padding: 3px 9px;
    border-radius: 10px;
    font-weight: 600;
  }

  .ds-chip--mono {
    font-family: var(--font-mono);
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .ds-chip--neutral {
    background: var(--surface-chip);
    color: rgba(226, 232, 240, 0.6);
  }

  .ds-chip--accent {
    background: var(--accent-cyan-dim);
    color: #7fe9ff;
  }

  .ds-chip--warn {
    background: var(--accent-amber-dim);
    color: var(--accent-amber);
  }

  .ds-chip--danger {
    background: var(--accent-red-dim);
    color: var(--accent-red);
  }

  .ds-chip--info {
    background: rgba(168, 85, 247, 0.12);
    color: #bda5ff;
  }

  .ds-chip--success {
    background: var(--accent-green-dim);
    color: var(--accent-green);
  }
</style>
