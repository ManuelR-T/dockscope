<script lang="ts">
  import type { Anomaly } from '../../../types';
  import { IconButton } from '../ui';

  interface Props {
    anomalies: Anomaly[];
    onDismiss: (key: string) => void;
  }

  let { anomalies, onDismiss }: Props = $props();
</script>

{#each anomalies as a}
  <div class="anomaly-card">
    <div class="anomaly-header">
      <svg
        class="anomaly-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path
          d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span class="anomaly-title">{a.metric.toUpperCase()} Spike</span>
      <span class="anomaly-values">
        {Math.round(a.value)}%
        <span class="anomaly-avg">avg {Math.round(a.average)}%</span>
      </span>
      <IconButton
        variant="bare"
        size={20}
        glyphSize={15}
        title="Dismiss"
        onclick={() => onDismiss(`${a.containerId}:${a.analyzerId ?? 'legacy'}:${a.metric}`)}
      >
        &times;
      </IconButton>
    </div>
  </div>
{/each}

<style>
  .anomaly-card {
    margin: 8px 16px 0;
    padding: 8px 10px;
    background: rgba(255, 204, 0, 0.06);
    border: 1px solid rgba(255, 204, 0, 0.2);
    border-radius: 6px;
  }

  .anomaly-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .anomaly-icon {
    color: #ffcc00;
    flex-shrink: 0;
  }

  .anomaly-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: #ffcc00;
  }

  .anomaly-values {
    margin-left: auto;
    font-size: var(--text-base);
    font-family: 'Fira Code', monospace;
    color: #e2e8f0;
  }

  .anomaly-avg {
    color: rgba(255, 255, 255, 0.35);
    font-size: var(--text-sm);
  }
</style>
