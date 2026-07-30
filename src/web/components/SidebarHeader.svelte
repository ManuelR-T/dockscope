<script lang="ts">
  import type { EntityAction } from '../../core/entity-actions';
  import type { ServiceNode } from '../../types';
  import { ICONS, type IconName } from '../lib/icons';
  import Icon from './Icon.svelte';
  import { CloseButton, IconButton, MenuItem } from './ui';

  interface Props {
    node: ServiceNode;
    actions: EntityAction[];
    actionPending: boolean;
    hideActions?: boolean;
    onClose: () => void;
    onAction: (action: EntityAction) => void;
  }

  let { node, actions, actionPending, hideActions = false, onClose, onAction }: Props = $props();

  let showMore = $state(false);
  let moreBtn = $state<HTMLElement | null>(null);
  let primaryActions = $derived(actions.filter((action) => action.placement === 'primary'));
  let menuActions = $derived(actions.filter((action) => action.placement !== 'primary'));

  $effect(() => {
    void node.id;
    showMore = false;
  });

  function iconName(action: EntityAction): IconName {
    return action.icon && action.icon in ICONS ? (action.icon as IconName) : 'plug';
  }

  function run(action: EntityAction): void {
    showMore = false;
    onAction(action);
  }
</script>

<div class="sidebar-header">
  <div class="sidebar-title">
    <span
      class="status-dot {node.status === 'running'
        ? node.health === 'unhealthy'
          ? 'unhealthy'
          : 'running'
        : node.status === 'paused'
          ? 'paused'
          : 'exited'}"
    ></span>
    <h3>{node.name}</h3>
  </div>
  <div class="header-right">
    {#if !hideActions}
      {#each primaryActions as action (action.pluginId + action.id)}
        <IconButton
          variant="filled"
          size={30}
          tone={action.tone === 'success'
            ? 'success'
            : action.tone === 'warning'
              ? 'warn'
              : action.tone === 'danger'
                ? 'danger'
                : 'accent'}
          spinning={actionPending && action.icon === 'restart'}
          title={action.description ?? action.title}
          onclick={() => run(action)}
          disabled={actionPending}
        >
          <Icon name={iconName(action)} size={11} />
        </IconButton>
      {/each}

      {#if menuActions.length > 0}
        <IconButton
          variant="filled"
          size={30}
          title="More actions"
          onclick={(event) => {
            moreBtn = event.currentTarget as HTMLElement;
            showMore = !showMore;
          }}
          disabled={actionPending}
        >
          <Icon name="dots" />
        </IconButton>
      {/if}
    {/if}

    <span class="header-sep"></span>
    <CloseButton label="Close details" onclick={onClose} />
  </div>
</div>

{#if showMore && moreBtn}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="more-backdrop" onclick={() => (showMore = false)} onkeydown={() => {}}></div>
  <div
    class="more-menu"
    style="top: {moreBtn.getBoundingClientRect().bottom + 4}px; right: {window.innerWidth -
      moreBtn.getBoundingClientRect().right}px;"
  >
    {#each menuActions as action (action.pluginId + action.id)}
      <MenuItem tone={action.tone === 'danger' ? 'danger' : 'default'} onclick={() => run(action)}>
        {action.title}
      </MenuItem>
    {/each}
  </div>
{/if}
