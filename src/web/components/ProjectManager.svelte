<script lang="ts">
  import { onMount } from 'svelte';
  import { addToast } from '../stores/toast.svelte';
  import { Button, CloseButton } from './ui';

  import type { ProjectSummary } from '../../core/entities/operations';
  import { allowsUiIntent, type AccessRole } from '../../core/access';

  interface Props {
    onClose: () => void;
    role: AccessRole | null;
  }

  let { onClose, role }: Props = $props();
  let canOperate = $derived(allowsUiIntent(role, 'mutation'));

  let projects = $state<ProjectSummary[]>([]);
  let loading = $state(true);
  let pendingAction = $state<string | null>(null);

  onMount(() => {
    fetchProjects();
  });

  async function fetchProjects() {
    loading = true;
    try {
      const res = await fetch('/api/projects');
      projects = await res.json();
    } catch {
      projects = [];
    } finally {
      loading = false;
    }
  }

  function projectKey(project: ProjectSummary): string {
    return `${project.pluginId ?? ''}:${project.providerId ?? ''}:${project.name}`;
  }

  async function doAction(project: ProjectSummary, action: string) {
    if (!canOperate) {
      return;
    }
    const key = projectKey(project);
    pendingAction = `${key}:${action}`;
    try {
      const query = new URLSearchParams();
      if (project.pluginId) {
        query.set('pluginId', project.pluginId);
      }
      if (project.providerId) {
        query.set('providerId', project.providerId);
      }
      const suffix = query.size > 0 ? `?${query}` : '';
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project.name)}/${action}${suffix}`,
        {
          method: 'POST',
        },
      );
      if (res.ok) {
        addToast(`${project.name}: ${action} done`, 'success');
        // Refresh after a short delay for Docker to update
        setTimeout(fetchProjects, 1500);
      } else {
        const err = await res.json();
        addToast(`${project.name}: ${err.error}`, 'error');
      }
    } catch {
      addToast(`${project.name}: ${action} failed`, 'error');
    } finally {
      pendingAction = null;
    }
  }

  function isPending(project: ProjectSummary, action: string): boolean {
    return pendingAction === `${projectKey(project)}:${action}`;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pm-overlay" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="pm-panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="pm-header">
      <span class="pm-title">Compose Projects</span>
      <CloseButton label="Close compose projects" onclick={onClose} />
    </div>

    {#if loading}
      <div class="pm-loading">Loading projects...</div>
    {:else if projects.length === 0}
      <div class="pm-empty">No compose projects found</div>
    {:else}
      <div class="pm-list">
        {#each projects as project}
          <div class="pm-project">
            <div class="pm-project-info">
              <span class="pm-project-name">{project.name}</span>
              <span class="pm-project-counts">
                {#if project.running > 0}
                  <span class="pm-count running">{project.running} up</span>
                {/if}
                {#if project.stopped > 0}
                  <span class="pm-count stopped">{project.stopped} down</span>
                {/if}
              </span>
            </div>
            {#if canOperate}
              <div class="pm-actions">
                {#if project.running === 0 && project.stopped === 0}
                  <!-- Cached project (after down) — can only Up or Destroy -->
                  <Button
                    size="sm"
                    tone="success"
                    disabled={!!pendingAction}
                    onclick={() => doAction(project, 'up')}
                    title="Up (start all)"
                  >
                    {isPending(project, 'up') ? '...' : 'Up'}
                  </Button>
                {:else if project.running === 0}
                  <!-- All stopped — can Up or Down -->
                  <Button
                    size="sm"
                    tone="success"
                    disabled={!!pendingAction}
                    onclick={() => doAction(project, 'up')}
                    title="Up (start all)"
                  >
                    {isPending(project, 'up') ? '...' : 'Up'}
                  </Button>
                  <Button
                    size="sm"
                    tone="danger"
                    disabled={!!pendingAction}
                    onclick={() => doAction(project, 'down')}
                    title="Down (remove containers)"
                  >
                    {isPending(project, 'down') ? '...' : 'Down'}
                  </Button>
                {:else}
                  <!-- Running — full control -->
                  <Button
                    size="sm"
                    tone="accent"
                    disabled={!!pendingAction}
                    onclick={() => doAction(project, 'restart')}
                    title="Restart all"
                  >
                    {isPending(project, 'restart') ? '...' : 'Restart'}
                  </Button>
                  <Button
                    size="sm"
                    tone="warn"
                    disabled={!!pendingAction}
                    onclick={() => doAction(project, 'stop')}
                    title="Stop all"
                  >
                    {isPending(project, 'stop') ? '...' : 'Stop'}
                  </Button>
                  <Button
                    size="sm"
                    tone="danger"
                    disabled={!!pendingAction}
                    onclick={() => doAction(project, 'down')}
                    title="Down (remove containers)"
                  >
                    {isPending(project, 'down') ? '...' : 'Down'}
                  </Button>
                {/if}
                <!-- Destroy always available — removes containers, volumes, orphans, and cache -->
                <Button
                  size="sm"
                  tone="danger"
                  disabled={!!pendingAction}
                  onclick={() => doAction(project, 'destroy')}
                  title="Destroy (remove containers + volumes)"
                >
                  {isPending(project, 'destroy') ? '...' : 'Destroy'}
                </Button>
              </div>
            {:else}
              <span class="pm-read-only" title="Operator access is required for project actions">
                Read-only
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .pm-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(4, 4, 14, 0.6);
    backdrop-filter: blur(4px);
    animation: fadeIn 0.15s ease-out;
  }

  .pm-panel {
    background: rgba(8, 10, 24, 0.95);
    border: 1px solid rgba(0, 228, 255, 0.12);
    border-radius: 12px;
    min-width: 380px;
    max-width: 500px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    backdrop-filter: blur(20px);
  }

  .pm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .pm-title {
    font-family: 'Chakra Petch', sans-serif;
    font-size: var(--text-lg);
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: rgba(0, 228, 255, 0.8);
  }

  .pm-loading,
  .pm-empty {
    padding: 24px;
    text-align: center;
    color: #3e4a5c;
    font-size: var(--text-md);
    font-style: italic;
  }

  .pm-list {
    overflow-y: auto;
    padding: 8px 0;
  }

  .pm-project {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 18px;
    gap: 12px;
    transition: background 0.15s;
  }

  .pm-project:hover {
    background: rgba(0, 228, 255, 0.02);
  }

  .pm-project-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .pm-project-name {
    font-family: 'Fira Code', monospace;
    font-size: var(--text-lg);
    font-weight: 500;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pm-project-counts {
    display: flex;
    gap: 8px;
  }

  .pm-count {
    font-size: var(--text-sm);
    font-weight: 500;
    letter-spacing: 0.3px;
  }

  .pm-count.running {
    color: #00ff6a;
  }
  .pm-count.stopped {
    color: #3e4a5c;
  }

  .pm-actions {
    display: flex;
    gap: 5px;
    flex-shrink: 0;
  }

  .pm-read-only {
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
