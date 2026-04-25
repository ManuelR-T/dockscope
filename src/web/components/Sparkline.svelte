<script lang="ts">
  interface Props {
    data: number[];
    color: string;
    width?: number;
    height?: number;
    label?: string;
  }

  let { data, color, width = 200, height = 32, label = '' }: Props = $props();

  let path = $derived.by(() => {
    if (data.length < 2) {
      return '';
    }
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const stepX = width / (data.length - 1);
    const padY = 2;
    const h = height - padY * 2;

    return data
      .map((v, i) => {
        const x = i * stepX;
        const y = padY + h - ((v - min) / range) * h;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });

  let areaPath = $derived.by(() => {
    if (!path) {
      return '';
    }
    const stepX = width / (data.length - 1);
    return `${path} L${((data.length - 1) * stepX).toFixed(1)},${height} L0,${height} Z`;
  });

  let lastValue = $derived(data.length > 0 ? data[data.length - 1] : 0);
  let lastPos = $derived.by(() => {
    if (data.length < 2) {
      return { x: 0, y: height / 2 };
    }
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const padY = 2;
    const h = height - padY * 2;
    return {
      x: width,
      y: padY + h - ((lastValue - min) / range) * h,
    };
  });

  const gradientId = `spark-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="sparkline-container">
  {#if label}
    <span class="sparkline-label">{label}</span>
  {/if}
  <svg {width} {height} viewBox="0 0 {width} {height}" class="sparkline-svg">
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
      <text x={width / 2} y={height / 2 + 4} text-anchor="middle" fill="#3e4a5c" font-size="9">
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
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #3e4a5c;
  }

  .sparkline-svg {
    display: block;
  }
</style>
