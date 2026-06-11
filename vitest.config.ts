import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // tests run against workspace sources, not built dist
      '@coverage-insight/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
      '@coverage-insight/reporters': new URL('./packages/reporters/src/index.ts', import.meta.url)
        .pathname,
      '@coverage-insight/history': new URL('./packages/history/src/index.ts', import.meta.url)
        .pathname,
      '@coverage-insight/agents': new URL('./packages/agents/src/index.ts', import.meta.url)
        .pathname,
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['packages/core/src/**'],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
      },
    },
  },
});
