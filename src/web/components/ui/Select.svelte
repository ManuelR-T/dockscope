<!--
  Shared select primitive. Shares the control surface with TextInput so a form
  mixing the two lines up, which the previous `.input` class did by being applied
  to both element types.

  Options are passed as data rather than as a slot of <option> elements, so the
  control keeps a single source of truth for its value binding.
-->
<script lang="ts">
  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    value?: string;
    options: readonly Option[];
    disabled?: boolean;
    size?: 'md' | 'lg';
    /** Translucent HUD styling for the floating toolbar. */
    variant?: 'default' | 'hud';
    ariaLabel?: string;
    onchange?: (value: string) => void;
  }

  let {
    value = $bindable(''),
    options,
    disabled = false,
    size = 'md',
    variant = 'default',
    ariaLabel,
    onchange,
  }: Props = $props();
</script>

<select
  class="ds-select ds-select--{size} ds-select--{variant}"
  {disabled}
  aria-label={ariaLabel}
  bind:value
  onchange={(event) => onchange?.((event.currentTarget as HTMLSelectElement).value)}
>
  {#each options as option (option.value)}
    <option value={option.value}>{option.label}</option>
  {/each}
</select>

<style>
  .ds-select {
    width: 100%;
    min-width: 0;
    background: var(--bg-inset);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    color: var(--text-primary);
    font-family: inherit;
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .ds-select--md {
    padding: 6px 9px;
    font-size: var(--text-base);
  }

  .ds-select--lg {
    padding: 8px 10px;
    font-size: var(--text-md);
  }

  .ds-select--hud {
    background: rgba(255, 255, 255, 0.03);
    border-color: var(--border-subtle);
    color: var(--text-secondary);
    padding: 5px 8px;
    font-size: var(--text-base);
  }

  .ds-select:focus {
    border-color: var(--control-border-strong);
  }

  .ds-select:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
