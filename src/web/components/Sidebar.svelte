<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import {
    subscribeLogs,
    unsubscribeLogs,
    addToast,
    addDiagnostic,
    removeDiagnostic,
    removeAnomaly,
    getAnomaliesForContainer,
  } from '../stores/docker.svelte';
  import EntityActionDialog from './EntityActionDialog.svelte';
  import SidebarHeader from './SidebarHeader.svelte';
  import SidebarInfo from './sidebar/SidebarInfo.svelte';
  import SidebarEnv from './sidebar/SidebarEnv.svelte';
  import SidebarLogs from './sidebar/SidebarLogs.svelte';
  import SidebarTop from './sidebar/SidebarTop.svelte';
  import SidebarDiff from './sidebar/SidebarDiff.svelte';
  import SidebarExec from './sidebar/SidebarExec.svelte';
  import SidebarDiagnostic from './sidebar/SidebarDiagnostic.svelte';
  import SidebarAnomaly from './sidebar/SidebarAnomaly.svelte';
  import PluginExtension from './PluginExtension.svelte';
  import { getDockerState } from '../stores/docker.svelte';
  import type { ServiceNode, ContainerStats, ContainerInspect, MetricPoint } from '../../types';
  import { pluginUiContextMatches, type PluginUiExtension } from '../../core/plugin-ui';
  import { pluginUiContextFromNode } from '../lib/pluginUi';
  import { apiErrorMessage, isAbortError } from '../lib/api';
  import type { EntityAction } from '../../core/entity-actions';
  import type { EntityOperationDescriptor } from '../../core/operations';
  import type { PluginConfig } from '../../core/plugin-config';
  import {
    getEntityLogs,
    hasEntityOperation,
    loadEntityCapabilities,
    loadEntitySidebarData,
    runEntityAction,
  } from '../lib/sidebarApi';

  const docker = getDockerState();

  interface Props {
    node: ServiceNode | null;
    onClose: () => void;
    colorNetworks?: boolean;
    extensions?: PluginUiExtension[];
    onPluginAction?: (extension: PluginUiExtension, input?: unknown) => Promise<void> | void;
  }

  let {
    node,
    onClose,
    colorNetworks = false,
    extensions = [],
    onPluginAction = () => {},
  }: Props = $props();

  let stats = $state<ContainerStats | null>(null);
  let inspect = $state<ContainerInspect | null>(null);
  let history = $state<MetricPoint[]>([]);
  let activeTab = $state<'info' | 'env' | 'logs' | 'top' | 'diff' | 'exec'>('info');
  let fetchedLogs = $state('');
  let actionPending = $state(false);
  let entityActions = $state<EntityAction[]>([]);
  let entityOperations = $state<EntityOperationDescriptor[]>([]);
  let actionDialog = $state<EntityAction | null>(null);
  let pluginContext = $derived(pluginUiContextFromNode(node));
  let sidebarExtensions = $derived(
    extensions.filter(
      (extension) =>
        extension.slot === 'sidebar' && pluginUiContextMatches(extension, pluginContext),
    ),
  );
  let nodePanelExtensions = $derived(
    extensions.filter(
      (extension) =>
        extension.slot === 'nodePanel' && pluginUiContextMatches(extension, pluginContext),
    ),
  );
  let nodeActionExtensions = $derived(
    extensions.filter(
      (extension) =>
        extension.slot === 'nodeAction' && pluginUiContextMatches(extension, pluginContext),
    ),
  );

  function toastActionFailure(prefix: string, error: unknown) {
    const detail = apiErrorMessage(error);
    addToast(detail ? `${prefix}: ${detail}` : prefix, 'error');
  }

  function supports(operation: EntityOperationDescriptor['id']): boolean {
    return hasEntityOperation(entityOperations, operation);
  }

  function tabSupported(
    tab: typeof activeTab,
    operations: readonly EntityOperationDescriptor[],
    currentNode: ServiceNode,
  ): boolean {
    if (tab === 'info') {
      return true;
    }
    if (tab === 'env') {
      return hasEntityOperation(operations, 'inspect');
    }
    if (tab === 'logs') {
      return hasEntityOperation(operations, 'logs') || hasEntityOperation(operations, 'logStream');
    }
    if (tab === 'top') {
      return (
        hasEntityOperation(operations, 'top') &&
        (currentNode.status === 'running' || currentNode.status === 'paused')
      );
    }
    if (tab === 'diff') {
      return hasEntityOperation(operations, 'diff');
    }
    return hasEntityOperation(operations, 'exec') && currentNode.status === 'running';
  }

  function requestEntityAction(action: EntityAction): void {
    if (actionPending) {
      return;
    }
    if (action.confirm || (action.input?.fields.length ?? 0) > 0) {
      actionDialog = action;
      return;
    }
    void executeEntityAction(action);
  }

  async function executeEntityAction(action: EntityAction, input?: PluginConfig) {
    if (!node || actionPending) {
      return;
    }
    const target = node;
    actionPending = true;
    try {
      const result = await runEntityAction(target, action, input);
      addToast(result.message || `${action.title} completed`, result.ok ? 'success' : 'error');
      actionDialog = null;
      if (action.effect === 'remove') {
        onClose();
      }
    } catch (error) {
      if (!isAbortError(error)) {
        toastActionFailure(`${action.title} failed`, error);
      }
    } finally {
      actionPending = false;
    }
  }

  // Resolve plugin-owned operations before loading entity-specific data.
  $effect(() => {
    const currentNode = node;
    if (!currentNode) {
      stats = null;
      inspect = null;
      history = [];
      fetchedLogs = '';
      entityActions = [];
      entityOperations = [];
      actionDialog = null;
      return;
    }
    // Replay mode shows historical node state — live inspect/stats/logs would contradict it
    if (docker.replayMode) {
      stats = null;
      inspect = null;
      history = [];
      fetchedLogs = '';
      entityActions = [];
      entityOperations = [];
      actionDialog = null;
      activeTab = 'info';
      return;
    }
    stats = null;
    inspect = null;
    history = [];
    fetchedLogs = '';
    entityActions = [];
    entityOperations = [];
    actionDialog = null;

    const controller = new AbortController();
    const loadDiagnostic = untrack(() => !docker.diagnostics.has(currentNode.id));
    loadEntityCapabilities(currentNode, { signal: controller.signal })
      .then(async (capabilities) => {
        if (controller.signal.aborted) {
          return null;
        }
        entityActions = capabilities.actions;
        entityOperations = capabilities.operations;
        if (
          !tabSupported(
            untrack(() => activeTab),
            capabilities.operations,
            currentNode,
          )
        ) {
          activeTab = 'info';
        }
        return loadEntitySidebarData(currentNode, capabilities.operations, {
          loadDiagnostic,
          signal: controller.signal,
        });
      })
      .then((data) => {
        if (controller.signal.aborted || !data) {
          return;
        }
        stats = data.stats;
        inspect = data.inspect;
        history = data.history;
        if (data.diagnostic) {
          addDiagnostic(data.diagnostic);
        }
      })
      .catch((error) => {
        if (isAbortError(error) || controller.signal.aborted) {
          return;
        }
        stats = null;
        inspect = null;
        history = [];
        entityActions = [];
        entityOperations = [];
      });

    return () => controller.abort();
  });

  // Log streaming subscription
  $effect(() => {
    const tab = activeTab;
    const currentNode = node;
    const containerId = currentNode?.containerId ?? null;
    const host = currentNode?.host ?? 'local';
    const canStream = supports('logStream');
    const canRead = supports('logs');
    const replayActive = docker.replayMode;
    return untrack(() => {
      const controller = new AbortController();
      const shouldStreamLogs = tab === 'logs' && containerId !== null && canStream && !replayActive;

      if (shouldStreamLogs) {
        subscribeLogs(containerId, host);
      } else {
        unsubscribeLogs();
      }

      if (tab === 'logs' && currentNode && canRead && !canStream && !replayActive) {
        fetchedLogs = '';
        getEntityLogs(currentNode, 300, { signal: controller.signal })
          .then((logs) => {
            if (!controller.signal.aborted) {
              fetchedLogs = logs;
            }
          })
          .catch((error) => {
            if (!isAbortError(error) && !controller.signal.aborted) {
              fetchedLogs = '';
            }
          });
      }

      return () => {
        controller.abort();
        if (shouldStreamLogs) {
          unsubscribeLogs();
        }
      };
    });
  });

  onDestroy(() => unsubscribeLogs());
