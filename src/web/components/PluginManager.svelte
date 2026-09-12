<script lang="ts">
  import { onMount } from 'svelte';
  import { allowsUiIntent, type AccessRole } from '../../core/access';
  import { CloseButton, Tab, TabBar } from './ui';
  import InstalledPlugins from './plugins/InstalledPlugins.svelte';
  import PluginMarketplace from './plugins/PluginMarketplace.svelte';
  import MarketplaceReview from './plugins/MarketplaceReview.svelte';
  import PluginEvents from './plugins/PluginEvents.svelte';
  import { PluginManagerData } from './plugins/data.svelte';
  import { InstalledPluginsModel } from './plugins/installed.svelte';
  import { MarketplaceModel } from './plugins/marketplace.svelte';

  let { onClose, role }: { onClose: () => void; role: AccessRole | null } = $props();
  let tab = $state<'installed' | 'marketplace' | 'events'>('installed');
  const data = new PluginManagerData();
  const installed = new InstalledPluginsModel(data, () => role);
  const marketplace = new MarketplaceModel(data, () => role);
  const canOperate = $derived(allowsUiIntent(role, 'mutation'));

  onMount(() => {
    void data.loadPluginState();
    const timer = window.setInterval(() => {
      if (tab === 'installed' && !data.loading) {
        void data.refreshRuntimeHealth();
      }
    }, 5000);
    return () => window.clearInterval(timer);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="header">
      <TabBar ariaLabel="Plugin views">
        <Tab active={tab === 'installed'} onclick={() => (tab = 'installed')}>Installed</Tab>
        <Tab active={tab === 'marketplace'} onclick={() => (tab = 'marketplace')}>Marketplace</Tab>
        <Tab active={tab === 'events'} onclick={() => (tab = 'events')}>Events</Tab>
      </TabBar>
      {#if !canOperate}
        <span class="read-only-badge" title="Operator access is required to change plugins">
          Read-only
        </span>
      {/if}
      <span class="header-close">
        <CloseButton label="Close plugins" onclick={onClose} />
      </span>
    </div>

    <div class="content">
      {#if data.loading}
        <div class="empty-msg">Loading plugins...</div>
      {:else if tab === 'installed'}
        <InstalledPlugins {data} model={installed} {role} />
      {:else if tab === 'marketplace'}
        <PluginMarketplace {data} model={marketplace} />
      {:else}
        <PluginEvents events={data.events} />
      {/if}
    </div>
    <MarketplaceReview {data} model={marketplace} />
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(4, 4, 14, 0.64);
    backdrop-filter: blur(5px);
  }

  .panel {
    position: relative;
    width: min(880px, calc(100vw - 28px));
    max-height: min(760px, calc(100vh - 28px));
    display: flex;
    flex-direction: column;
    background: rgba(8, 10, 24, 0.96);
    border: 1px solid rgba(0, 228, 255, 0.12);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 20px 80px rgba(0, 0, 0, 0.35);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .header-close {
    display: flex;
    align-self: flex-start;
    margin-top: 4px;
  }

  .read-only-badge {
    margin-left: auto;
    color: var(--accent-amber);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .content {
    padding: 16px 18px 18px;
    overflow-y: auto;
  }

  .empty-msg {
    padding: 30px 10px;
    text-align: center;
    font-size: var(--text-md);
    color: rgba(122, 133, 153, 0.82);
  }
</style>
