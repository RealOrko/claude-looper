import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.js', 'test/**/*.test.js'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/agents/**/*.js'],
      exclude: ['src/agents/tests/**'],
    },
    testTimeout: 10000,
    // Limit parallel execution to prevent resource exhaustion
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,
        minForks: 1,
      },
    },
    // Force exit after tests complete to clean up hanging handles
    forceExit: true,
    // Isolate test files to prevent memory accumulation
    isolate: true,
  },
});
