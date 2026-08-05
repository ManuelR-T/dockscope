<script lang="ts">
  import { createToken, dismissSetup, getAuthState, submitToken } from '../stores/auth.svelte';

  interface Props {
    mode: 'setup' | 'login';
    onDone: () => void;
  }

  let { mode, onDone }: Props = $props();

  const auth = getAuthState();
  let token = $state('');
  let confirmation = $state('');
  let input: HTMLInputElement | undefined = $state();

  $effect(() => {
    input?.focus();
  });

  let tooShort = $derived(
    mode === 'setup' && token.length > 0 && token.length < auth.minTokenLength,
  );
  let mismatch = $derived(mode === 'setup' && confirmation.length > 0 && confirmation !== token);
  let canSubmit = $derived(
    mode === 'setup'
      ? token.length >= auth.minTokenLength && confirmation === token
      : token.trim().length > 0,
  );

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!canSubmit || auth.submitting) {
      return;
    }
    const ok = mode === 'setup' ? await createToken(token) : await submitToken(token);
    if (ok) {
      token = '';
      confirmation = '';
      onDone();
    }
  }

  // Only for this page load. Turning the reminder off for good lives in the
  // security panel, where it can be turned back on.
  function handleNotNow() {
    dismissSetup();
    onDone();
  }
</script>

<div class="gate">
  <form class="gate-panel" onsubmit={handleSubmit}>
    <div class="gate-title">DockScope</div>

    {#if mode === 'setup'}
      <p class="gate-lead">
        Anyone who can reach this port can control your containers. Set an access token to require
        one, or keep it open if this is only ever your own machine.
      </p>
    {:else}
      <p class="gate-lead">This instance requires an access token.</p>
    {/if}

    <input
      bind:this={input}
      bind:value={token}
      class="gate-input"
      type="password"
      name="dockscope-token"
      placeholder={mode === 'setup'
        ? `Choose a token (${auth.minTokenLength}+ characters)`
        : 'Access token'}
      autocomplete={mode === 'setup' ? 'new-password' : 'current-password'}
      spellcheck="false"
      disabled={auth.submitting}
    />

    {#if mode === 'setup'}
      <input
        bind:value={confirmation}
        class="gate-input"
        type="password"
        name="dockscope-token-confirm"
        placeholder="Repeat the token"
        autocomplete="new-password"
        spellcheck="false"
        disabled={auth.submitting}
      />
      {#if tooShort}
        <div class="gate-note">At least {auth.minTokenLength} characters.</div>
      {:else if mismatch}
        <div class="gate-note">The two entries do not match.</div>
      {/if}
    {/if}

    {#if auth.error}
      <div class="gate-error" role="alert">{auth.error}</div>
    {/if}

    <button class="gate-submit" type="submit" disabled={auth.submitting || !canSubmit}>
      {#if auth.submitting}
        Working…
      {:else if mode === 'setup'}
        Set access token
      {:else}
        Unlock
      {/if}
    </button>

    {#if mode === 'setup'}
      <button class="gate-skip" type="button" onclick={handleNotNow} disabled={auth.submitting}>
        Not now
      </button>
      <p class="gate-hint">
        You can set one later from <strong>Security</strong> in the status bar. Stored hashed in
        <span class="mono">~/.dockscope/auth.json</span>, or set
        <span class="mono">DOCKSCOPE_TOKEN</span> on the server instead.
      </p>
    {:else}
      <p class="gate-hint">
        {#if auth.managedByEnv}
          Set by <span class="mono">DOCKSCOPE_TOKEN</span> on the server.
        {:else}
          Chosen when this instance was set up.
        {/if}
      </p>
    {/if}
  </form>
</div>

<style>
  .gate {
    position: fixed;
    inset: 0;
    z-index: 400;
    display: grid;
    place-items: center;
    background: var(--bg-void);
  }

  .gate-panel {
    width: min(380px, calc(100vw - 48px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 28px 26px 22px;
    background: var(--bg-surface-solid);
    border: 1px solid var(--border-glow);
    border-radius: 10px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  }

  .gate-title {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    letter-spacing: 2px;
    color: var(--accent-cyan);
  }

  .gate-lead {
    margin: 0 0 4px;
    font-size: var(--text-base);
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .gate-input {
    padding: 9px 11px;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: var(--text-primary);
    background: var(--bg-inset);
    border: 1px solid var(--border-control);
    border-radius: 6px;
    outline: none;
  }

  .gate-input:focus {
    border-color: var(--accent-cyan);
    box-shadow: 0 0 0 3px var(--accent-cyan-dim);
  }

  .gate-note {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .gate-error {
    font-size: var(--text-sm);
    color: var(--accent-red);
  }

  .gate-submit {
    padding: 9px 12px;
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: 600;
    letter-spacing: 0.5px;
    color: var(--bg-void);
    background: var(--accent-cyan);
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .gate-submit:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .gate-skip {
    padding: 6px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    background: none;
    border: none;
    cursor: pointer;
  }

  .gate-skip:hover:not(:disabled) {
    color: var(--text-primary);
  }

  .gate-hint {
    margin: 2px 0 0;
    font-size: var(--text-xs);
    line-height: 1.5;
    color: var(--text-dim);
  }

  .mono {
    font-family: var(--font-mono);
  }
</style>
