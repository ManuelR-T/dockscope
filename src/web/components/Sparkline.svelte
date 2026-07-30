<script lang="ts">
  interface Props {
    data: number[];
    color: string;
    width?: number;
    height?: number;
    label?: string;
    /** Track the container width instead of using a fixed one. The box is
        measured rather than scaled, so the line keeps its real aspect and the
        end marker stays a circle. */
    fluid?: boolean;
  }

  let { data, color, width = 200, height = 32, label = '', fluid = false }: Props = $props();

  /* Inset so the 1.5px stroke and the 2.5px end marker sit inside the viewBox.
     Drawing the last point at x = w put half the marker outside it, which is
     what clipped the right edge. */
  const PAD_X = 4;
  const PAD_Y = 3;

  let host = $state<HTMLDivElement | null>(null);
  let measured = $state(0);

  $effect(() => {
    if (!fluid || !host) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      measured = Math.floor(entries[0].contentRect.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  });

  let w = $derived(fluid && measured > 0 ? measured : width);

  let scale = $derived.by(() => {
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const inner = height - PAD_Y * 2;
    const stepX = data.length > 1 ? (w - PAD_X * 2) / (data.length - 1) : 0;
    return {
      x: (i: number) => PAD_X + i * stepX,
      y: (v: number) => PAD_Y + inner - ((v - min) / range) * inner,
    };
  });

  let path = $derived.by(() => {
    if (data.length < 2) {
      return '';
    }
    return data
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${scale.x(i).toFixed(1)},${scale.y(v).toFixed(1)}`)
      .join(' ');
  });

  let areaPath = $derived.by(() => {
    if (!path) {
      return '';
    }
    const right = scale.x(data.length - 1).toFixed(1);
    return `${path} L${right},${height} L${PAD_X},${height} Z`;
  });

  let lastPos = $derived.by(() => {
    if (data.length < 2) {
      return { x: PAD_X, y: height / 2 };
    }
    return { x: scale.x(data.length - 1), y: scale.y(data[data.length - 1]) };
  });

  const gradientId = `spark-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="sparkline-container" bind:this={host}>
  {#if label}
    <span class="sparkline-label">{label}</span>
  {/if}
  <svg width={w} {height} viewBox="0 0 {w} {height}" class="sparkline-svg">
    <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color={color} stop-opacity="0.15" />
        <stop offset="100%" stop-color={color} stop-opacity="0" />
      </linearGradient>
    </defs>
    {#if data.length >= 2}
      <path d={areaPath} fill="url(#{gradientId})" />
      <path
        d={path}
        fill="none"
        stroke={color}
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx={lastPos.x} cy={lastPos.y} r="2.5" fill={color} />
    {:else}
      <text x={w / 2} y={height / 2 + 4} text-anchor="middle" fill="#3e4a5c" font-size="9">
        collecting...
      </text>
    {/if}
  </svg>
</div>

<style>
  .sparkline-container {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .sparkline-label {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #3e4a5c;
  }

  .sparkline-svg {
    display: block;
  }
</style>
