import type { PluginCapability } from '../core/capabilities.js';
import type { ProjectProvider } from '../core/operations.js';
import type { DockscopePlugin } from '../core/plugins.js';
import { composeAction, listComposeProjects } from './projects.js';

const COMPOSE_CAPABILITIES = [
  'source.inventory',
  'action.deploy',
  'action.lifecycle',
] as const satisfies readonly PluginCapability[];

const composeProjectProvider: ProjectProvider = {
  id: 'compose',
  canHandle: async (project) =>
    (await listComposeProjects()).some((candidate) => candidate.name === project),
  listProjects: listComposeProjects,
  runProjectAction: composeAction,
};

export function createComposePlugin(): DockscopePlugin {
  return {
    manifest: {
      id: 'core.compose',
      name: 'Docker Compose',
      version: '1.0.0',
      manifestVersion: '1',
      dockscopeApiVersion: '1',
      hostApiVersion: '1',
      description: 'Built-in Docker Compose project inventory and lifecycle provider.',
      builtin: true,
      capabilities: COMPOSE_CAPABILITIES,
      permissions: ['docker.socket', 'filesystem.read', 'process.exec'],
    },
    getProjectProviders: () => [composeProjectProvider],
  };
}
