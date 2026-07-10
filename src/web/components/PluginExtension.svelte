<script lang="ts">
  import type { PluginUiContext, PluginUiExtension } from '../../core/plugin-ui';
  import { pluginUiContextMatches } from '../../core/plugin-ui';
  import Icon from './Icon.svelte';
  import PluginFrame from './PluginFrame.svelte';

  interface Props {
    extension: PluginUiExtension;
    context?: PluginUiContext;
    compact?: boolean;
    onAction: (extension: PluginUiExtension, input?: unknown) => Promise<void> | void;
  }

  let { extension, context = {}, compact = false, onAction }: Props = $props();
  let pending = $state(false);
  let visible = $derived(pluginUiContextMatches(extension, context));
  let frameKey = $derived(
    `${extension.pluginId}:${extension.id}:${extension.frontendView ?? ''}:${JSON.stringify(context)}`,
  );

  async function invoke(input?: unknown) {
    if (!extension.action || pending) {
      return;
    }
    pending = true;
    try {
      await onAction(extension, input);
    } finally {
      pending = false;
    }
  }
</script>

{#if visible}
  <section class="plugin-extension" class:compact data-slot={extension.slot}>
    {#if !compact}
      <header>
        <div>
          <strong>{extension.title}</strong>
          <span>{extension.pluginId}</span>
        </div>
        {#if extension.action}
          <button
            class="extension-action"
            disabled={pending}
            title={extension.description ?? extension.title}
            onclick={() => invoke()}
          >
            <Icon name={extension.action.type === 'open_url' ? 'external' : 'play'} size={11} />
            <span>{pending ? 'Running' : extension.title}</span>
          </button>
        {/if}
      </header>
    {:else if extension.action}
      <button
        class="compact-action"
        disabled={pending}
        title={extension.description ?? extension.title}
        onclick={() => invoke()}
      >
        <Icon name={extension.action.type === 'open_url' ? 'external' : 'play'} size={11} />
        <span>{pending ? 'Running' : extension.title}</span>
      </button>
    {/if}

    {#if extension.description && !compact}
      <p class="description">{extension.description}</p>
    {/if}

    {#if extension.content && !compact}
      {#if extension.content.type === 'text'}
        <div class="text-content">
          {extension.content.body}
        </div>
      {:else if extension.content.type === 'markdown'}
        <div class="text-content markdown">
          {extension.content.body}
        </div>
      {:else if extension.content.type === 'metrics'}
        <div class="metric-grid">
          {#each extension.content.items as item}
            <div class="metric" data-tone={item.tone ?? 'neutral'}>
              <span>{item.label}</span>
              <strong>{item.value}{item.unit ?? ''}</strong>
            </div>
          {/each}
        </div>
      {:else if extension.content.type === 'keyValue'}
        <dl>
          {#each extension.content.items as item}
            <div>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          {/each}
        </dl>
      {/if}
    {/if}

    {#if extension.frontendView && !compact}
      {#key frameKey}
        <PluginFrame {extension} {context} onAction={(input) => invoke(input)} />
      {/key}
    {/if}
  </section>
{/if}

<style>
  .plugin-extension {
    width: 100%;
    min-width: 0;
    padding: 10px;
    border: 1px solid rgba(0, 228, 255, 0.1);
    border-radius: 6px;
    background: rgba(7, 10, 22, 0.88);
    color: var(--text-primary);
  }

  .plugin-extension.compact {
    width: auto;
    padding: 0;
    border: 0;
    background: transparent;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }

  header > div {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  header strong {
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 600;
  }

  header span,
  .description {
    color: var(--text-dim);
    font-size: 9px;
  }

  .description {
    margin: 0 0 8px;
    line-height: 1.45;
  }

  button {
    font-family: var(--font-ui);
    cursor: pointer;
  }

  .extension-action,
  .compact-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-height: 26px;
    padding: 4px 8px;
    border: 1px solid rgba(0, 228, 255, 0.14);
    border-radius: 5px;
    background: rgba(0, 228, 255, 0.05);
    color: var(--accent-cyan);
    font-size: 9px;
  }

  .extension-action:disabled,
  .compact-action:disabled {
    cursor: wait;
    opacity: 0.55;
  }

  .text-content {
    color: var(--text-secondary);
    font-size: 10px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .text-content.markdown {
    font-family: var(--font-mono);
    padding-left: 8px;
    border-left: 2px solid rgba(0, 228, 255, 0.18);
  }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(86px, 1fr));
    gap: 5px;
  }

  .metric {
    min-width: 0;
    display: grid;
    gap: 2px;
    padding: 7px;
    border-left: 2px solid var(--text-dim);
    background: rgba(255, 255, 255, 0.025);
  }

  .metric[data-tone='success'] {
    border-color: var(--accent-green);
  }

  .metric[data-tone='warning'] {
    border-color: var(--accent-amber);
  }

  .metric[data-tone='danger'] {
    border-color: var(--accent-red);
  }

  .metric[data-tone='info'] {
    border-color: var(--accent-cyan);
  }

  .metric span,
  dt {
    color: var(--text-dim);
    font-size: 8px;
    text-transform: uppercase;
  }

  .metric strong {
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  dl {
    display: grid;
    gap: 4px;
  }

  dl > div {
    display: grid;
    grid-template-columns: minmax(70px, 0.8fr) minmax(0, 1.2fr);
    gap: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 9px;
  }
</style>
