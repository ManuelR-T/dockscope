<script lang="ts">
  import type { PluginEvent } from '../../../core/plugin-contract/events';
  import { Chip } from '../ui';
  import { eventPayload } from './presentation';
  let { events }: { events: PluginEvent[] } = $props();
</script>

{#if events.length === 0}
  <div class="empty-msg">No plugin events recorded.</div>
{:else}
  <div class="list">
    {#each events as event}
      <div class="item">
        <Chip tone="warn">event</Chip>
        <div class="item-main">
          <div class="item-title">
            <span>{event.type}</span>
            <code>{event.pluginId}</code>
          </div>
          <div class="item-desc">{new Date(event.time).toLocaleString()}</div>
          <pre class="content-preview">{eventPayload(event)}</pre>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .item {
    display: flex;
    gap: 10px;
    padding: 11px 12px;
    background: rgba(255, 255, 255, 0.026);
    border: 1px solid rgba(255, 255, 255, 0.045);
    border-radius: 8px;
  }

  .item-main {
    min-width: 0;
    flex: 1;
  }

  .item-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: #e2e8f0;
    font-size: var(--text-md);
    font-weight: 600;
  }

  code {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: rgba(122, 133, 153, 0.8);
  }

  .item-desc {
    margin-top: 4px;
    font-size: var(--text-base);
    line-height: 1.45;
    color: rgba(122, 133, 153, 0.82);
  }

  .content-preview {
    margin: 8px 0 0;
    white-space: pre-wrap;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: rgba(226, 232, 240, 0.66);
  }

  .empty-msg {
    padding: 30px 10px;
    text-align: center;
    font-size: var(--text-md);
    color: rgba(122, 133, 153, 0.82);
  }
</style>
