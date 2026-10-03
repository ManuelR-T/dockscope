/** Public selection schema shared by the settings API and dashboard. */
export const WEBHOOK_EVENTS = [
  { value: 'cpu', label: 'CPU anomalies' },
  { value: 'memory', label: 'Memory anomalies' },
  { value: 'crash', label: 'Crash diagnostics' },
  { value: 'health', label: 'Health changes' },
  { value: 'lifecycle', label: 'Workload lifecycle' },
  { value: 'connectivity', label: 'Source connectivity' },
  { value: 'recovery', label: 'Anomaly recovery' },
] as const;
export type WebhookEventFamily = (typeof WEBHOOK_EVENTS)[number]['value'];
export const DEFAULT_WEBHOOK_EVENTS: WebhookEventFamily[] = ['cpu', 'memory', 'crash'];
export interface WebhookScope {
  sources: string[];
  projects: { sourceId: string; project: string }[];
  workloads: { sourceId: string; entityId: string }[];
}
export interface WebhookSelection {
  events: WebhookEventFamily[];
  scope: WebhookScope;
}
export function defaultWebhookScope(): WebhookScope {
  return { sources: [], projects: [], workloads: [] };
}
