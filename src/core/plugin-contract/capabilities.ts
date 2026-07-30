export const PLUGIN_CAPABILITIES = [
  'source.graph',
  'source.metrics',
  'source.events',
  'source.logs',
  'source.inspect',
  'source.inventory',
  'source.relationships',
  'source.system',
  'source.connections',
  'action.lifecycle',
  'action.exec',
  'action.filesystem',
  'action.deploy',
  'action.scale',
  'action.remediate',
  'analysis.diagnostics',
  'analysis.anomalies',
  'analysis.health',
  'analysis.policy',
  'analysis.cost',
  'analysis.recommendations',
  'ui.nodePanel',
  'ui.nodeAction',
  'ui.sidebarPanel',
  'ui.navigation',
  'ui.graphOverlay',
  'ui.toolbarAction',
  'ui.settings',
  'ui.command',
  'ui.frontend',
  'integration.export',
  'integration.import',
  'integration.webhook',
  'integration.search',
  'integration.alerts',
] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

const PLUGIN_CAPABILITY_SET = new Set<string>(PLUGIN_CAPABILITIES);

export function isPluginCapability(value: unknown): value is PluginCapability {
  return typeof value === 'string' && PLUGIN_CAPABILITY_SET.has(value);
}

export const PLUGIN_PERMISSIONS = [
  'docker.socket',
  'kubernetes.api',
  'network.local',
  'network.http',
  'filesystem.read',
  'filesystem.write',
  'process.exec',
  'secrets.read',
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

const PLUGIN_PERMISSION_SET = new Set<string>(PLUGIN_PERMISSIONS);

export function isPluginPermission(value: unknown): value is PluginPermission {
  return typeof value === 'string' && PLUGIN_PERMISSION_SET.has(value);
}
