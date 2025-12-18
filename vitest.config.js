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
  },
});
