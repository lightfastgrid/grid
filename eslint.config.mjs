import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import accessibilityArchitecture from './scripts/eslint/accessibilityArchitecture.mjs';

// `no-duplicate-imports` off: conflicts with separate value + `import type` from one module.
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.tgz',
      'packages/core/vite.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
    plugins: {
      'lfg-architecture': accessibilityArchitecture,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': [
        'error',
        {
          allow: ['warn', 'error'],
        },
      ],
      'no-debugger': 'error',
      'no-duplicate-imports': 'off',
      'no-dupe-else-if': 'error',
      'no-dupe-keys': 'error',
      'no-empty': [
        'error',
        {
          allowEmptyCatch: false,
        },
      ],
      'no-unreachable': 'error',
      'no-unused-vars': 'off',
      'no-useless-return': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',

      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',

      'simple-import-sort/exports': 'error',
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^\\u0000'],
            ['^@?\\w'],
            ['^@/'],
            ['^\\.\\.(?!/?$)', '^\\.\\./?$'],
            ['^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
            ['^.+\\.s?css$'],
          ],
        },
      ],
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'lfg-architecture/accessibility-import-boundary': 'error',
      'lfg-architecture/composite-semantic-ownership': 'error',
    },
  },
  {
    files: ['packages/**/*.test.ts', 'packages/**/__tests__/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
        vi: 'readonly',
      },
    },
  },
  {
    // node:test's describe/it/test return promises that the test runner awaits.
    files: [
      'apps/**/*.test.ts',
      'apps/**/*.test.mjs',
      'apps/**/*.test.js',
    ],
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            {
              from: 'package',
              name: ['describe', 'it', 'test', 'suite'],
              package: 'node:test',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/playgroundReact/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      ...reactHooks.configs.flat.recommended.plugins,
      ...reactRefresh.configs.vite.plugins,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...reactRefresh.configs.vite.rules,
    },
  },
  {
    // Node dataset generator / schema scripts (not browser playground UI).
    files: ['apps/playgroundReact/src/gridDemo/schemas/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
