import path from 'node:path';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/** One self-contained ESM file; sandboxed frontends cannot import dependencies or styles. */
export async function buildGraphView2dBundle(projectRoot) {
  const result = await build({
    configFile: false,
    root: projectRoot,
    logLevel: 'silent',
    plugins: [svelte({ configFile: false })],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      minify: true,
      target: 'es2022',
      cssCodeSplit: false,
      lib: {
        entry: path.join(projectRoot, 'src/plugins/official/graph-view-2d/frontend.ts'),
        formats: ['es'],
        fileName: 'frontend',
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const script = output.find((item) => item.type === 'chunk' && item.isEntry);
  if (!script) throw new Error('Missing graph view frontend bundle');
  const css = output
    .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
    .map((item) =>
      typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source),
    )
    .join('\n');
  const bundle = `const style = document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);\n${script.code}`;
  if (Buffer.byteLength(bundle, 'utf8') > 256 * 1024)
    throw new Error('Graph view frontend exceeds 256 KiB');
  return bundle;
}
