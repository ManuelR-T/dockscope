<script lang="ts">
  import { getDockerState } from '../../stores/docker.svelte';
  import type { ServiceNode } from '../../../types';

  interface CompareResult {
    onlyInA: ServiceNode[];
    onlyInB: ServiceNode[];
    matched: {
      name: string;
      hostA: ServiceNode;
      hostB: ServiceNode;
      diffs: { field: string; hostA: string; hostB: string }[];
    }[];
  }

  const docker = getDockerState();

  let hosts = $derived([...new Set(docker.graph.nodes.map((n) => n.host))].sort());
  let hostA = $state('');
  let hostB = $state('');
  let result = $state<CompareResult | null>(null);
  let loading = $state(false);
  let error = $state('');

  // Auto-select hosts when exactly two are available
  $effect(() => {
    if (hosts.length >= 2 && !hostA && !hostB) {
      hostA = hosts[0];
      hostB = hosts[1];
    }
  });

  async function runCompare() {
    if (!hostA || !hostB) {
      return;
    }
    if (hostA === hostB) {
      error = 'Select two different hosts to compare';
      return;
    }
    loading = true;
    error = '';
    result = null;
    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostA, hostB }),
      });
      if (!res.ok) {
        const err = await res.json();
        error = err.error || 'Compare failed';
        return;
      }
      result = await res.json();
    } catch {
      error = 'Failed to connect';
    } finally {
      loading = false;
    }
  }

  let matchedCount = $derived(
    result ? result.matched.filter((m) => m.diffs.length === 0).length : 0,
  );
  let diffCount = $derived(result ? result.matched.filter((m) => m.diffs.length > 0).length : 0);
</script>

<div class="sidebar-content">
  <div class="info-section">
    <span class="field-label">Compare Environments</span>
    <div class="compare-selectors">
      <label class="compare-label">
        <span class="compare-label-text">Host A</span>
        <select class="compare-select" bind:value={hostA}>
          <option value="">Select host...</option>
          {#each hosts as h}
            <option value={h}>{h}</option>
          {/each}
        </select>
      </label>
      <label class="compare-label">
        <span class="compare-label-text">Host B</span>
        <select class="compare-select" bind:value={hostB}>
          <option value="">Select host...</option>
          {#each hosts as h}
            <option value={h}>{h}</option>
          {/each}
        </select>
      </label>
      <button class="compare-btn" onclick={runCompare} disabled={loading || !hostA || !hostB}>
        {loading ? 'Comparing...' : 'Compare'}
      </button>
    </div>
  </div>

  {#if error}
    <div class="info-section">
      <span class="compare-error">{error}</span>
    </div>
  {/if}

  {#if result}
    <div class="info-section">
      <span class="field-label">Summary</span>
      <div class="compare-summary">
        {#if matchedCount > 0}
          <span class="compare-badge match">{matchedCount} identical</span>
        {/if}
        {#if diffCount > 0}
          <span class="compare-badge diff">{diffCount} different</span>
        {/if}
        {#if result.onlyInA.length > 0}
          <span class="compare-badge missing">{result.onlyInA.length} only in A</span>
        {/if}
        {#if result.onlyInB.length > 0}
          <span class="compare-badge missing">{result.onlyInB.length} only in B</span>
        {/if}
      </div>
    </div>

    {#if result.matched.filter((m) => m.diffs.length > 0).length > 0}
      <div class="info-section">
        <span class="field-label">Differences</span>
        {#each result.matched.filter((m) => m.diffs.length > 0) as svc}
          <div class="compare-service diff">
            <span class="compare-service-name">{svc.name}</span>
            <div class="compare-diffs">
              {#each svc.diffs as d}
                <div class="compare-diff-row">
                  <span class="compare-diff-field">{d.field}</span>
                  <span class="compare-diff-val a" title="Host A">{d.hostA}</span>
                  <span class="compare-diff-arrow">vs</span>
                  <span class="compare-diff-val b" title="Host B">{d.hostB}</span>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if result.matched.filter((m) => m.diffs.length === 0).length > 0}
      <div class="info-section">
        <span class="field-label">Matching Services</span>
        {#each result.matched.filter((m) => m.diffs.length === 0) as svc}
          <div class="compare-service match">
            <span class="compare-service-name">{svc.name}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if result.onlyInA.length > 0}
      <div class="info-section">
        <span class="field-label">Only in {hostA}</span>
        {#each result.onlyInA as svc}
          <div class="compare-service missing">
            <span class="compare-service-name">{svc.name}</span>
            <span class="mono compare-image">{svc.image}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if result.onlyInB.length > 0}
      <div class="info-section">
        <span class="field-label">Only in {hostB}</span>
        {#each result.onlyInB as svc}
          <div class="compare-service missing">
            <span class="compare-service-name">{svc.name}</span>
            <span class="mono compare-image">{svc.image}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  {#if !result && !error && !loading}
    <div class="info-section">
      <span class="compare-hint"
        >Select two hosts and click Compare to see differences between environments.</span
      >
    </div>
  {/if}
</div>

<style>
  .compare-selectors {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }

  .compare-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .compare-label-text {
    font-size: 10px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .compare-select {
    background: var(--bg-inset);
    color: var(--accent-cyan);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 11px;
    font-family: inherit;
    outline: none;
  }

  .compare-select:focus {
    border-color: var(--accent-cyan-glow);
  }

  .compare-btn {
    margin-top: 4px;
    padding: 6px 12px;
    background: var(--accent-cyan-dim);
    color: var(--accent-cyan);
    border: 1px solid var(--accent-cyan-glow);
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
  }

  .compare-btn:hover:not(:disabled) {
    background: var(--accent-cyan-glow);
  }

  .compare-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .compare-error {
    color: var(--accent-red);
    font-size: 11px;
  }

  .compare-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .compare-badge {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 500;
  }

  .compare-badge.match {
    background: var(--accent-green-dim);
    color: var(--accent-green);
  }

  .compare-badge.diff {
    background: var(--accent-amber-dim);
    color: var(--accent-amber);
  }

  .compare-badge.missing {
    background: var(--accent-red-dim);
    color: var(--accent-red);
  }

  .compare-service {
    padding: 6px 8px;
    border-radius: 4px;
    margin-top: 4px;
    border-left: 3px solid transparent;
  }

  .compare-service.match {
    background: var(--accent-green-dim);
    border-left-color: var(--accent-green);
  }

  .compare-service.diff {
    background: var(--accent-amber-dim);
    border-left-color: var(--accent-amber);
  }

  .compare-service.missing {
    background: var(--accent-red-dim);
    border-left-color: var(--accent-red);
  }

  .compare-service-name {
    font-size: 12px;
    font-weight: 500;
    color: #e2e8f0;
  }

  .compare-image {
    display: block;
    font-size: 10px;
    color: var(--text-dim);
    margin-top: 2px;
  }

  .compare-diffs {
    margin-top: 4px;
  }

  .compare-diff-row {
    display: grid;
    grid-template-columns: 70px 1fr auto 1fr;
    gap: 4px;
    align-items: baseline;
    font-size: 10px;
    padding: 2px 0;
  }

  .compare-diff-field {
    color: var(--text-dim);
    font-weight: 500;
  }

  .compare-diff-val {
    font-family: 'SF Mono', 'Fira Code', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .compare-diff-val.a {
    color: var(--accent-cyan);
  }

  .compare-diff-val.b {
    color: var(--accent-purple);
  }

  .compare-diff-arrow {
    color: var(--text-dim);
    font-size: 9px;
    padding: 0 2px;
  }

  .compare-hint {
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.5;
  }
</style>
