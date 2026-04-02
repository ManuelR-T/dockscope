import { describe, it, expect } from 'vitest';
import { percentile, checkAnomaly, ANOMALY_MIN_SAMPLES } from '../anomaly';

describe('percentile', () => {
  it('returns exact value for single element', () => {
    expect(percentile([42], 0.5)).toBe(42);
  });

  it('returns min/max for p=0/p=1', () => {
    const sorted = [1, 2, 3, 4, 5];
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile(sorted, 1)).toBe(5);
  });

  it('interpolates median for even-length array', () => {
    const sorted = [1, 2, 3, 4];
    expect(percentile(sorted, 0.5)).toBe(2.5);
  });

  it('computes Q1 and Q3', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const q1 = percentile(sorted, 0.25);
    const q3 = percentile(sorted, 0.75);
    expect(q1).toBeCloseTo(3.25);
    expect(q3).toBeCloseTo(7.75);
  });
});

describe('checkAnomaly', () => {
  function makeHistory(values: number[]): number[] {
    return values;
  }

  it('returns null with insufficient samples', () => {
    const history = makeHistory(Array(ANOMALY_MIN_SAMPLES - 1).fill(50));
    expect(checkAnomaly('cpu', 95, history)).toBeNull();
  });

  it('returns null for values below minimum absolute threshold', () => {
    // CPU min is 70, memory min is 75
    const history = makeHistory(Array(ANOMALY_MIN_SAMPLES).fill(10));
    expect(checkAnomaly('cpu', 60, history)).toBeNull();
    expect(checkAnomaly('memory', 50, history)).toBeNull();
  });

  it('returns null for values > 1000 (raw bytes sanity guard)', () => {
    const history = makeHistory(Array(ANOMALY_MIN_SAMPLES).fill(500000));
    expect(checkAnomaly('memory', 113999872, history)).toBeNull();
  });

  it('detects a CPU spike above IQR threshold', () => {
    // Baseline: stable around 20%, then spike to 95%
    const history = makeHistory(Array(ANOMALY_MIN_SAMPLES).fill(20));
    const result = checkAnomaly('cpu', 95, history);
    expect(result).not.toBeNull();
    expect(result!.median).toBe(20);
    expect(result!.threshold).toBeGreaterThan(20);
  });

  it('does not flag normal variation', () => {
    // Values fluctuating 70-80%, current at 80% — normal
    const history = makeHistory(
      Array.from({ length: ANOMALY_MIN_SAMPLES }, (_, i) => 70 + (i % 10)),
    );
    expect(checkAnomaly('cpu', 80, history)).toBeNull();
  });

  it('handles bursty workloads without false positives', () => {
    // Simulate DB-like pattern: alternating 10% and 75%
    const history = makeHistory(
      Array.from({ length: ANOMALY_MIN_SAMPLES }, (_, i) => (i % 2 === 0 ? 10 : 75)),
    );
    // 75% is within the normal burst range — should NOT trigger
    expect(checkAnomaly('cpu', 75, history)).toBeNull();
  });

  it('flags extreme spike well above bursty range', () => {
    // Bursty: 10-75%, IQR=65, threshold=75+2.5*65=237.5 — need >237 to trigger
    // Use tighter bursts: 70-75%, so IQR is small
    const history = makeHistory(
      Array.from({ length: ANOMALY_MIN_SAMPLES }, (_, i) => (i % 2 === 0 ? 70 : 75)),
    );
    const result = checkAnomaly('cpu', 99, history);
    expect(result).not.toBeNull();
  });

  it('returns null for uniform data (IQR near zero) with normal value', () => {
    // All values at 80%, current at 80%
    const history = makeHistory(Array(ANOMALY_MIN_SAMPLES).fill(80));
    expect(checkAnomaly('cpu', 80, history)).toBeNull();
  });

  it('uses median * 2 fallback for uniform data with spike', () => {
    // All values at 40%, spike to 95%
    const history = makeHistory(Array(ANOMALY_MIN_SAMPLES).fill(40));
    const result = checkAnomaly('cpu', 95, history);
    expect(result).not.toBeNull();
    expect(result!.threshold).toBe(80); // median(40) * 2
  });
});
