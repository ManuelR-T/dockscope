import type { Anomaly } from '../types.js';

export const ANOMALY_IQR_FACTOR = 2.5;
export const ANOMALY_MIN_SAMPLES = 20;
export const ANOMALY_MIN_ABS: Record<string, number> = { cpu: 70, memory: 75 };

export function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Detect whether a metric value is anomalous using IQR-based outlier detection.
 * Returns an Anomaly if the value exceeds Q3 + factor * IQR, or null.
 * Stateless — caller manages deduplication.
 */
export function checkAnomaly(
  metric: 'cpu' | 'memory',
  value: number,
  history: number[],
): { median: number; threshold: number } | null {
  if (history.length < ANOMALY_MIN_SAMPLES) return null;
  if (value > 1000) return null; // Sanity: not a percentage
  if (value < (ANOMALY_MIN_ABS[metric] || 0)) return null;

  const sorted = [...history].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  const median = percentile(sorted, 0.5);
  const threshold = iqr > 1 ? q3 + ANOMALY_IQR_FACTOR * iqr : median * 2;

  return value > threshold ? { median, threshold } : null;
}
