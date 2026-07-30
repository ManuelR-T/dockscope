import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    conditions: ['node', 'default'],
  },
  build: {
    target: 'node18',
    ssr: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      name: 'dockscope-kubernetes-plugin',
      fileName: 'plugin.mjs',
    },
    outDir: 'dist',
    emptyOutDir: true,
    // The packaged plugin is what a user reviews before install, so keep the
    // bundled vendor code readable rather than shipping 4MB of minified source.
    minify: false,
    rollupOptions: {
      external: [],
      output: {
        // forcing the name here cause idk why it doesnt let me do what I want
        entryFileNames: 'plugin.mjs',
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
