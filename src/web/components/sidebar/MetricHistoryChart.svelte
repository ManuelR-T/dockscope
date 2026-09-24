<script lang="ts">
  import type { MetricPoint } from '../../../types';
  let {
    points,
    metric,
    label,
    color,
    start,
    end,
    gap,
    format,
  }: {
    points: MetricPoint[];
    metric: 'cpu' | 'memory';
    label: string;
    color: string;
    start: number;
    end: number;
    gap: number;
    format: (value: number) => string;
  } = $props();
  const id = $props.id();
  let peak = $derived(Math.max(0, ...points.map((p) => p[metric])));
  let max = $derived(Math.max(peak, 1));
  let latest = $derived(points.at(-1));
  const x = (time: number) => 4 + Math.max(0, Math.min(1, (time - start) / (end - start))) * 292;
  const y = (value: number) => 82 - (value / max) * 68;
  let segments = $derived.by(() => {
    const groups: MetricPoint[][] = [];
    for (const point of points) {
      const previous = groups.at(-1);
      if (!previous || point.time - previous[previous.length - 1].time > gap) {
        groups.push([point]);
      } else {
        previous.push(point);
      }
    }
    return groups.map((group) => ({
      line: group
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.time).toFixed(1)},${y(p[metric]).toFixed(1)}`)
        .join(' '),
      first: group[0],
      last: group[group.length - 1],
    }));
  });
</script>

<div class="history-chart" style:--chart-color={color}>
  <div class="chart-heading">
    <span class="chart-label"><span class="metric-dot"></span>{label}</span>
    <span class="peak">Peak <strong>{format(peak)}</strong></span>
  </div>
  <div class="chart-value">
    <strong>{latest ? format(latest[metric]) : '—'}</strong>
    <span title={latest ? new Date(latest.time).toLocaleString() : undefined}>Latest sample</span>
  </div>
  <svg
    viewBox="0 0 300 88"
    preserveAspectRatio="none"
    role="img"
    aria-label={`${label} history, peak ${format(peak)}`}
  >
    <defs>
      <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color={color} stop-opacity="0.22" />
        <stop offset="100%" stop-color={color} stop-opacity="0.01" />
      </linearGradient>
    </defs>
    {#each [14, 48, 82] as line}
      <line
        x1="4"
        x2="296"
        y1={line}
        y2={line}
        class="grid-line"
        vector-effect="non-scaling-stroke"
      />
    {/each}
    {#each segments as segment}
      <path
        d={`${segment.line} L${x(segment.last.time)},82 L${x(segment.first.time)},82 Z`}
        fill={`url(#${id}-fill)`}
      />
      <path
        d={segment.line}
        fill="none"
        stroke={color}
        stroke-width="1.7"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
      <circle cx={x(segment.last.time)} cy={y(segment.last[metric])} r="2.3" fill={color}>
        <title>{new Date(segment.last.time).toLocaleString()}: {format(segment.last[metric])}</title
        >
      </circle>
    {/each}
  </svg>
  <div class="chart-scale"><span>0</span><span>Scale · {format(max)}</span></div>
</div>

<style>
  .history-chart {
    margin-top: 10px;
    padding: 12px 12px 8px;
    border: 1px solid var(--border-control);
    border-radius: 10px;
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--chart-color) 4%, transparent),
        transparent 70%
      ),
      var(--bg-inset);
  }
  .chart-heading,
  .chart-label,
  .chart-value,
  .chart-scale {
    display: flex;
    align-items: center;
  }
  .chart-heading,
  .chart-scale {
    justify-content: space-between;
  }
  .chart-label {
    gap: 7px;
    font-size: var(--text-sm);
    color: var(--text-primary);
  }
  .metric-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--chart-color);
  }
  .peak,
  .chart-value span,
  .chart-scale {
    font-size: var(--text-xs);
    color: var(--text-dim);
  }
  .peak strong {
    font-weight: 400;
    color: var(--text-secondary);
    margin-left: 4px;
  }
  .chart-value {
    gap: 8px;
    margin-top: 8px;
    align-items: baseline;
  }
  .chart-value > strong {
    font-size: 23px;
    font-weight: 500;
    letter-spacing: -0.7px;
    color: var(--chart-color);
    font-variant-numeric: tabular-nums;
  }
  svg {
    display: block;
    width: 100%;
    height: 88px;
    margin-top: 4px;
    overflow: visible;
  }
  .grid-line {
    stroke: var(--border-control);
    stroke-dasharray: 3 4;
  }
  .chart-scale {
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
</style>
