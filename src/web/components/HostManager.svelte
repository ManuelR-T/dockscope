<script lang="ts">
  import { addToast } from '../stores/docker.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let hosts = $state<{ name: string; url: string; connected: boolean; containers: number; version: string }[]>([]);
  let newName = $state('');
  let newUrl = $state('');
  let adding = $state(false);
  let loading = $state(true);
  let pollTimer: ReturnType<typeof setInterval>;

  async function fetchHosts() {
    try {
      const res = await fetch('/api/hosts');
      hosts = await res.json();
    } catch {
      hosts = [];
    } finally {
      loading = false;
    }
  }

  async function addNewHost() {
    if (!newName.trim() || !newUrl.trim() || adding) return;
    adding = true;
    try {
      const res = await fetch('/api/hosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), url: newUrl.trim() }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      if (!res.ok) {
        addToast(data.error || 'Failed to add host', 'error');
      } else {
        addToast(`Host "${newName}" connected`, 'success');
        newName = '';
        newUrl = '';
        await fetchHosts();
      }
    } catch {
      addToast('Failed to add host', 'error');
    } finally {
      adding = false;
    }
  }

  async function removeHostByName(name: string) {
    try {
      const res = await fetch(`/api/hosts/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (res.ok) {
        addToast(`Host "${name}" removed`, 'success');
        await fetchHosts();
      } else {
        const data = await res.json();
        addToast(data.error || 'Failed to remove', 'error');
      }
    } catch {
      addToast('Failed to remove host', 'error');
    }
  }

  import { onDestroy } from 'svelte';
  fetchHosts();
  pollTimer = setInterval(fetchHosts, 5000);
  onDestroy(() => clearInterval(pollTimer));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="host-overlay" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="host-panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="host-header">
      <span class="host-title">Docker Hosts</span>
      <button class="host-close" onclick={onClose}>&times;</button>
    </div>

    <div class="host-list">
      {#if loading}
        <div class="host-loading">Loading hosts...</div>
      {/if}
      {#each hosts as host}
        <div class="host-item">
          <span class="host-dot" class:connected={host.connected} class:disconnected={!host.connected}></span>
          <div class="host-info">
            <span class="host-name">{host.name}</span>
            <span class="host-url">{host.url}</span>
            {#if host.connected}
              <span class="host-stats">{host.containers} containers &middot; Docker {host.version}</span>
            {:else}
              <span class="host-stats disconnected-text">disconnected</span>
            {/if}
          </div>
          {#if host.name !== 'local'}
            <button class="host-remove" onclick={() => removeHostByName(host.name)} title="Remove">&times;</button>
          {/if}
        </div>
      {/each}
    </div>

    <div class="host-add">
      <input
        class="host-input"
        type="text"
        placeholder="Name (e.g. staging)"
        bind:value={newName}
        onkeydown={(e) => e.key === 'Enter' && addNewHost()}
      />
      <input
        class="host-input url"
        type="text"
        placeholder="URL (e.g. tcp://192.168.1.10:2375)"
        bind:value={newUrl}
        onkeydown={(e) => e.key === 'Enter' && addNewHost()}
      />
      <button class="host-add-btn" onclick={addNewHost} disabled={adding || !newName.trim() || !newUrl.trim()}>
        {adding ? 'Connecting...' : 'Add'}
      </button>
    </div>
  </div>
</div>

<style>
  .host-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(4, 4, 14, 0.6);
    backdrop-filter: blur(4px);
    animation: fadeIn 0.15s ease-out;
  }

  .host-panel {
    background: rgba(8, 10, 24, 0.95);
    border: 1px solid rgba(0, 228, 255, 0.12);
    border-radius: 12px;
    padding: 20px 24px;
    min-width: 380px;
    max-width: 480px;
    backdrop-filter: blur(20px);
  }

  .host-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .host-title {
    font-family: 'Chakra Petch', sans-serif;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: rgba(0, 228, 255, 0.8);
  }

  .host-close {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.3);
    font-size: 18px;
    cursor: pointer;
  }

  .host-close:hover {
    color: rgba(255, 255, 255, 0.7);
  }

  .host-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .host-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 6px;
  }

  .host-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .host-dot.connected {
    background: #00ff6a;
    box-shadow: 0 0 4px rgba(0, 255, 106, 0.4);
  }

  .host-dot.disconnected {
    background: #ff2b4e;
  }

  .host-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .host-name {
    font-size: 12px;
    font-weight: 600;
    color: #e2e8f0;
  }

  .host-url {
    font-size: 10px;
    font-family: 'Fira Code', monospace;
    color: rgba(255, 255, 255, 0.35);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .host-stats {
    font-size: 10px;
    color: rgba(0, 228, 255, 0.5);
  }

  .disconnected-text {
    color: rgba(255, 43, 78, 0.6);
  }

  .host-loading {
    text-align: center;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.3);
    padding: 12px;
    font-style: italic;
  }

  .host-remove {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.2);
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
  }

  .host-remove:hover {
    color: #ff2b4e;
  }

  .host-add {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  .host-input {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
    color: #e2e8f0;
    font-family: inherit;
    outline: none;
  }

  .host-input:focus {
    border-color: rgba(0, 228, 255, 0.3);
  }

  .host-input.url {
    font-family: 'Fira Code', monospace;
    font-size: 11px;
  }

  .host-add-btn {
    padding: 8px;
    background: rgba(0, 228, 255, 0.1);
    border: 1px solid rgba(0, 228, 255, 0.2);
    border-radius: 6px;
    color: #00e4ff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .host-add-btn:hover:not(:disabled) {
    background: rgba(0, 228, 255, 0.2);
  }

  .host-add-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
