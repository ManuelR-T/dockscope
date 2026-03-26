<script lang="ts">
  interface Props {
    title: string;
    message: string;
    confirmLabel: string;
    variant: 'warning' | 'danger';
    typeToConfirm?: string;
    onConfirm: () => void;
    onCancel: () => void;
  }

  let { title, message, confirmLabel, variant, typeToConfirm, onConfirm, onCancel }: Props =
    $props();

  let typed = $state('');
  let canConfirm = $derived(!typeToConfirm || typed === typeToConfirm);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onCancel()} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="confirm-overlay" onclick={onCancel} onkeydown={() => {}}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="confirm-panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="confirm-title {variant}">{title}</div>
    <p class="confirm-msg">{message}</p>

    {#if typeToConfirm}
      <div class="confirm-type">
        <span class="confirm-hint">Type <strong>{typeToConfirm}</strong> to confirm</span>
        <input type="text" class="confirm-input" bind:value={typed} placeholder={typeToConfirm} />
      </div>
    {/if}

    <div class="confirm-actions">
      <button class="confirm-btn cancel" onclick={onCancel}>Cancel</button>
      <button class="confirm-btn {variant}" disabled={!canConfirm} onclick={onConfirm}>
        {confirmLabel}
      </button>
    </div>
  </div>
</div>

<style>
  .confirm-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(4, 4, 14, 0.7);
    backdrop-filter: blur(4px);
    animation: fadeIn 0.12s ease-out;
  }

  .confirm-panel {
    background: rgba(8, 10, 24, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 20px 24px;
    min-width: 320px;
    max-width: 420px;
  }

  .confirm-title {
    font-family: 'Chakra Petch', sans-serif;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .confirm-title.warning {
    color: #ff8a2b;
  }
  .confirm-title.danger {
    color: #ff2b4e;
  }

  .confirm-msg {
    font-size: 12px;
    color: #7a8599;
    line-height: 1.5;
    margin-bottom: 16px;
  }

  .confirm-type {
    margin-bottom: 16px;
  }

  .confirm-hint {
    display: block;
    font-size: 11px;
    color: #3e4a5c;
    margin-bottom: 6px;
  }

  .confirm-hint strong {
    color: #7a8599;
  }

  .confirm-input {
    width: 100%;
    font-family: 'Fira Code', monospace;
    font-size: 12px;
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    color: #e2e8f0;
    outline: none;
  }

  .confirm-input:focus {
    border-color: rgba(255, 43, 78, 0.3);
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .confirm-btn {
    font-family: 'Chakra Petch', sans-serif;
    font-size: 11px;
    font-weight: 600;
    padding: 6px 16px;
    border-radius: 6px;
    border: 1px solid;
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: 0.3px;
  }

  .confirm-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .confirm-btn.cancel {
    color: #7a8599;
    border-color: rgba(255, 255, 255, 0.06);
    background: transparent;
  }

  .confirm-btn.cancel:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .confirm-btn.warning {
    color: #ff8a2b;
    border-color: rgba(255, 138, 43, 0.2);
    background: rgba(255, 138, 43, 0.08);
  }

  .confirm-btn.warning:hover:not(:disabled) {
    background: rgba(255, 138, 43, 0.16);
  }

  .confirm-btn.danger {
    color: #ff2b4e;
    border-color: rgba(255, 43, 78, 0.2);
    background: rgba(255, 43, 78, 0.08);
  }

  .confirm-btn.danger:hover:not(:disabled) {
    background: rgba(255, 43, 78, 0.16);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
