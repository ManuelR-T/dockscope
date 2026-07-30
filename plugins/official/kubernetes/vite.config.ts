import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: resolve(__dirname, 'public'),
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'dockscope-kubernetes-plugin',
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: [],
    },
  },
});
