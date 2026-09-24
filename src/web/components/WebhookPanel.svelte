<script lang="ts">
  import { onMount } from 'svelte';
  import { apiErrorMessage, deleteJson, getJson, requestJson } from '../lib/api';
  import { addToast } from '../stores/toast.svelte';
  import { Button, CloseButton, Field, Select, TextInput } from './ui';

  let { onClose }: { onClose: () => void } = $props();
  interface Status {
    enabled: boolean;
    managedByEnv: boolean;
    format: string;
    destination: string | null;
  }
  let dialog: HTMLDialogElement;
  let status = $state<Status | null>(null);
  let url = $state('');
  let format = $state('json');
  let busy = $state(false);
  let error = $state('');
  let confirmingDisable = $state(false);

  function loaded(next: Status) {
    status = next;
    format = next.format;
    url = '';
    confirmingDisable = false;
  }

  onMount(() => {
    dialog.showModal();
    getJson<Status>('/api/webhook')
      .then(loaded)
      .catch((cause) => {
        error = apiErrorMessage(cause);
      });
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !status || status.managedByEnv) {
      return;
    }
    busy = true;
    error = '';
    try {
      loaded(
        await requestJson<Status>('/api/webhook', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, format }),
        }),
      );
      addToast('Webhook alerts enabled', 'success');
    } catch (cause) {
      error = apiErrorMessage(cause);
    } finally {
      busy = false;
    }
  }

  async function disable() {
    if (busy || status?.managedByEnv) {
      return;
    }
    busy = true;
    error = '';
    try {
      loaded(await deleteJson<Status>('/api/webhook'));
      addToast('Webhook alerts disabled', 'info');
    } catch (cause) {
      error = apiErrorMessage(cause);
    } finally {
      busy = false;
    }
  }
</script>

<dialog bind:this={dialog} aria-label="Webhook alerts" onclose={onClose}>
  <header>
    <h2>Webhook alerts</h2>
    <CloseButton onclick={onClose} />
  </header>
  <p>Get anomaly and crash notifications even when the dashboard is closed.</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if status}
    <p class="status">{status.enabled ? `Enabled — ${status.destination}` : 'Not configured'}</p>
    {#if status.managedByEnv}
      <p>Managed by environment variables on the server. Change the webhook URL or format there.</p>
      <Field label="Format"><span>{status.format}</span></Field>
    {:else}
      <form onsubmit={save}>
        <Field
          label="Webhook URL"
          hint={status.enabled
            ? 'Leave blank to keep the saved URL. Enter a new URL to replace it.'
            : 'Paste the URL from your webhook receiver, Slack, or Discord.'}
        >
          <TextInput
            type="password"
            ariaLabel="Webhook URL"
            bind:value={url}
            placeholder={status.enabled ? 'Saved URL (hidden)' : 'https://…'}
            disabled={busy}
          />
        </Field>
        <Field label="Format">
          <Select
            ariaLabel="Webhook format"
            bind:value={format}
            disabled={busy}
            options={[
              { value: 'json', label: 'Generic JSON' },
              { value: 'slack', label: 'Slack' },
              { value: 'discord', label: 'Discord' },
            ]}
          />
        </Field>
        <p class="hint">
          Changes apply immediately and survive restarts. JSON alerts include diagnostic log
          excerpts; Slack and Discord receive summaries.
        </p>
        <Button type="submit" disabled={busy || (!status.enabled && !url.trim())}
          >{busy ? 'Saving…' : 'Save webhook'}</Button
        >
      </form>
      {#if status.enabled}
        <div class="disable">
          {#if confirmingDisable}
            <p>Stop webhook alerts and remove the saved URL?</p>
            <Button tone="danger" disabled={busy} onclick={disable}>Disable alerts</Button>
            <Button variant="ghost" disabled={busy} onclick={() => (confirmingDisable = false)}
              >Cancel</Button
            >
          {:else}
            <Button
              variant="ghost"
              tone="danger"
              disabled={busy}
              onclick={() => (confirmingDisable = true)}>Disable webhook</Button
            >
          {/if}
        </div>
      {/if}
    {/if}
  {:else if !error}
    <p>Loading settings…</p>
  {/if}
</dialog>

<style>
  dialog {
    width: min(460px, calc(100% - 40px));
    margin: auto;
    max-height: 90vh;
    overflow-y: auto;
    padding: 24px;
    border: 1px solid var(--border-glow);
    border-radius: 12px;
    background: var(--bg-surface);
    color: var(--text-primary);
    box-shadow: 0 20px 70px rgba(0, 0, 0, 0.4);
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.65);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  p {
    color: var(--text-secondary);
    line-height: 1.5;
  }
  form {
    display: grid;
    gap: 16px;
  }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
  }
  .status {
    color: var(--accent-cyan);
  }
  .error {
    color: var(--accent-red);
  }
  .disable {
    margin-top: 16px;
    border-top: 1px solid var(--border-subtle);
    padding-top: 12px;
  }
</style>
