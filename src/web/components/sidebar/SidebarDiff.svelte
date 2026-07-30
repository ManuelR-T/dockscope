<script lang="ts">
  import type { ContainerDiffEntry, ServiceNode } from '../../../types';
  import { getJson, isAbortError } from '../../lib/api';
  import { containerApiUrl } from '../../lib/sidebarApi';

  interface Props {
    node: ServiceNode;
  }

  let { node }: Props = $props();

  let diff = $state<ContainerDiffEntry[]>([]);
  let loading = $state(true);
  let error = $state('');

  const KIND_CLASS: Record<string, string> = { A: 'added', C: 'changed', D: 'deleted' };

  let safeDiff = $derived(Array.isArray(diff) ? diff : []);
  let added = $derived(safeDiff.filter((d) => d.kind === 'A').length);
  let changed = $derived(safeDiff.filter((d) => d.kind === 'C').length);
  let deleted = $derived(safeDiff.filter((d) => d.kind === 'D').length);

  async function fetchDiff(target: ServiceNode, signal: AbortSignal) {
    loading = true;
    try {
      const data = await getJson<ContainerDiffEntry[]>(containerApiUrl(target, '/diff'), {
        signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
      });
      diff = Array.isArray(data) ? data : [];
      error = '';
    } catch (e) {
      if (isAbortError(e) && signal.aborted) {
        return;
      }
      const err = e instanceof Error ? e : new Error(String(e));
      diff = [];
      error =
        err.name === 'TimeoutError' || err.message.includes('timed out')
          ? 'Diff timed out — container may have too many changes'
          : 'Could not load filesystem diff';
    } finally {
      if (!signal.aborted) {
        loading = false;
      }
    }
  }

  $effect(() => {
    const currentNode = node;
    const controller = new AbortController();
    fetchDiff(currentNode, controller.signal);
    return () => controller.abort();
  });
</script>

<div class="sidebar-content">
  {#if loading}
    <div class="diff-empty">Loading...</div>
  {:else if error}
    <div class="diff-empty">{error}</div>
  {:else if safeDiff.length === 0}
    <div class="diff-empty">No filesystem changes</div>
  {:else}
    <div class="diff-summary">
      {#if added > 0}<span class="diff-count added">+{added}</span>{/if}
      {#if changed > 0}<span class="diff-count changed">~{changed}</span>{/if}
      {#if deleted > 0}<span class="diff-count deleted">-{deleted}</span>{/if}
      <span class="diff-total">{safeDiff.length} changes</span>
    </div>
    <div class="diff-list">
      {#each safeDiff as entry}
        <div class="diff-row {KIND_CLASS[entry.kind]}">
          <span class="diff-kind">{entry.kind}</span>
          <span class="diff-path">{entry.path}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .diff-empty {
    padding: 20px;
    text-align: center;
    color: var(--text-dim);
    font-size: var(--text-md);
    font-style: italic;
  }

  .diff-summary {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: var(--text-base);
  }

  .diff-count {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: var(--text-base);
  }

  .diff-count.added {
    color: var(--accent-green);
  }
  .diff-count.changed {
    color: var(--accent-amber);
  }
  .diff-count.deleted {
    color: var(--accent-red);
  }

  .diff-total {
    color: var(--text-dim);
    margin-left: auto;
    font-size: var(--text-sm);
  }

  .diff-list {
    overflow-y: auto;
    flex: 1;
  }

  .diff-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 12px;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    transition: background 0.1s;
  }

  .diff-row:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .diff-kind {
    width: 14px;
    text-align: center;
    font-weight: 700;
    flex-shrink: 0;
  }

  .diff-row.added .diff-kind {
    color: var(--accent-green);
  }
  .diff-row.changed .diff-kind {
    color: var(--accent-amber);
  }
  .diff-row.deleted .diff-kind {
    color: var(--accent-red);
  }

  .diff-path {
    color: var(--text-secondary);
    word-break: break-all;
  }
</style>
