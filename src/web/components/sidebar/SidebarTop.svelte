<script lang="ts">
  import type { ContainerTopResult, ServiceNode } from '../../../types';
  import { getJson, isAbortError } from '../../lib/api';
  import { containerApiUrl } from '../../lib/sidebarApi';

  interface Props {
    node: ServiceNode;
  }

  let { node }: Props = $props();

  let top = $state<ContainerTopResult | null>(null);
  let error = $state('');
  let loading = $state(false);

  async function fetchTop(target: ServiceNode, signal: AbortSignal) {
    loading = true;
    try {
      top = await getJson<ContainerTopResult>(containerApiUrl(target, '/top'), { signal });
      error = '';
    } catch (err) {
      if (isAbortError(err) || signal.aborted) {
        return;
      }
      top = null;
      error = 'Container must be running to view processes';
    } finally {
      if (!signal.aborted) {
        loading = false;
      }
    }
  }

  $effect(() => {
    const currentNode = node;
    let controller: AbortController | null = null;

    function refresh() {
      controller?.abort();
      controller = new AbortController();
      fetchTop(currentNode, controller.signal);
    }

    refresh();
    const interval = setInterval(refresh, 5000);

    return () => {
      clearInterval(interval);
      controller?.abort();
    };
  });
</script>

<div class="sidebar-content">
  {#if error}
    <div class="top-empty">{error}</div>
  {:else if loading || !top}
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
    font-size: var(--text-md);
    font-style: italic;
  }

  .top-table-wrap {
    overflow-x: auto;
  }

  .top-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .top-table th {
    text-align: left;
    padding: 6px 8px;
    color: var(--text-dim);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-size: var(--text-xs);
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
