import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
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
