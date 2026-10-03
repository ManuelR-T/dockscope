import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DockscopePlugin } from '../core/plugin-contract/manifest.js';
import { PKG_VERSION } from '../version.js';

export function createGraphView2dPlugin(): DockscopePlugin {
  return {
    manifest: {
      id: 'official.graph-view-2d',
      name: '2D service map',
      description: 'A flat graph view with dependency and network exploration.',
      version: PKG_VERSION,
      manifestVersion: '1',
      dockscopeApiVersion: '1',
      hostApiVersion: '1',
      builtin: true,
      optional: true,
      capabilities: ['ui.graphView', 'ui.frontend'],
      permissions: [],
      frontend: { entry: './frontend.mjs', slots: ['graphView'] },
      ui: [
        {
          id: 'flat',
          slot: 'graphView',
          title: '2D',
          description: 'Flat service map',
          frontendView: 'flat',
          order: 10,
        },
      ],
    },
    async getFrontendBundle() {
      if (process.env.DOCKSCOPE_DEV === '1') {
        const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
        const builder = await import(
          pathToFileURL(path.join(projectRoot, 'scripts/plugin-frontend-build.mjs')).href
        );
        return builder.buildGraphView2dBundle(projectRoot);
      }
      return readFile(new URL('./official/graph-view-2d/frontend.mjs', import.meta.url), 'utf8');
    },
  };
}
