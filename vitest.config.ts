import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // e2e/ is driven by Playwright, not Vitest.
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
