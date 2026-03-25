<script lang="ts">
  import { getDockerState } from '../../stores/docker.svelte';
  import { ansiToHtml, highlightLogSearch } from '../../lib/ansi';

  const docker = getDockerState();

  let logBottom = $state<HTMLDivElement | null>(null);
  let logSearch = $state('');

  let processed = $derived(ansiToHtml(docker.streamingLogs));
  let searched = $derived(
    logSearch ? highlightLogSearch(processed, logSearch) : { html: processed, count: 0 },
  );

  // Auto-scroll logs to bottom
  $effect(() => {
    if (docker.streamingLogs && logBottom) {
      logBottom.scrollIntoView({ behavior: 'smooth' });
    }
  });
</script>

<div class="log-search-bar">
  <input type="text" class="log-search-input" placeholder="Search logs..." bind:value={logSearch} />
  {#if logSearch}
    <span class="log-match-count">{searched.count} match{searched.count !== 1 ? 'es' : ''}</span>
  {/if}
</div>
<div class="sidebar-logs">
  <pre>{@html searched.html ||
      '<span style="color:var(--text-dim);font-style:italic">Connecting to log stream...</span>'}<div
      bind:this={logBottom}></div></pre>
</div>
