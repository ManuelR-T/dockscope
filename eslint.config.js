import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';

export default [
  js.configs.recommended,
  ...ts.configs.recommended,

  {
    rules: {
      curly: ['error', 'all'],
    },
  },

  // Svelte files
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    plugins: { svelte },
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: ts.parser,
      },
    },
    rules: {
      ...svelte.configs.recommended.rules,
      curly: ['error', 'all'],
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^\\$' },
      ],
    },
  },

  // TypeScript files
  {
    files: ['**/*.ts'],
    rules: {
      curly: ['error', 'all'],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-control-regex': 'off',
    },
  },

  // Ignore build output
  {
    ignores: ['dist/', 'node_modules/', '*.config.js', '*.config.ts'],
  },
];
