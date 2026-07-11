import type { DockscopePlugin } from '../core/plugins.js';
import type { MetricAnalysisProvider } from '../core/plugin-analysis.js';
import { checkAnomaly } from './anomaly.js';

const anomalyProvider: MetricAnalysisProvider = {
  canHandle: () => true,
  analyze(sample) {
    const result = checkAnomaly(sample.metric, sample.value, sample.history);
    return result
      ? {
          average: result.median,
          threshold: result.threshold,
          severity: 'warning',
        }
      : null;
  },
};

export function createAnomalyPlugin(): DockscopePlugin {
  return {
    manifest: {
      id: 'core.anomaly',
      name: 'Anomaly Analysis',
      version: '1.0.0',
      manifestVersion: '1',
      dockscopeApiVersion: '1',
      hostApiVersion: '1',
      description: 'Built-in metric anomaly analysis provider.',
      builtin: true,
      capabilities: ['analysis.anomalies'],
      permissions: [],
    },
    getMetricAnalysisProviders: () => [anomalyProvider],
  };
}
