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
    <div class="node-empty">Loading...</div>
  {:else if error}
    <div class="node-empty">{error}</div>
  {:else if safeDiff.length === 0}
    <div class="node-empty">No filesystem changes</div>
  {:else}
    <div class="node-section">
      <div class="node-section-head">
        Filesystem changes
        <span class="diff-summary">
          {#if added > 0}<span class="diff-count added">+{added}</span>{/if}
          {#if changed > 0}<span class="diff-count changed">~{changed}</span>{/if}
          {#if deleted > 0}<span class="diff-count deleted">-{deleted}</span>{/if}
        </span>
      </div>
      <div class="node-section-body">
        <div class="diff-list">
          {#each safeDiff as entry}
            <div class="diff-row {KIND_CLASS[entry.kind]}">
              <span class="diff-kind">{entry.kind}</span>
              <span class="diff-path">{entry.path}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Counts live in the group header, so the list itself is nothing but rows. */
  .diff-summary {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .diff-count {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 600;
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

  /* Keeps a frame: a scrollable list of paths is its own surface. */
  .diff-list {
    margin-top: 7px;
    max-height: 420px;
    overflow-y: auto;
    padding: 4px 0;
    background: var(--bg-inset);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }

  .diff-row {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    gap: 8px;
    align-items: baseline;
    padding: 3px 11px;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    transition: background 0.1s;
  }

  .diff-row:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  /* Fixed column so every path starts on the same x, whatever the kind. */
  .diff-kind {
    text-align: center;
    font-weight: 700;
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
    min-width: 0;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
</style>
