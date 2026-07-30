<script lang="ts">
  import { getDockerState } from '../../stores/docker.svelte';
  import { IconButton } from '../ui';
  import { ansiToHtml, highlightLogSearch } from '../../lib/ansi';
  import { downloadText } from '../../lib/download';

  interface Props {
    logs?: string;
    placeholder?: string;
  }

  let { logs, placeholder = 'Connecting to log stream...' }: Props = $props();

  const docker = getDockerState();

  let logBottom = $state<HTMLDivElement | null>(null);
  let logSearch = $state('');

  let activeLogs = $derived(logs ?? docker.streamingLogs);
  let processed = $derived(ansiToHtml(activeLogs));
  let searched = $derived(
    logSearch ? highlightLogSearch(processed, logSearch) : { html: processed, count: 0 },
  );

  // Auto-scroll logs to bottom
  $effect(() => {
    if (activeLogs && logBottom) {
      logBottom.scrollIntoView({ behavior: 'smooth' });
    }
  });

  function exportLogs() {
    const text = activeLogs;
    if (!text) {
      return;
    }
    downloadText(
      text,
      'text/plain',
      `logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`,
    );
  }
</script>

<div class="log-search-bar">
  <input type="text" class="log-search-input" placeholder="Search logs..." bind:value={logSearch} />
  {#if logSearch}
    <span class="log-match-count">{searched.count} match{searched.count !== 1 ? 'es' : ''}</span>
  {/if}
  <IconButton
    variant="outline"
    size={24}
    title="Export logs"
    onclick={exportLogs}
    disabled={!activeLogs}
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline
        points="7 10 12 15 17 10"
      /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  </IconButton>
</div>
<div class="sidebar-logs">
  <pre>{@html searched.html ||
      `<span style="color:var(--text-dim);font-style:italic">${placeholder}</span>`}<div
      bind:this={logBottom}></div></pre>
</div>
