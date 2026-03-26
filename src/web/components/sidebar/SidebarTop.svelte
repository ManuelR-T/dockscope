<script lang="ts">
  import { onMount } from 'svelte';
  import type { ContainerTopResult } from '../../../types';

  interface Props {
    containerId: string;
  }

  let { containerId }: Props = $props();

  let top = $state<ContainerTopResult | null>(null);
  let error = $state('');

  async function fetchTop() {
    try {
      const res = await fetch(`/api/containers/${containerId}/top`);
      if (!res.ok) throw new Error('Not running');
      top = await res.json();
      error = '';
    } catch {
      top = null;
      error = 'Container must be running to view processes';
    }
  }

  onMount(() => {
    fetchTop();
    const interval = setInterval(fetchTop, 5000);
    return () => clearInterval(interval);
  });

  $effect(() => {
    containerId;
    fetchTop();
  });
</script>

<div class="sidebar-content">
  {#if error}
    <div class="top-empty">{error}</div>
  {:else if !top}
    <div class="top-empty">Loading...</div>
  {:else}
    <div class="top-table-wrap">
      <table class="top-table">
        <thead>
          <tr>
            {#each top.titles as title}
              <th>{title}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each top.processes as proc}
            <tr>
              {#each proc as cell}
                <td>{cell}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .top-empty {
    padding: 20px;
    text-align: center;
    color: var(--text-dim);
    font-size: 12px;
    font-style: italic;
  }

  .top-table-wrap {
    overflow-x: auto;
  }

  .top-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .top-table th {
    text-align: left;
    padding: 6px 8px;
    color: var(--text-dim);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-size: 9px;
    border-bottom: 1px solid var(--border-subtle);
    white-space: nowrap;
  }

  .top-table td {
    padding: 4px 8px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .top-table tr:hover td {
    background: rgba(0, 228, 255, 0.02);
  }
</style>
