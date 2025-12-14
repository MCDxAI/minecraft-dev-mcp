import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for Mojmap manual tests
 * Run with: npm run test:manual:mojmap
 */
export default defineConfig({
  test: {
    include: ['__tests__/manual/mojmap/**/*.test.ts'],
    testTimeout: 600000, // 10 minutes for large operations
    hookTimeout: 120000,
    watch: false,
  },
});
