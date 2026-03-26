import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  root: '.',
  server: {
    port: 4680,
    proxy: {
      '/api': 'http://localhost:4681',
      '/ws': {
        target: 'ws://localhost:4681',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
  },
});
