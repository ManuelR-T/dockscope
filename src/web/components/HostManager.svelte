<script lang="ts">
  import { onDestroy } from 'svelte';
  import { addToast } from '../stores/docker.svelte';
  import type { ServiceNode } from '../../types';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  // --- State ---
  let view = $state<'hosts' | 'compare'>('hosts');
  let hosts = $state<{ name: string; url: string; connected: boolean; containers: number; version: string }[]>([]);
  let newName = $state('');
  let newUrl = $state('');
  let adding = $state(false);
  let loading = $state(true);

  // Compare state
  interface CompareResult {
    onlyInA: ServiceNode[];
    onlyInB: ServiceNode[];
    matched: { name: string; hostA: ServiceNode; hostB: ServiceNode; diffs: { field: string; hostA: string; hostB: string }[] }[];
  }
  let hostA = $state('');
  let hostB = $state('');
  let compareResult = $state<CompareResult | null>(null);
  let comparing = $state(false);
  let compareError = $state('');

  let connectedHosts = $derived(hosts.filter((h) => h.connected));
  let canCompare = $derived(connectedHosts.length >= 2);
  let matchedCount = $derived(compareResult ? compareResult.matched.filter((m) => m.diffs.length === 0).length : 0);
  let diffCount = $derived(compareResult ? compareResult.matched.filter((m) => m.diffs.length > 0).length : 0);

  // --- Host management ---
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

  // --- Compare ---
  $effect(() => {
    if (connectedHosts.length >= 2 && !hostA && !hostB) {
      hostA = connectedHosts[0].name;
      hostB = connectedHosts[1].name;
    }
  });

  async function runCompare() {
    if (!hostA || !hostB || hostA === hostB) {
      compareError = 'Select two different hosts';
      return;
    }
    comparing = true;
    compareError = '';
    compareResult = null;
    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostA, hostB }),
      });
      if (!res.ok) {
        compareError = (await res.json()).error || 'Compare failed';
        return;
      }
      compareResult = await res.json();
    } catch {
      compareError = 'Failed to connect';
    } finally {
      comparing = false;
    }
  }

  // Polling
  fetchHosts();
  const pollTimer = setInterval(fetchHosts, 5000);
  onDestroy(() => clearInterval(pollTimer));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <!-- Header with tabs -->
    <div class="header">
      <div class="tabs">
        <button class="tab" class:active={view === 'hosts'} onclick={() => (view = 'hosts')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" />
            <circle cx="6" cy="6" r="1" fill="currentColor" /><circle cx="6" cy="18" r="1" fill="currentColor" />
          </svg>
          Hosts
        </button>
        {#if canCompare}
          <button class="tab" class:active={view === 'compare'} onclick={() => (view = 'compare')}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
            Compare
          </button>
        {/if}
      </div>
      <button class="close-btn" onclick={onClose}>&times;</button>
    </div>

    <!-- Hosts view -->
    {#if view === 'hosts'}
      <div class="content">
        <div class="host-list">
          {#if loading}
            <div class="empty-msg">Loading hosts...</div>
          {/if}
          {#each hosts as host}
            <div class="host-item">
              <span class="dot" class:on={host.connected} class:off={!host.connected}></span>
              <div class="host-info">
                <span class="host-name">{host.name}</span>
                <span class="host-url">{host.url}</span>
                {#if host.connected}
                  <span class="host-meta">{host.containers} containers · Docker {host.version}</span>
                {:else}
                  <span class="host-meta off-text">disconnected</span>
                {/if}
              </div>
              {#if host.name !== 'local'}
                <button class="remove-btn" onclick={() => removeHostByName(host.name)} title="Remove">&times;</button>
              {/if}
            </div>
          {/each}
        </div>

        <div class="add-form">
          <input class="input" type="text" placeholder="Name (e.g. staging)" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && addNewHost()} />
          <input class="input mono" type="text" placeholder="tcp://192.168.1.10:2375" bind:value={newUrl} onkeydown={(e) => e.key === 'Enter' && addNewHost()} />
          <button class="action-btn" onclick={addNewHost} disabled={adding || !newName.trim() || !newUrl.trim()}>
            {adding ? 'Connecting...' : 'Add Host'}
          </button>
        </div>
      </div>

    <!-- Compare view -->
    {:else}
      <div class="content">
        <div class="compare-controls">
          <div class="compare-row">
            <select class="input" bind:value={hostA}>
              {#each connectedHosts as h}
                <option value={h.name}>{h.name}</option>
              {/each}
            </select>
            <span class="compare-vs">vs</span>
            <select class="input" bind:value={hostB}>
              {#each connectedHosts as h}
                <option value={h.name}>{h.name}</option>
              {/each}
            </select>
          </div>
          <button class="action-btn" onclick={runCompare} disabled={comparing || !hostA || !hostB || hostA === hostB}>
            {comparing ? 'Comparing...' : 'Compare Environments'}
          </button>
        </div>

        {#if compareError}
          <div class="error-msg">{compareError}</div>
        {/if}

        {#if compareResult}
          <div class="compare-summary">
            {#if matchedCount > 0}<span class="badge match">{matchedCount} identical</span>{/if}
            {#if diffCount > 0}<span class="badge diff">{diffCount} different</span>{/if}
            {#if compareResult.onlyInA.length > 0}<span class="badge missing">{compareResult.onlyInA.length} only in {hostA}</span>{/if}
            {#if compareResult.onlyInB.length > 0}<span class="badge missing">{compareResult.onlyInB.length} only in {hostB}</span>{/if}
          </div>

          <div class="compare-results">
            {#each compareResult.matched.filter((m) => m.diffs.length > 0) as svc}
              <div class="result-card diff">
                <span class="result-name">{svc.name}</span>
                {#each svc.diffs as d}
                  <div class="diff-row">
                    <span class="diff-field">{d.field}</span>
                    <span class="diff-val a">{d.hostA}</span>
                    <span class="diff-arrow">→</span>
                    <span class="diff-val b">{d.hostB}</span>
                  </div>
                {/each}
              </div>
            {/each}

            {#each compareResult.onlyInA as svc}
              <div class="result-card missing">
                <span class="result-name">{svc.name}</span>
                <span class="result-detail">only in {hostA} · {svc.image}</span>
              </div>
            {/each}

            {#each compareResult.onlyInB as svc}
              <div class="result-card missing">
                <span class="result-name">{svc.name}</span>
                <span class="result-detail">only in {hostB} · {svc.image}</span>
              </div>
            {/each}

            {#each compareResult.matched.filter((m) => m.diffs.length === 0) as svc}
              <div class="result-card match">
                <span class="result-name">{svc.name}</span>
              </div>
            {/each}
          </div>
        {/if}

        {#if !compareResult && !compareError && !comparing}
          <div class="empty-msg">Select two hosts and compare their container configurations.</div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
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

  .panel {
    background: rgba(8, 10, 24, 0.95);
    border: 1px solid rgba(0, 228, 255, 0.12);
    border-radius: 12px;
    min-width: 420px;
    max-width: 520px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    backdrop-filter: blur(20px);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 0;
  }

  .tabs {
    display: flex;
    gap: 2px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 8px 14px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: rgba(122, 133, 153, 0.7);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.3px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .tab:hover {
    color: rgba(200, 206, 222, 0.8);
  }

  .tab.active {
    color: #00e4ff;
    border-bottom-color: #00e4ff;
  }

  .close-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.3);
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
  }

  .close-btn:hover {
    color: rgba(255, 255, 255, 0.7);
  }

  .content {
    padding: 16px 20px 20px;
    overflow-y: auto;
    flex: 1;
  }

  /* --- Hosts view --- */
  .host-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
  }

  .host-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.025);
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.03);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot.on {
    background: #00ff6a;
    box-shadow: 0 0 6px rgba(0, 255, 106, 0.35);
  }

  .dot.off {
    background: #ff2b4e;
  }

  .host-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
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
    color: rgba(255, 255, 255, 0.3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .host-meta {
    font-size: 10px;
    color: rgba(0, 228, 255, 0.45);
  }

  .off-text {
    color: rgba(255, 43, 78, 0.55);
  }

  .remove-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.15);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .remove-btn:hover {
    color: #ff2b4e;
    background: rgba(255, 43, 78, 0.1);
  }

  .add-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  /* --- Shared inputs --- */
  .input {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
    color: #e2e8f0;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }

  .input:focus {
    border-color: rgba(0, 228, 255, 0.3);
  }

  .input.mono {
    font-family: 'Fira Code', monospace;
    font-size: 11px;
  }

  select.input {
    flex: 1;
    cursor: pointer;
  }

  .action-btn {
    padding: 9px 12px;
    background: rgba(0, 228, 255, 0.08);
    border: 1px solid rgba(0, 228, 255, 0.18);
    border-radius: 6px;
    color: #00e4ff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn:hover:not(:disabled) {
    background: rgba(0, 228, 255, 0.15);
    border-color: rgba(0, 228, 255, 0.3);
  }

  .action-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .empty-msg {
    text-align: center;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.25);
    padding: 20px 10px;
    line-height: 1.6;
  }

  .error-msg {
    font-size: 11px;
    color: #ff2b4e;
    padding: 8px 0;
  }

  /* --- Compare view --- */
  .compare-controls {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 14px;
  }

  .compare-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .compare-vs {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.2);
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .compare-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }

  .badge {
    font-size: 10px;
    padding: 3px 9px;
    border-radius: 10px;
    font-weight: 600;
  }

  .badge.match {
    background: rgba(0, 255, 106, 0.1);
    color: #00ff6a;
  }

  .badge.diff {
    background: rgba(255, 138, 43, 0.1);
    color: #ff8a2b;
  }

  .badge.missing {
    background: rgba(255, 43, 78, 0.1);
    color: #ff2b4e;
  }

  .compare-results {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .result-card {
    padding: 8px 10px;
    border-radius: 6px;
    border-left: 3px solid transparent;
  }

  .result-card.match {
    background: rgba(0, 255, 106, 0.04);
    border-left-color: rgba(0, 255, 106, 0.3);
  }

  .result-card.diff {
    background: rgba(255, 138, 43, 0.04);
    border-left-color: rgba(255, 138, 43, 0.4);
  }

  .result-card.missing {
    background: rgba(255, 43, 78, 0.04);
    border-left-color: rgba(255, 43, 78, 0.3);
  }

  .result-name {
    font-size: 12px;
    font-weight: 600;
    color: #e2e8f0;
  }

  .result-detail {
    display: block;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.3);
    font-family: 'Fira Code', monospace;
    margin-top: 2px;
  }

  .diff-row {
    display: grid;
    grid-template-columns: 65px 1fr auto 1fr;
    gap: 6px;
    align-items: baseline;
    font-size: 10px;
    padding: 3px 0;
  }

  .diff-field {
    color: rgba(255, 255, 255, 0.4);
    font-weight: 500;
  }

  .diff-val {
    font-family: 'Fira Code', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diff-val.a { color: #00e4ff; }
  .diff-val.b { color: #a855f7; }

  .diff-arrow {
    color: rgba(255, 255, 255, 0.15);
    font-size: 9px;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
