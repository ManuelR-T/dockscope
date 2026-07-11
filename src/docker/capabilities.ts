import type { PluginCapability } from '../core/capabilities.js';

export const DOCKER_SOURCE_CAPABILITIES = [
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
  'analysis.diagnostics',
] as const satisfies readonly PluginCapability[];
