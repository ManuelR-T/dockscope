<script lang="ts">
  import {
    clearAuthError,
    clearToken,
    createToken,
    getAuthState,
    setReminderDeclined,
  } from '../stores/auth.svelte';
  import { addToast } from '../stores/toast.svelte';
  import { Button } from './ui';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const auth = getAuthState();
  let token = $state('');
  let confirmation = $state('');
  let confirmingRemoval = $state(false);

  let canSave = $derived(token.length >= auth.minTokenLength && confirmation === token);
  let mismatch = $derived(confirmation.length > 0 && confirmation !== token);

  function reset() {
    token = '';
    confirmation = '';
    confirmingRemoval = false;
    clearAuthError();
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (auth.role !== 'operator' || !canSave || auth.submitting) {
      return;
    }
    if (await createToken(token)) {
      reset();
      addToast(auth.required ? 'Access token updated' : 'Access token set', 'success');
    }
  }

  async function remove() {
    if (auth.role !== 'operator') {
      return;
    }
    if (await clearToken()) {
      reset();
      addToast('Access token removed. This instance is open again.', 'info');
    }
  }

  async function toggleReminder() {
    if (auth.role !== 'operator') {
      return;
    }
    await setReminderDeclined(auth.setup !== 'declined');
  }
</script>

<div
  class="sec-overlay"
  role="button"
  tabindex="-1"
  onclick={onClose}
  onkeydown={(e) => e.key === 'Escape' && onClose()}
>
  <div
    class="sec-panel"
    role="dialog"
    aria-label="Security"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <div class="sec-head">
      <span class="sec-title">Security</span>
      <button class="sec-close" type="button" onclick={onClose} aria-label="Close">×</button>
    </div>

    {#if auth.role === 'reader'}
      <p class="sec-state">
        This is a read-only session. You can inspect workloads, logs, and diagnostics, but changing
        access settings requires an operator token.
      </p>
    {:else if auth.viaProxy}
      <p class="sec-state">
        Authentication is handled by your reverse proxy. DockScope refuses anything that does not
        come through it.
      </p>
    {:else if auth.managedByEnv}
      <p class="sec-state">
        An access token is required, pinned by <span class="mono">DOCKSCOPE_TOKEN</span> on the server.
        Change it there.
      </p>
    {:else}
      <p class="sec-state">
        {#if auth.required}
          An access token is required to use this instance.
        {:else}
          <span class="warn">This instance is open.</span> Anyone who can reach the port can control your
          containers.
        {/if}
      </p>

      <form class="sec-form" onsubmit={save}>
        <input
          bind:value={token}
          class="sec-input"
          type="password"
          autocomplete="new-password"
          spellcheck="false"
          placeholder={auth.required
            ? 'New token'
            : `Access token (${auth.minTokenLength}+ characters)`}
          disabled={auth.submitting}
        />
        <input
          bind:value={confirmation}
          class="sec-input"
          type="password"
          autocomplete="new-password"
          spellcheck="false"
          placeholder="Repeat it"
          disabled={auth.submitting}
        />
        {#if mismatch}
          <div class="sec-note">The two entries do not match.</div>
        {/if}
        {#if auth.error}
          <div class="sec-error" role="alert">{auth.error}</div>
        {/if}
        <Button type="submit" size="sm" disabled={auth.submitting || !canSave}>
          {auth.required ? 'Change token' : 'Set access token'}
        </Button>
      </form>

      {#if auth.required}
        <div class="sec-danger">
          {#if confirmingRemoval}
            <span class="sec-note">Remove the token and leave this instance open?</span>
            <div class="sec-danger-actions">
              <Button size="sm" tone="danger" disabled={auth.submitting} onclick={remove}>
                Remove
              </Button>
              <Button size="sm" variant="ghost" onclick={() => (confirmingRemoval = false)}>
                Cancel
              </Button>
            </div>
          {:else}
            <button class="sec-link" type="button" onclick={() => (confirmingRemoval = true)}>
              Remove the access token
            </button>
          {/if}
        </div>
      {:else}
        <label class="sec-toggle">
          <input
            type="checkbox"
            checked={auth.setup === 'declined'}
            disabled={auth.submitting}
            onchange={toggleReminder}
          />
          <span>Stop asking me to set one</span>
        </label>
      {/if}
    {/if}
  </div>
</div>

<style>
  .sec-overlay {
    position: fixed;
    inset: 0;
    /* Above the other modals, below the toasts this panel raises so its own
       confirmations stay visible. */
    z-index: 150;
    display: grid;
    place-items: center;
    background: rgba(2, 3, 10, 0.6);
    cursor: default;
  }

  .sec-panel {
    width: min(400px, calc(100vw - 48px));
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 20px 22px 22px;
    background: var(--bg-surface-solid);
    border: 1px solid var(--border-glow);
    border-radius: 10px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  }

  .sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sec-title {
    font-family: var(--font-display);
    font-size: var(--text-base);
    letter-spacing: 1.6px;
    text-transform: uppercase;
    color: var(--accent-cyan);
  }

  .sec-close {
    padding: 0 4px;
    font-size: var(--text-lg);
    line-height: 1;
    color: var(--text-secondary);
    background: none;
    border: none;
    cursor: pointer;
  }

  .sec-close:hover {
    color: var(--text-primary);
  }

  .sec-state {
    margin: 0;
    font-size: var(--text-base);
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .warn {
    color: var(--accent-amber);
  }

  .sec-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sec-input {
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: var(--text-primary);
    background: var(--bg-inset);
    border: 1px solid var(--border-control);
    border-radius: 6px;
    outline: none;
  }

  .sec-input:focus {
    border-color: var(--accent-cyan);
    box-shadow: 0 0 0 3px var(--accent-cyan-dim);
  }

  .sec-note {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .sec-error {
    font-size: var(--text-sm);
    color: var(--accent-red);
  }

  .sec-danger {
    padding-top: 10px;
    border-top: 1px solid var(--border-subtle);
  }

  .sec-danger-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .sec-link {
    padding: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--accent-red);
    background: none;
    border: none;
    cursor: pointer;
  }

  .sec-link:hover {
    text-decoration: underline;
  }

  .sec-toggle {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-top: 10px;
    border-top: 1px solid var(--border-subtle);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .mono {
    font-family: var(--font-mono);
  }
</style>
