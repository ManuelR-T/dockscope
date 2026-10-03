<script lang="ts">
  import {
    WEBHOOK_EVENTS,
    DEFAULT_WEBHOOK_EVENTS,
    defaultWebhookScope,
    type WebhookSelection,
    type WebhookScope,
  } from '../../shared/webhooks';
  import { getDockerState } from '../stores/docker.svelte';
  import { onMount } from 'svelte';
  import { apiErrorMessage, deleteJson, getJson, requestJson } from '../lib/api';
  import { addToast } from '../stores/toast.svelte';
  import { Button, CloseButton, Field, Select, TextInput } from './ui';

  let { onClose }: { onClose: () => void } = $props();
  interface Status extends WebhookSelection {
    enabled: boolean;
    managedByEnv: boolean;
    format: string;
    destination: string | null;
  }
  const docker = getDockerState();
  let sources = $state<{ id: string; label: string }[]>([]);
  let events = $state<string[]>([...DEFAULT_WEBHOOK_EVENTS]);
  let scope = $state<WebhookScope>(defaultWebhookScope());
  const key = (value: unknown) => JSON.stringify(value);
  let sourceOptions = $derived([
    ...new Map([
      ...sources.map((s) => [s.id, s.label] as const),
      ...scope.sources
        .filter((id) => !sources.some((s) => s.id === id))
        .map((id) => [id, id] as const),
    ]).entries(),
  ]);
  let projectOptions = $derived([
    ...new Map([
      ...docker.graph.nodes
        .filter((n) => n.namespace || n.project)
        .map((n) => {
          const value = {
            sourceId: n.sourceId || n.host || 'local',
            project: n.namespace || n.project,
          };
          return [key(value), value] as const;
        }),
      ...scope.projects.map((value) => [key(value), value] as const),
    ]).values(),
  ]);
  let workloadOptions = $derived([
    ...new Map([
      ...scope.workloads.map((value) => [key(value), { ...value, name: value.entityId }] as const),
      ...docker.graph.nodes.map((n) => {
        const value = {
          sourceId: n.sourceId || n.host || 'local',
          entityId: n.entityId || n.containerId,
        };
        return [key(value), { ...value, name: n.name }] as const;
      }),
    ]).values(),
  ]);
  function toggleProject(value: WebhookScope['projects'][number]) {
    scope.projects = scope.projects.some((v) => key(v) === key(value))
      ? scope.projects.filter((v) => key(v) !== key(value))
      : [...scope.projects, value];
  }
  function toggleWorkload(value: WebhookScope['workloads'][number]) {
    scope.workloads = scope.workloads.some((v) => key(v) === key(value))
      ? scope.workloads.filter((v) => key(v) !== key(value))
      : [...scope.workloads, value];
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
    events = [...next.events];
    scope = structuredClone(next.scope);
    url = '';
    confirmingDisable = false;
  }

  onMount(() => {
    dialog.showModal();
    void getJson<typeof sources>('/api/sources')
      .then((next) => (sources = next))
      .catch(() => {});
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
          body: JSON.stringify({ url, format, events, scope }),
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
  <p>Choose what reaches your webhook, even when the dashboard is closed.</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if status}
    <p class="status">{status.enabled ? `Enabled — ${status.destination}` : 'Not configured'}</p>
    {#if status.managedByEnv}
      <p>
        Managed by environment variables on the server. Change the URL, format, events, or scope
        there.
      </p>
    {/if}
    <form onsubmit={save}>
      <fieldset disabled={busy || status.managedByEnv}>
        {#if !status.managedByEnv}
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
        {/if}
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
        <section aria-label="Events to send">
          <h3>Events to send</h3>
          <div class="event-grid">
            {#each WEBHOOK_EVENTS as option}
              <label class="choice"
                ><input
                  type="checkbox"
                  bind:group={events}
                  value={option.value}
                />{option.label}</label
              >
            {/each}
          </div>
          <p class="hint">New event types are opt-in. Select none to pause notifications.</p>
        </section>
        <section aria-label="Webhook scope">
          <h3>Scope</h3>
          <p class="hint">
            Empty selections include everything. Filters combine across groups. Connectivity alerts
            use only the source filter.
          </p>
          <details>
            <summary>Sources / hosts <span>{scope.sources.length || 'All'}</span></summary>
            <div class="scope-options">
              {#each sourceOptions as [id, label]}
                <label class="choice"
                  ><input type="checkbox" bind:group={scope.sources} value={id} /><span
                    >{label}<small>{id}</small></span
                  ></label
                >
              {/each}
            </div>
          </details>
          <details>
            <summary>Projects / namespaces <span>{scope.projects.length || 'All'}</span></summary>
            <div class="scope-options">
              {#each projectOptions as value}
                <label class="choice"
                  ><input
                    type="checkbox"
                    checked={scope.projects.some((p) => key(p) === key(value))}
                    onchange={() => toggleProject(value)}
                  /><span>{value.project}<small>{value.sourceId}</small></span></label
                >
              {:else}<p class="hint">No projects or namespaces discovered.</p>{/each}
            </div>
          </details>
          <details>
            <summary>Individual workloads <span>{scope.workloads.length || 'All'}</span></summary>
            <div class="scope-options">
              {#each workloadOptions as value}
                <label class="choice"
                  ><input
                    type="checkbox"
                    checked={scope.workloads.some(
                      (w) => w.sourceId === value.sourceId && w.entityId === value.entityId,
                    )}
                    onchange={() =>
                      toggleWorkload({ sourceId: value.sourceId, entityId: value.entityId })}
                  /><span>{value.name}<small>{value.sourceId} · {value.entityId}</small></span
                  ></label
                >
              {:else}<p class="hint">No workloads discovered.</p>{/each}
            </div>
          </details>
        </section>
      </fieldset>
      <p class="hint">
        Changes apply immediately and survive restarts. JSON alerts include diagnostic log excerpts;
        Slack and Discord receive summaries.
      </p>
      {#if !status.managedByEnv}<Button
          type="submit"
          disabled={busy || (!status.enabled && !url.trim())}
          >{busy ? 'Saving…' : 'Save webhook'}</Button
        >{/if}
    </form>
    {#if status.enabled && !status.managedByEnv}
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
  {:else if !error}
    <p>Loading settings…</p>
  {/if}
</dialog>

<style>
  dialog {
    --text-xs: 12px;
    --text-sm: 13px;
    --text-base: 14px;
    --text-md: 15px;
    --text-lg: 20px;
    font-size: var(--text-base);
    line-height: 1.5;
    width: min(560px, calc(100% - 40px));
    margin: auto;
    max-height: 90vh;
    overflow-y: auto;
    padding: 24px;
    border: 1px solid var(--border-glow);
    border-radius: 12px;
    background: var(--bg-surface-solid);
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
  fieldset {
    display: grid;
    gap: 16px;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  fieldset:disabled {
    opacity: 0.65;
  }
  h3 {
    font-size: var(--text-base);
    margin: 0 0 10px;
  }
  .event-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 10px;
  }
  .choice {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: var(--text-base);
    overflow-wrap: anywhere;
  }
  .choice input {
    accent-color: var(--accent-cyan);
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    margin-top: 3px;
  }
  .choice small {
    display: block;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    margin-top: 3px;
  }
  details {
    border: 1px solid var(--border-control);
    border-radius: 6px;
    margin-top: 8px;
    padding: 10px;
  }
  summary {
    cursor: pointer;
    font-size: var(--text-base);
  }
  summary span {
    float: right;
    color: var(--accent-cyan);
  }
  .scope-options {
    display: grid;
    gap: 10px;
    max-height: 180px;
    overflow-y: auto;
    margin-top: 12px;
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
