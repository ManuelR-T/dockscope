<script lang="ts">
  import {
    cycleSpeed,
    exitReplay,
    getRecorderState,
    seek,
    togglePlay,
  } from '../stores/recorder.svelte';
  import { formatClock } from '../lib/recording';
  import Icon from './Icon.svelte';
  import { IconButton } from './ui';

  const rec = getRecorderState();

  const MAX_MARKERS = 150;

  // Timeline tick marks for recorded Docker events (sampled if very dense)
  let eventMarkers = $derived.by(() => {
    const recording = rec.recording;
    if (!recording || recording.duration === 0) {
      return [] as number[];
    }
    const times = recording.frames.filter((f) => f.msg.type === 'event').map((f) => f.t);
    const step = Math.max(1, Math.ceil(times.length / MAX_MARKERS));
    return times.filter((_, i) => i % step === 0).map((t) => (t / recording.duration) * 100);
  });

  function onSeekInput(e: Event) {
    seek(Number((e.target as HTMLInputElement).value));
  }
</script>

{#if rec.replaying}
  <div class="replay-bar">
    <span class="replay-badge"><span class="replay-dot"></span>REPLAY</span>

    <IconButton
      variant="accent"
      title={rec.playing ? 'Pause (Space)' : 'Play (Space)'}
      onclick={togglePlay}
    >
      {#if rec.playing}
        <Icon name="pause" size={12} />
      {:else}
        <Icon name="play" size={12} />
      {/if}
    </IconButton>

    <span class="replay-time">{formatClock(rec.position)} / {formatClock(rec.duration)}</span>

    <div class="replay-track">
      {#each eventMarkers as pct}
        <span class="event-marker" style="left: {pct}%"></span>
      {/each}
      <input
        class="replay-slider"
        type="range"
        min="0"
        max={rec.duration}
        step="100"
        value={rec.position}
        oninput={onSeekInput}
      />
      <div
        class="track-fill"
        style="width: {rec.duration ? (rec.position / rec.duration) * 100 : 0}%"
      ></div>
    </div>

    <IconButton variant="accent" size={32} title="Playback speed" onclick={cycleSpeed}>
      <span class="replay-speed">{rec.speed}&times;</span>
    </IconButton>

    <IconButton variant="accent" glyphSize={14} title="Exit replay" onclick={exitReplay}>
      &times;
    </IconButton>
  </div>
{/if}

<style>
  .replay-bar {
    position: fixed;
    left: 50%;
    bottom: calc(var(--statusbar-h, 230px) + 20px);
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: rgba(8, 10, 24, 0.88);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 43, 78, 0.35);
    border-radius: 8px;
    z-index: 90;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }
  .replay-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 2px;
    color: #ff2b4e;
    font-family: var(--font-mono);
  }
  .replay-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #ff2b4e;
    animation: replay-pulse 1.2s ease-in-out infinite;
  }
  @keyframes replay-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
  .replay-time {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-secondary, #7a8599);
    min-width: 84px;
    text-align: center;
  }
  .replay-track {
    position: relative;
    width: 320px;
    height: 16px;
    display: flex;
    align-items: center;
  }
  .event-marker {
    position: absolute;
    top: 2px;
    width: 2px;
    height: 4px;
    background: rgba(255, 138, 43, 0.7);
    pointer-events: none;
    z-index: 2;
  }
  .track-fill {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    height: 3px;
    background: #ff2b4e;
    border-radius: 2px;
    pointer-events: none;
    z-index: 1;
  }
  .replay-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 3px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
    z-index: 3;
    position: relative;
  }
  .replay-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #ff2b4e;
    border: 2px solid rgba(8, 10, 24, 0.9);
    cursor: grab;
  }
  .replay-slider::-moz-range-thumb {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #ff2b4e;
    border: 2px solid rgba(8, 10, 24, 0.9);
    cursor: grab;
  }
  .replay-speed {
    font-weight: 600;
    font-size: var(--text-base);
  }
</style>
