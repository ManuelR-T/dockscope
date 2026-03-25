<script lang="ts">
  import { getToasts } from '../stores/toast.svelte';

  const toasts = getToasts();
</script>

{#if toasts.list.length > 0}
  <div class="toast-container">
    {#each toasts.list as toast (toast.id)}
      <div class="toast toast-{toast.type}">
        <span class="toast-dot"></span>
        <span class="toast-msg">{toast.message}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 200px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 20px;
    background: rgba(8, 10, 24, 0.92);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 20px;
    font-family: 'Chakra Petch', sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: #e2e8f0;
    animation: toastIn 0.3s ease-out;
    white-space: nowrap;
  }

  .toast-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .toast-success .toast-dot {
    background: #00ff6a;
    box-shadow: 0 0 6px rgba(0, 255, 106, 0.4);
  }
  .toast-error .toast-dot {
    background: #ff2b4e;
    box-shadow: 0 0 6px rgba(255, 43, 78, 0.4);
  }
  .toast-info .toast-dot {
    background: #00e4ff;
    box-shadow: 0 0 6px rgba(0, 228, 255, 0.4);
  }

  .toast-success {
    border-color: rgba(0, 255, 106, 0.15);
  }
  .toast-error {
    border-color: rgba(255, 43, 78, 0.15);
  }
  .toast-info {
    border-color: rgba(0, 228, 255, 0.15);
  }

  @keyframes toastIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
