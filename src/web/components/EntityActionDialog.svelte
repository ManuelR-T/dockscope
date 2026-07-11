<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { EntityAction } from '../../core/entity-actions';
  import type {
    PluginConfig,
    PluginConfigField,
    PluginConfigValue,
  } from '../../core/plugin-config';

  interface Props {
    action: EntityAction;
    entityName: string;
    pending?: boolean;
    onConfirm: (input: PluginConfig) => void;
    onCancel: () => void;
  }

  let { action, entityName, pending = false, onConfirm, onCancel }: Props = $props();
  let dialog = $state<HTMLDialogElement | null>(null);
  let values = $state<PluginConfig>({});
  let confirmation = $state('');

  let fields = $derived(action.input?.fields ?? []);
  let requiredMissing = $derived(
    fields.some(
      (field) => field.required && (values[field.key] === '' || values[field.key] === undefined),
    ),
  );
  let confirmationMissing = $derived(
    Boolean(action.confirm?.typeToConfirm && confirmation !== action.confirm.typeToConfirm),
  );
  let invalid = $derived(requiredMissing || confirmationMissing || pending);

  function defaultValue(field: PluginConfigField): PluginConfigValue {
    if (field.default !== undefined) {
      return field.default;
    }
    if (field.type === 'boolean') {
      return false;
    }
    if (field.type === 'number') {
      return 0;
    }
    if (field.type === 'select') {
      return field.options?.[0]?.value ?? '';
    }
    return '';
  }

  function setValue(key: string, value: PluginConfigValue): void {
    values = { ...values, [key]: value };
  }

  function inputValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement).value;
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialog && !pending) {
      onCancel();
    }
  }

  $effect(() => {
    void action.id;
    values = Object.fromEntries(fields.map((field) => [field.key, defaultValue(field)]));
    confirmation = '';
  });

  onMount(async () => {
    dialog?.showModal();
    await tick();
    (dialog?.querySelector('input, select') as HTMLElement | null)?.focus();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="entity-action-title"
  oncancel={(event) => {
    event.preventDefault();
    if (!pending) {
      onCancel();
    }
  }}
  onclick={handleBackdropClick}
>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      if (!invalid) {
        onConfirm(values);
      }
    }}
  >
    <div id="entity-action-title" class="dialog-title">
      {action.confirm?.title ?? action.title}
    </div>
    <p>{action.confirm?.message ?? `${action.title} ${entityName}.`}</p>

    {#if fields.length > 0}
      <div class="field-grid">
        {#each fields as field (field.key)}
          <label class:checkbox={field.type === 'boolean'}>
            <span>{field.label}</span>
            {#if field.type === 'boolean'}
              <input
                type="checkbox"
                checked={values[field.key] === true}
                onchange={(event) =>
                  setValue(field.key, (event.currentTarget as HTMLInputElement).checked)}
              />
            {:else if field.type === 'select'}
              <select
                value={String(values[field.key] ?? '')}
                onchange={(event) =>
                  setValue(field.key, (event.currentTarget as HTMLSelectElement).value)}
              >
                {#each field.options ?? [] as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            {:else}
              <input
                type={field.type === 'number' ? 'number' : 'text'}
                value={String(values[field.key] ?? '')}
                required={field.required}
                oninput={(event) => {
                  const value = inputValue(event);
                  setValue(field.key, field.type === 'number' ? Number(value) : value);
                }}
              />
            {/if}
            {#if field.description}<small>{field.description}</small>{/if}
          </label>
        {/each}
      </div>
    {/if}

    {#if action.confirm?.typeToConfirm}
      <label class="confirm-field">
        <span>Type <strong>{action.confirm.typeToConfirm}</strong> to confirm</span>
        <input bind:value={confirmation} autocomplete="off" />
      </label>
    {/if}

    <div class="dialog-actions">
      <button type="button" class="cancel" disabled={pending} onclick={onCancel}>Cancel</button>
      <button type="submit" class:danger={action.tone === 'danger'} disabled={invalid}>
        {pending ? 'Running' : (action.confirm?.confirmLabel ?? action.title)}
      </button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    max-width: calc(100vw - 32px);
    padding: 0;
    margin: 0;
    border: 0;
    background: transparent;
    color: inherit;
    transform: translate(-50%, -50%);
  }

  dialog::backdrop {
    background: rgba(4, 4, 14, 0.72);
    backdrop-filter: blur(4px);
  }

  form {
    width: min(430px, calc(100vw - 32px));
    padding: 20px 24px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 7px;
    background: rgba(8, 10, 24, 0.98);
  }

  .dialog-title {
    margin-bottom: 8px;
    color: var(--accent-amber);
    font-family: var(--font-ui);
    font-size: 14px;
    font-weight: 600;
  }

  p {
    margin: 0 0 16px;
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.5;
  }

  .field-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }

  label {
    display: grid;
    gap: 6px;
    color: var(--text-dim);
    font-size: 9px;
    text-transform: uppercase;
  }

  label.checkbox {
    grid-template-columns: 1fr auto;
    align-items: center;
  }

  input,
  select {
    min-width: 0;
    width: 100%;
    padding: 7px 9px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 5px;
    outline: none;
    background: rgba(0, 0, 0, 0.3);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  input[type='checkbox'] {
    width: 15px;
    height: 15px;
    accent-color: var(--accent-cyan);
  }

  input:focus,
  select:focus {
    border-color: rgba(0, 228, 255, 0.35);
  }

  small {
    color: var(--text-dim);
    font-size: 8px;
    line-height: 1.4;
    text-transform: none;
  }

  .confirm-field {
    margin-top: 12px;
  }

  .confirm-field strong {
    color: var(--text-primary);
    font-family: var(--font-mono);
    text-transform: none;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }

  button {
    min-height: 30px;
    padding: 6px 14px;
    border: 1px solid rgba(0, 228, 255, 0.2);
    border-radius: 5px;
    background: rgba(0, 228, 255, 0.08);
    color: var(--accent-cyan);
    font-family: var(--font-ui);
    font-size: 10px;
    cursor: pointer;
  }

  button.cancel {
    border-color: rgba(255, 255, 255, 0.08);
    background: transparent;
    color: var(--text-dim);
  }

  button.danger {
    border-color: rgba(255, 43, 78, 0.25);
    background: rgba(255, 43, 78, 0.1);
    color: var(--accent-red);
  }

  button:disabled {
    cursor: wait;
    opacity: 0.45;
  }
</style>
