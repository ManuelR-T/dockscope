<script lang="ts">
  import { maskValue } from '../../lib/security';
  import { Button } from '../ui';
  import type { ContainerInspect } from '../../../types';

  interface Props {
    inspect: ContainerInspect | null;
  }

  let { inspect }: Props = $props();

  let showSecrets = $state(false);
</script>

<div class="sidebar-content">
  {#if inspect}
    {#if inspect.env.length > 0}
      <div class="info-section">
        <div class="field-label-row">
          <span class="field-label">Environment Variables</span>
          <Button
            variant="ghost"
            size="sm"
            pill
            active={showSecrets}
            onclick={() => (showSecrets = !showSecrets)}
          >
            {showSecrets ? 'Hide' : 'Reveal'}
          </Button>
        </div>
        <div class="env-list">
          {#each inspect.env as envLine}
            <div class="env-row mono">{maskValue(envLine, showSecrets)}</div>
          {/each}
        </div>
      </div>
    {/if}

    {#if Object.keys(inspect.labels).length > 0}
      <div class="info-section">
        <span class="field-label">Labels</span>
        <div class="env-list">
          {#each Object.entries(inspect.labels) as [key, value]}
            <div class="env-row mono">
              <span style="color: var(--accent-cyan)">{key}</span>={value}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if inspect.mounts.length > 0}
      <div class="info-section">
        <span class="field-label">Mounts</span>
        {#each inspect.mounts as mount}
          <div class="mount-row">
            <span class="tag">{mount.type}</span>
            <span class="mono" style="font-size: var(--text-sm);">
              {mount.source} &rarr; {mount.destination}
              <span style="color: var(--text-dim)">({mount.mode})</span>
            </span>
          </div>
        {/each}
      </div>
    {/if}

    {#if inspect.cmd}
      <div class="info-section">
        <span class="field-label">Command</span>
        <span class="mono">{inspect.cmd.join(' ')}</span>
      </div>
    {/if}

    {#if inspect.workingDir && inspect.workingDir !== '/'}
      <div class="info-section">
        <span class="field-label">Working Directory</span>
        <span class="mono">{inspect.workingDir}</span>
      </div>
    {/if}
  {:else}
    <div class="env-loading">Loading configuration...</div>
  {/if}
</div>
