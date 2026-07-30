<script lang="ts">
  import type { CrashDiagnostic } from '../../../types';
  import { Chip, IconButton } from '../ui';

  interface Props {
    diagnostic: CrashDiagnostic;
    onDismiss: () => void;
  }

  let { diagnostic, onDismiss }: Props = $props();

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
    <IconButton variant="bare" size={22} glyphSize={16} title="Dismiss" onclick={onDismiss}>
      &times;
    </IconButton>
  </div>

  <div class="diag-cause">{diagnostic.cause}</div>

  <div class="diag-meta">
    <Chip tone={diagnostic.oomKilled ? 'danger' : 'warn'} mono>
      Exit {diagnostic.exitCode}
    </Chip>
    {#if diagnostic.oomKilled}
      <Chip tone="danger" mono>OOM</Chip>
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
    font-size: var(--text-base);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #ff2b4e;
  }

  .diag-time {
    margin-left: auto;
    font-size: var(--text-sm);
    color: rgba(255, 255, 255, 0.3);
    font-family: 'Fira Code', monospace;
  }

  .diag-cause {
    font-size: var(--text-xl);
    font-weight: 600;
    color: #e2e8f0;
    margin-bottom: 8px;
  }

  .diag-meta {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }

  .diag-details {
    margin: 0 0 8px;
    padding-left: 16px;
    font-size: var(--text-base);
    color: rgba(255, 255, 255, 0.5);
    list-style: disc;
  }

  .diag-details li {
    margin-bottom: 2px;
  }

  .diag-logs-title {
    font-size: var(--text-sm);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.3);
    margin-bottom: 4px;
  }

  .diag-logs {
    font-size: var(--text-sm);
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
