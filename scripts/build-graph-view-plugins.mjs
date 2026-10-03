import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraphView2dBundle } from './plugin-frontend-build.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(projectRoot, 'dist/plugins/official/graph-view-2d/frontend.mjs');
await mkdir(path.dirname(target), { recursive: true });
const bundle = await buildGraphView2dBundle(projectRoot);
await writeFile(target, bundle);
console.log(`Built official 2D graph view (${Math.round(Buffer.byteLength(bundle) / 1024)} KiB)`);
