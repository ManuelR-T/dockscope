import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ configFile: false })],
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
