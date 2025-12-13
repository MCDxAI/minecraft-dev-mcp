import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for manual version-specific tests
 *
 * These tests verify that the MCP server works correctly with older Minecraft versions.
 * They are excluded from CI to keep builds fast, but can be run manually to verify
 * compatibility with legacy versions.
 *
 * Run all manual tests: npm run test:manual
 * Run specific version: npm run test:manual:1.21.10
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/manual/**/*.test.ts'],
    testTimeout: 600000, // 10 minutes for integration tests
    hookTimeout: 30000,
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/*.test.ts', '**/dist/**', '**/node_modules/**'],
    },
  },
});
