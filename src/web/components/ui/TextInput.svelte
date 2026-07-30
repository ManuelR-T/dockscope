<!--
  Shared text input primitive, derived from the `.input` rule that already
  existed in HostManager. Value is bindable so call sites keep using `bind:value`
  rather than wiring their own oninput handler.
-->
<script lang="ts">
  interface Props {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    type?: 'text' | 'password' | 'url' | 'number';
    size?: 'md' | 'lg';
    /** Marks the control invalid, for example after a failed validation. */
    invalid?: boolean;
    mono?: boolean;
    ariaLabel?: string;
    onkeydown?: (event: KeyboardEvent) => void;
    /**
     * Reports the new value on every keystroke. Use this instead of `bind:value`
     * when the target is a dynamic key that cannot be bound directly.
     */
    oninput?: (value: string) => void;
  }

  let {
    value = $bindable(''),
    placeholder,
    disabled = false,
    type = 'text',
    size = 'md',
    invalid = false,
    mono = false,
    ariaLabel,
    onkeydown,
    oninput,
  }: Props = $props();
</script>

<input
  class="ds-input ds-input--{size}"
  class:ds-input--invalid={invalid}
  class:ds-input--mono={mono}
  {type}
  {placeholder}
  {disabled}
  aria-label={ariaLabel}
  aria-invalid={invalid}
  bind:value
  {onkeydown}
  oninput={(event) => oninput?.((event.currentTarget as HTMLInputElement).value)}
/>

<style>
  .ds-input {
    width: 100%;
    min-width: 0;
    background: var(--bg-inset);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    color: var(--text-primary);
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }

  .ds-input--md {
    padding: 6px 9px;
    font-size: var(--text-base);
  }

  .ds-input--lg {
    padding: 8px 10px;
    font-size: var(--text-md);
  }

  .ds-input--mono {
    font-family: var(--font-mono);
  }

  .ds-input::placeholder {
    color: rgba(226, 232, 240, 0.28);
  }

  .ds-input:focus {
    border-color: var(--control-border-strong);
  }

  .ds-input--invalid {
    border-color: var(--danger-border);
  }

  .ds-input:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
