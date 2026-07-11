import type { EntityRef } from './operations.js';

export type MetricAnalysisId = 'cpu' | 'memory';

export interface MetricAnalysisSample {
  ref: EntityRef;
  metric: MetricAnalysisId;
  value: number;
  history: number[];
}

export interface MetricAnalysisResult {
  average: number;
  threshold: number;
  severity?: 'info' | 'warning' | 'critical';
  message?: string;
}

export interface MetricAnalysisFinding extends MetricAnalysisResult {
  pluginId: string;
  metric: MetricAnalysisId;
  value: number;
}

export interface MetricAnalysisProvider {
  canHandle(ref: EntityRef): boolean | Promise<boolean>;
  analyze(
    sample: MetricAnalysisSample,
  ): MetricAnalysisResult | null | Promise<MetricAnalysisResult | null>;
}

export class MetricAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetricAnalysisError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateMetricAnalysisResult(raw: unknown): MetricAnalysisResult | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (
    !isRecord(raw) ||
    typeof raw.average !== 'number' ||
    !Number.isFinite(raw.average) ||
    typeof raw.threshold !== 'number' ||
    !Number.isFinite(raw.threshold)
  ) {
    throw new MetricAnalysisError('Metric analysis result requires finite average and threshold');
  }
  if (
    raw.severity !== undefined &&
    raw.severity !== 'info' &&
    raw.severity !== 'warning' &&
    raw.severity !== 'critical'
  ) {
    throw new MetricAnalysisError('Metric analysis result has an invalid severity');
  }
  if (raw.message !== undefined && (typeof raw.message !== 'string' || !raw.message.trim())) {
    throw new MetricAnalysisError('Metric analysis result message must be a non-empty string');
  }
  return {
    average: raw.average,
    threshold: raw.threshold,
    severity: raw.severity,
    message: raw.message,
  };
}
