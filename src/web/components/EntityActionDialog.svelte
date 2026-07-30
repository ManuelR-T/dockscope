<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Button, Select, TextInput } from './ui';
  import type { EntityAction } from '../../core/entities/actions';
  import type {
    PluginConfig,
    PluginConfigField,
    PluginConfigValue,
  } from '../../core/plugin-contract/config';

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
              <Select
                ariaLabel={field.label}
                value={String(values[field.key] ?? '')}
                options={(field.options ?? []).map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                onchange={(value) => setValue(field.key, value)}
              />
            {:else}
              <TextInput
                ariaLabel={field.label}
                type={field.type === 'number' ? 'number' : 'text'}
                value={String(values[field.key] ?? '')}
                oninput={(value) =>
                  setValue(field.key, field.type === 'number' ? Number(value) : value)}
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
        <TextInput bind:value={confirmation} ariaLabel="Confirmation" />
      </label>
    {/if}

    <div class="dialog-actions">
      <Button variant="ghost" disabled={pending} onclick={onCancel}>Cancel</Button>
      <Button
        type="submit"
        variant="primary"
        tone={action.tone === 'danger' ? 'danger' : 'accent'}
        disabled={invalid}
      >
        {pending ? 'Running' : (action.confirm?.confirmLabel ?? action.title)}
      </Button>
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
    font-size: var(--text-xl);
    font-weight: 600;
  }

  p {
    margin: 0 0 16px;
    color: var(--text-dim);
    font-size: var(--text-base);
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
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  label.checkbox {
    grid-template-columns: 1fr auto;
    align-items: center;
  }

  /* The only raw control left here; there is no checkbox primitive. */
  input[type='checkbox'] {
    width: 15px;
    height: 15px;
    accent-color: var(--accent-cyan);
  }

  small {
    color: var(--text-dim);
    font-size: var(--text-2xs);
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
</style>
