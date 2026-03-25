<script lang="ts">
  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const shortcuts = [
    { key: '/', desc: 'Search containers' },
    { key: 'Esc', desc: 'Close panel / Clear search' },
    { key: 'F', desc: 'Zoom to fit' },
    { key: 'R', desc: 'Reset camera' },
    { key: '?', desc: 'Toggle this help' },
  ];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="kbd-overlay" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="kbd-panel" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="kbd-title">Keyboard Shortcuts</div>
    {#each shortcuts as s}
      <div class="kbd-row">
        <kbd>{s.key}</kbd>
        <span>{s.desc}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .kbd-overlay {
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

  .kbd-panel {
    background: rgba(8, 10, 24, 0.95);
    border: 1px solid rgba(0, 228, 255, 0.12);
    border-radius: 12px;
    padding: 24px 32px;
    min-width: 280px;
    backdrop-filter: blur(20px);
  }

  .kbd-title {
    font-family: 'Chakra Petch', sans-serif;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: rgba(0, 228, 255, 0.8);
    margin-bottom: 16px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .kbd-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 6px 0;
    font-size: 13px;
    color: rgba(122, 133, 153, 1);
  }

  kbd {
    font-family: 'Fira Code', monospace;
    font-size: 11px;
    padding: 3px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: #e2e8f0;
    min-width: 28px;
    text-align: center;
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
