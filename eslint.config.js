import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    '**/dist',
    '**/dist-e2e',
    '**/coverage',
    'playwright-report',
    'test-results',
    'blob-report',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended],
    rules: {
      'no-console': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/client/src/**/*.{js,jsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ['apps/client/tests/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: [
      'apps/server/**/*.js',
      'scripts/**/*.js',
      'e2e/**/*.js',
      '*.config.js',
      'apps/*/*.config.js',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright specs also contain callbacks that run inside the browser
    // (page.evaluate).
    files: ['e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // CLI scripts report progress to the terminal by design.
    files: ['scripts/**/*.js'],
    rules: { 'no-console': 'off' },
  },
])
