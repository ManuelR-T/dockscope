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
  import ConfirmDialog from './ConfirmDialog.svelte';
  import HpaReplicaDialog from './HpaReplicaDialog.svelte';
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
  import {
    containerActionPastTense,
    getHpaReplicaRange,
    getKubernetesPodLogs,
    kubernetesActionPastTense,
    loadDockerSidebarData,
    removeContainer,
    runContainerAction,
    runKubernetesAction,
    type ContainerUiAction,
    type KubernetesUiAction,
  } from '../lib/sidebarApi';
  import {
    confirmKill,
    confirmKubernetesDelete,
    confirmKubernetesRestart,
    confirmRemove,
    confirmStop,
    type ConfirmKind,
  } from '../lib/sidebarActions';

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
  let kubernetesLogs = $state('');
  let actionPending = $state(false);
  let hpaDialog = $state<{ node: ServiceNode; min: number; max: number } | null>(null);

  let confirmDialog = $state<{
    title: string;
    message: string;
    confirmLabel: string;
    variant: 'warning' | 'danger';
    typeToConfirm?: string;
    action: () => Promise<void>;
  } | null>(null);
  let isKubernetesNode = $derived(node?.runtime === 'kubernetes');
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

  async function doAction(action: ContainerUiAction) {
    if (!node || actionPending) {
      return;
    }
    const target = node;
    actionPending = true;
    try {
      await runContainerAction(target, action);
      addToast(`Container ${containerActionPastTense(action)}`, 'success');
    } catch (error) {
      if (!isAbortError(error)) {
        toastActionFailure(`Failed to ${action}`, error);
      }
    } finally {
      actionPending = false;
    }
  }

  async function doRemove(withVolumes: boolean) {
    if (!node || actionPending) {
      return;
    }
    const target = node;
    actionPending = true;
    try {
      await removeContainer(target, withVolumes);
      addToast(`Container removed${withVolumes ? ' with volumes' : ''}`, 'success');
      onClose();
    } catch (error) {
      if (!isAbortError(error)) {
        toastActionFailure('Failed to remove', error);
      }
    } finally {
      actionPending = false;
    }
  }

  async function doKubernetesAction(
    action: KubernetesUiAction,
    options: { minReplicas?: number; maxReplicas?: number } = {},
    targetNode = node,
  ) {
    if (!targetNode || actionPending) {
      return;
    }
    const target = targetNode;
    actionPending = true;
    try {
      await runKubernetesAction(target, action, options);
      addToast(`Kubernetes ${target.kind} ${kubernetesActionPastTense(action)}`, 'success');
      if (action === 'delete') {
        onClose();
      }
    } catch (error) {
      if (!isAbortError(error)) {
        toastActionFailure(`Failed to ${action}`, error);
      }
    } finally {
      actionPending = false;
    }
  }

  function showHpaReplicaDialog(node: ServiceNode) {
    const current = getHpaReplicaRange(node);
    hpaDialog = { node, min: current.min, max: current.max };
  }

  /** Open the confirm dialog for a destructive action requested by the header */
  function openConfirm(kind: ConfirmKind) {
    const target = node;
    if (!target) {
      return;
    }
    switch (kind) {
      case 'stop':
        confirmDialog = { ...confirmStop(target), action: () => doAction('stop') };
        break;
      case 'kill':
        confirmDialog = { ...confirmKill(target), action: () => doAction('kill') };
        break;
      case 'remove':
        confirmDialog = { ...confirmRemove(target, false), action: () => doRemove(false) };
        break;
      case 'removeVolumes':
        confirmDialog = { ...confirmRemove(target, true), action: () => doRemove(true) };
        break;
      case 'k8sRestart':
        confirmDialog = {
          ...confirmKubernetesRestart(target),
          action: () => doKubernetesAction('restart'),
        };
        break;
      case 'k8sDelete':
        confirmDialog = {
          ...confirmKubernetesDelete(target),
          action: () => doKubernetesAction('delete'),
        };
        break;
    }
  }

  // Fetch stats + inspect + history when node changes
  $effect(() => {
    const currentNode = node;
    if (!currentNode) {
      stats = null;
      inspect = null;
      history = [];
      kubernetesLogs = '';
      return;
    }
    // Replay mode shows historical node state — live inspect/stats/logs would contradict it
    if (docker.replayMode) {
      stats = null;
      inspect = null;
      history = [];
      kubernetesLogs = '';
      activeTab = 'info';
      return;
    }
    const isKubernetes = currentNode.runtime === 'kubernetes';
    const tab = untrack(() => activeTab);
    if (isKubernetes && tab !== 'info') {
      activeTab = 'info';
    }
    // Fall back to 'info' only if current tab isn't available for this node
    const runningTabs = ['top', 'exec'];
    if (
      runningTabs.includes(tab) &&
      currentNode.status !== 'running' &&
      currentNode.status !== 'paused'
    ) {
      activeTab = 'info';
    }
    stats = null;
    inspect = null;
    history = [];
    kubernetesLogs = '';

    const controller = new AbortController();
    if (isKubernetes) {
      return () => controller.abort();
    }

    const loadDiagnostic = untrack(() => !docker.diagnostics.has(currentNode.id));
    loadDockerSidebarData(currentNode, {
      loadDiagnostic,
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) {
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
      });

    return () => controller.abort();
  });

  // Log streaming subscription
  $effect(() => {
    const tab = activeTab;
    const currentNode = node;
    const containerId = currentNode?.containerId ?? null;
    const host = currentNode?.host ?? 'local';
    const runtime = currentNode?.runtime;
    const kind = currentNode?.kind;
    const replayActive = docker.replayMode;
    return untrack(() => {
      const controller = new AbortController();
      const shouldStreamDockerLogs =
        tab === 'logs' && containerId !== null && runtime !== 'kubernetes' && !replayActive;

      if (shouldStreamDockerLogs) {
        subscribeLogs(containerId, host);
      } else {
        unsubscribeLogs();
      }

      if (
        tab === 'logs' &&
        runtime === 'kubernetes' &&
        kind === 'pod' &&
        containerId &&
        !replayActive
      ) {
        kubernetesLogs = '';
        getKubernetesPodLogs(containerId, 300, { signal: controller.signal })
          .then((logs) => {
            if (!controller.signal.aborted) {
              kubernetesLogs = logs;
            }
          })
          .catch((error) => {
            if (!isAbortError(error) && !controller.signal.aborted) {
              kubernetesLogs = '';
            }
          });
      }

      return () => {
        controller.abort();
        if (shouldStreamDockerLogs) {
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
      {actionPending}
      hideActions={docker.replayMode}
      {onClose}
      onDirect={doAction}
      onConfirmAction={openConfirm}
      onHpaDialog={() => showHpaReplicaDialog(node)}
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
        {#if !isKubernetesNode}
          <button
            class="tab {activeTab === 'env' ? 'active' : ''}"
            onclick={() => (activeTab = 'env')}>Env</button
          >
          <button
            class="tab {activeTab === 'logs' ? 'active' : ''}"
            onclick={() => (activeTab = 'logs')}>Logs</button
          >
        {:else if node.kind === 'pod'}
          <button
            class="tab {activeTab === 'logs' ? 'active' : ''}"
            onclick={() => (activeTab = 'logs')}>Logs</button
          >
        {/if}
        {#if !isKubernetesNode && (node.status === 'running' || node.status === 'paused')}
          <button
            class="tab {activeTab === 'top' ? 'active' : ''}"
            onclick={() => (activeTab = 'top')}>Top</button
          >
        {/if}
        {#if !isKubernetesNode}
          <button
            class="tab {activeTab === 'diff' ? 'active' : ''}"
            onclick={() => (activeTab = 'diff')}>Diff</button
          >
        {/if}
        {#if !isKubernetesNode && node.status === 'running'}
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
        logs={isKubernetesNode ? kubernetesLogs : undefined}
        placeholder={isKubernetesNode ? 'Loading pod logs...' : 'Connecting to log stream...'}
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

{#if hpaDialog}
  <HpaReplicaDialog
    resourceName={hpaDialog.node.fullName}
    initialMin={hpaDialog.min}
    initialMax={hpaDialog.max}
    onConfirm={({ minReplicas, maxReplicas }) => {
      const target = hpaDialog?.node;
      hpaDialog = null;
      if (target) {
        doKubernetesAction('set_hpa_constraints', { minReplicas, maxReplicas }, target);
      }
    }}
    onCancel={() => {
      hpaDialog = null;
    }}
  />
{/if}

{#if confirmDialog}
  <ConfirmDialog
    title={confirmDialog.title}
    message={confirmDialog.message}
    confirmLabel={confirmDialog.confirmLabel}
    variant={confirmDialog.variant}
    typeToConfirm={confirmDialog.typeToConfirm}
    onConfirm={() => {
      confirmDialog?.action();
      confirmDialog = null;
    }}
    onCancel={() => {
      confirmDialog = null;
    }}
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
