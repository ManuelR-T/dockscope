<script lang="ts">
  import type { CrashDiagnostic } from '../../../types';

  interface Props {
    diagnostic: CrashDiagnostic;
  }

  let { diagnostic }: Props = $props();

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }
</script>

<div class="diag-card">
  <div class="diag-header">
    <svg
      class="diag-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
      />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
    <span class="diag-title">Crash Diagnostic</span>
    <span class="diag-time">{formatTime(diagnostic.time)}</span>
  </div>

  <div class="diag-cause">{diagnostic.cause}</div>

  <div class="diag-meta">
    <span class="diag-tag exit" class:oom={diagnostic.oomKilled}>
      Exit {diagnostic.exitCode}
    </span>
    {#if diagnostic.oomKilled}
      <span class="diag-tag oom">OOM</span>
    {/if}
  </div>

  {#if diagnostic.details.length > 0}
    <ul class="diag-details">
      {#each diagnostic.details as detail}
        <li>{detail}</li>
      {/each}
    </ul>
  {/if}

  {#if diagnostic.logSnippet.length > 0}
    <div class="diag-logs-title">Last log lines</div>
    <pre class="diag-logs">{diagnostic.logSnippet.join('\n')}</pre>
  {/if}
</div>

<style>
  .diag-card {
    margin: 12px 16px;
    padding: 12px;
    background: rgba(255, 43, 78, 0.08);
    border: 1px solid rgba(255, 43, 78, 0.25);
    border-radius: 8px;
  }

  .diag-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }

  .diag-icon {
    color: #ff2b4e;
    flex-shrink: 0;
  }

  .diag-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #ff2b4e;
  }

  .diag-time {
    margin-left: auto;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.3);
    font-family: 'Fira Code', monospace;
  }

  .diag-cause {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
    margin-bottom: 8px;
  }

  .diag-meta {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }

  .diag-tag {
    font-size: 10px;
    font-family: 'Fira Code', monospace;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.5);
  }

  .diag-tag.oom {
    background: rgba(255, 43, 78, 0.15);
    color: #ff2b4e;
  }

  .diag-tag.exit {
    background: rgba(255, 138, 43, 0.15);
    color: #ff8a2b;
  }

  .diag-details {
    margin: 0 0 8px;
    padding-left: 16px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    list-style: disc;
  }

  .diag-details li {
    margin-bottom: 2px;
  }

  .diag-logs-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.3);
    margin-bottom: 4px;
  }

  .diag-logs {
    font-size: 10px;
    font-family: 'Fira Code', monospace;
    color: rgba(255, 255, 255, 0.45);
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    padding: 8px;
    margin: 0;
    max-height: 150px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