</script>

<div class="sidebar">
  {#if !node}
    <div class="sidebar-empty">
      <div class="brand">DockScope</div>
      <div class="brand-sub">Infrastructure Debugger</div>
      <div class="instruction">Select a graph node to inspect infrastructure metadata.</div>
      <div class="legend">
        <div class="legend-title">Legend</div>
        <div class="legend-item"><span class="status-dot running"></span> Running (healthy)</div>
        <div class="legend-item">
          <span class="status-dot cyan"></span> Running (no healthcheck)
        </div>
        <div class="legend-item"><span class="status-dot other"></span> Other</div>
        <div class="legend-item"><span class="status-dot unhealthy"></span> Unhealthy</div>
        <div class="legend-item"><span class="status-dot exited"></span> Stopped</div>
        <div class="legend-line"><span class="line depends"></span> depends_on</div>
        <div class="legend-line"><span class="line network"></span> shared network</div>
      </div>
      {#if sidebarExtensions.length > 0}
        <div class="plugin-sidebar-extensions">
          {#each sidebarExtensions as extension (extension.pluginId + extension.id)}
            <PluginExtension {extension} context={pluginContext} onAction={onPluginAction} />
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <SidebarHeader
      {node}
      actions={entityActions}
      {actionPending}
      hideActions={docker.replayMode}
      {onClose}
      onAction={requestEntityAction}
    />

    {#if nodeActionExtensions.length > 0}
      <div class="plugin-node-actions">
        {#each nodeActionExtensions as extension (extension.pluginId + extension.id)}
          <PluginExtension {extension} context={pluginContext} compact onAction={onPluginAction} />
        {/each}
      </div>
    {/if}

    <div class="sidebar-tabs">
      <button
        class="tab {activeTab === 'info' ? 'active' : ''}"
        onclick={() => (activeTab = 'info')}>Info</button
      >
      {#if docker.replayMode}
        <span class="replay-note">Historical view — live tabs disabled</span>
      {:else}
        {#if supports('inspect')}
          <button
            class="tab {activeTab === 'env' ? 'active' : ''}"
            onclick={() => (activeTab = 'env')}>Env</button
          >
        {/if}
        {#if supports('logs') || supports('logStream')}
          <button
            class="tab {activeTab === 'logs' ? 'active' : ''}"
            onclick={() => (activeTab = 'logs')}>Logs</button
          >
        {/if}
        {#if supports('top') && (node.status === 'running' || node.status === 'paused')}
          <button
            class="tab {activeTab === 'top' ? 'active' : ''}"
            onclick={() => (activeTab = 'top')}>Top</button
          >
        {/if}
        {#if supports('diff')}
          <button
            class="tab {activeTab === 'diff' ? 'active' : ''}"
            onclick={() => (activeTab = 'diff')}>Diff</button
          >
        {/if}
        {#if supports('exec') && node.status === 'running'}
          <button
            class="tab {activeTab === 'exec' ? 'active' : ''}"
            onclick={() => (activeTab = 'exec')}>Exec</button
          >
        {/if}
      {/if}
    </div>

    {#if docker.diagnostics.has(node.id)}
      <SidebarDiagnostic
        diagnostic={docker.diagnostics.get(node.id)!}
        onDismiss={() => removeDiagnostic(node.id)}
      />
    {/if}

    {#if getAnomaliesForContainer(node.id).length > 0}
      <SidebarAnomaly anomalies={getAnomaliesForContainer(node.id)} onDismiss={removeAnomaly} />
    {/if}

    {#if activeTab === 'info'}
      <SidebarInfo {node} {stats} {inspect} {history} {colorNetworks} />
      {#if nodePanelExtensions.length > 0}
        <div class="plugin-node-panels">
          {#each nodePanelExtensions as extension (extension.pluginId + extension.id)}
            <PluginExtension {extension} context={pluginContext} onAction={onPluginAction} />
          {/each}
        </div>
      {/if}
    {:else if activeTab === 'env'}
      <SidebarEnv {inspect} />
    {:else if activeTab === 'logs'}
      <SidebarLogs
        logs={supports('logStream') ? undefined : fetchedLogs}
        placeholder={supports('logStream') ? 'Connecting to log stream...' : 'Loading logs...'}
      />
    {:else if activeTab === 'top'}
      <SidebarTop {node} />
    {:else if activeTab === 'diff'}
      <SidebarDiff {node} />
    {:else if activeTab === 'exec'}
      <SidebarExec {node} />
    {/if}
    {#if sidebarExtensions.length > 0}
      <div class="plugin-sidebar-extensions selected">
        {#each sidebarExtensions as extension (extension.pluginId + extension.id)}
          <PluginExtension {extension} context={pluginContext} onAction={onPluginAction} />
        {/each}
      </div>
    {/if}
  {/if}
</div>

{#if actionDialog && node}
  <EntityActionDialog
    action={actionDialog}
    entityName={node.name}
    pending={actionPending}
    onConfirm={(input) => executeEntityAction(actionDialog!, input)}
    onCancel={() => (actionDialog = null)}
  />
{/if}

<style>
  .plugin-sidebar-extensions,
  .plugin-node-panels {
    display: grid;
    gap: 6px;
    padding: 8px 12px 12px;
  }

  .plugin-sidebar-extensions.selected {
    padding-top: 0;
  }

  .plugin-node-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border-subtle);
    background: rgba(0, 228, 255, 0.02);
  }
</style>
