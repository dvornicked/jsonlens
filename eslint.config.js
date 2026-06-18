import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      eslintConfigPrettier,
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: {
      // Experimental React-Compiler rule: flags the request-token ref pattern in
      // VirtualTree, which only mutates refs inside event handlers/effects (never
      // during render) to discard stale async row fetches. Safe here.
      'react-hooks/immutability': 'off',
    },
  },
  {
    // Node-side tooling and e2e specs run outside the browser.
    files: ['e2e/**/*.ts', '*.config.{ts,js}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
]);
