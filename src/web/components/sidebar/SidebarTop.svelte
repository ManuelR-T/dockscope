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
    <div class="node-empty">{error}</div>
  {:else if loading || !top}
    <div class="node-empty">Loading...</div>
  {:else if top.processes.length === 0}
    <div class="node-empty">No processes reported.</div>
  {:else}
    {@const pidIndex = top.titles.findIndex((t) => /^pid$/i.test(t))}
    {@const cmdIndex = top.titles.findIndex((t) => /^(cmd|command)$/i.test(t))}
    <div class="node-section">
      <div class="node-section-head">
        Processes
        <span class="metric-sub">{top.processes.length}</span>
      </div>
      <div class="node-section-body">
        {#each top.processes as proc}
          <div class="proc-row">
            <div class="proc-main">
              {#if pidIndex >= 0}
                <span class="proc-pid">{proc[pidIndex]}</span>
              {/if}
              <span class="proc-cmd">
                {cmdIndex >= 0 ? proc[cmdIndex] : proc.join(' ')}
              </span>
            </div>
            <div class="proc-meta">
              {#each top.titles as title, i}
                {#if i !== pidIndex && i !== cmdIndex && proc[i]}
                  <span><span class="proc-fact-key">{title}</span>{proc[i]}</span>
                {/if}
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Docker returns eight columns; a table of eight in a 390px panel clipped the
     command mid-token and needed a horizontal scrollbar. Each process is a row
     instead: identity on the first line, the remaining columns as dim facts. */
  .proc-row {
    padding: 7px 0;
  }

  .proc-row + .proc-row {
    border-top: 1px solid rgba(255, 255, 255, 0.03);
  }

  .proc-main {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    align-items: baseline;
  }

  .proc-pid {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: var(--accent-cyan);
  }

  .proc-cmd {
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    line-height: 1.45;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .proc-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    margin-top: 3px;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: var(--text-dim);
  }

  .proc-fact-key {
    margin-right: 4px;
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    letter-spacing: 1px;
    text-transform: uppercase;
  }
</style>
