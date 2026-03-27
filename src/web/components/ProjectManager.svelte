<script lang="ts">
  import { onMount } from 'svelte';
  import { addToast } from '../stores/toast.svelte';

  interface Project {
    name: string;
    running: number;
    stopped: number;
  }

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let projects = $state<Project[]>([]);
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

  async function doAction(project: string, action: string) {
    pendingAction = `${project}:${action}`;
    try {
      const res = await fetch(`/api/projects/${project}/${action}`, { method: 'POST' });
      if (res.ok) {
        addToast(`${project}: ${action} done`, 'success');
        // Refresh after a short delay for Docker to update
        setTimeout(fetchProjects, 1500);
      } else {
        const err = await res.json();
        addToast(`${project}: ${err.error}`, 'error');
      }
    } catch {
      addToast(`${project}: ${action} failed`, 'error');
    } finally {
      pendingAction = null;
    }
  }

  function isPending(project: string, action: string): boolean {
    return pendingAction === `${project}:${action}`;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pm-overlay" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="pm-panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="pm-header">
      <span class="pm-title">Compose Projects</span>
      <button class="pm-close" onclick={onClose}>&times;</button>
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
            <div class="pm-actions">
              {#if project.running === 0 && project.stopped === 0}
                <!-- Cached project (after down) — can only Up or Destroy -->
                <button class="pm-btn up" disabled={!!pendingAction} onclick={() => doAction(project.name, 'up')} title="Up (start all)">
                  {isPending(project.name, 'up') ? '...' : 'Up'}
                </button>
              {:else if project.running === 0}
                <!-- All stopped — can Up or Down -->
                <button class="pm-btn up" disabled={!!pendingAction} onclick={() => doAction(project.name, 'up')} title="Up (start all)">
                  {isPending(project.name, 'up') ? '...' : 'Up'}
                </button>
                <button class="pm-btn down" disabled={!!pendingAction} onclick={() => doAction(project.name, 'down')} title="Down (remove containers)">
                  {isPending(project.name, 'down') ? '...' : 'Down'}
                </button>
              {:else}
                <!-- Running — full control -->
                <button class="pm-btn restart" disabled={!!pendingAction} onclick={() => doAction(project.name, 'restart')} title="Restart all">
                  {isPending(project.name, 'restart') ? '...' : 'Restart'}
                </button>
                <button class="pm-btn stop" disabled={!!pendingAction} onclick={() => doAction(project.name, 'stop')} title="Stop all">
                  {isPending(project.name, 'stop') ? '...' : 'Stop'}
                </button>
                <button class="pm-btn down" disabled={!!pendingAction} onclick={() => doAction(project.name, 'down')} title="Down (remove containers)">
                  {isPending(project.name, 'down') ? '...' : 'Down'}
                </button>
              {/if}
              <!-- Destroy always available — removes containers, volumes, orphans, and cache -->
              <button class="pm-btn destroy" disabled={!!pendingAction} onclick={() => doAction(project.name, 'destroy')} title="Destroy (remove containers + volumes)">
                {isPending(project.name, 'destroy') ? '...' : 'Destroy'}
              </button>
            </div>
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
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: rgba(0, 228, 255, 0.8);
  }

  .pm-close {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.04);
    color: #3e4a5c;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .pm-close:hover {
    color: #e2e8f0;
    border-color: rgba(0, 228, 255, 0.1);
  }

  .pm-loading,
  .pm-empty {
    padding: 24px;
    text-align: center;
    color: #3e4a5c;
    font-size: 12px;
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
    font-size: 13px;
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
    font-size: 10px;
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

  .pm-btn {
    font-family: 'Chakra Petch', sans-serif;
    font-size: 10px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid;
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: 0.3px;
  }

  .pm-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .pm-btn.up {
    color: #00ff6a;
    border-color: rgba(0, 255, 106, 0.15);
    background: rgba(0, 255, 106, 0.06);
  }
  .pm-btn.up:hover:not(:disabled) {
    background: rgba(0, 255, 106, 0.14);
  }

  .pm-btn.restart {
    color: #00e4ff;
    border-color: rgba(0, 228, 255, 0.15);
    background: rgba(0, 228, 255, 0.06);
  }
  .pm-btn.restart:hover:not(:disabled) {
    background: rgba(0, 228, 255, 0.14);
  }

  .pm-btn.stop {
    color: #ff8a2b;
    border-color: rgba(255, 138, 43, 0.15);
    background: rgba(255, 138, 43, 0.06);
  }
  .pm-btn.stop:hover:not(:disabled) {
    background: rgba(255, 138, 43, 0.14);
  }

  .pm-btn.down {
    color: #ff2b4e;
    border-color: rgba(255, 43, 78, 0.15);
    background: rgba(255, 43, 78, 0.06);
  }
  .pm-btn.down:hover:not(:disabled) {
    background: rgba(255, 43, 78, 0.14);
  }

  .pm-btn.destroy {
    color: #ff2b4e;
    border-color: rgba(255, 43, 78, 0.25);
    background: rgba(255, 43, 78, 0.1);
    font-weight: 700;
  }
  .pm-btn.destroy:hover:not(:disabled) {
    background: rgba(255, 43, 78, 0.2);
    box-shadow: 0 0 8px rgba(255, 43, 78, 0.15);
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
