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
      <div class="node-section">
        <div class="node-section-head">
          Environment
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
        <div class="node-section-body">
          <div class="env-list">
            {#each inspect.env as envLine}
              <div class="env-row mono">{maskValue(envLine, showSecrets)}</div>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    {#if Object.keys(inspect.labels).length > 0}
      <div class="node-section">
        <div class="node-section-head">Labels</div>
        <div class="node-section-body">
          <div class="env-list">
            {#each Object.entries(inspect.labels) as [key, value]}
              <div class="env-row mono"><span class="env-key">{key}</span>={value}</div>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    {#if inspect.mounts.length > 0}
      <div class="node-section">
        <div class="node-section-head">Mounts</div>
        <div class="node-section-body">
          {#each inspect.mounts as mount}
            <div class="field-row">
              <span class="field-key">{mount.type}</span>
              <span class="field-val mono">
                {mount.source} &rarr; {mount.destination}
                <span class="mount-mode">({mount.mode})</span>
              </span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if (inspect.cmd && inspect.cmd.length > 0) || (inspect.workingDir && inspect.workingDir !== '/')}
      <div class="node-section">
        <div class="node-section-head">Entrypoint</div>
        <div class="node-section-body">
          {#if inspect.cmd && inspect.cmd.length > 0}
            <div class="field-stack">
              <span class="field-key">Command</span>
              <span class="mono field-val">{inspect.cmd.join(' ')}</span>
            </div>
          {/if}
          {#if inspect.workingDir && inspect.workingDir !== '/'}
            <div class="field-row">
              <span class="field-key">Workdir</span>
              <span class="field-val mono">{inspect.workingDir}</span>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {:else}
    <div class="node-empty">Loading configuration...</div>
  {/if}
</div>
