import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    exclude: ['__tests__/manual/**'], // Exclude manual version-specific tests from CI
    testTimeout: 600000, // 10 minutes for integration tests
    hookTimeout: 30000,
    watch: false, // Don't watch for changes, exit after tests finish
    // Run test files sequentially to prevent race conditions
    // (different workers have different singleton instances, so in-memory locks don't help)
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/*.test.ts', '**/dist/**', '**/node_modules/**'],
    },
  },
});
