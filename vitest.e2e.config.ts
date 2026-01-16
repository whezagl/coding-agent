import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for end-to-end (E2E) tests.
 *
 * E2E tests verify the complete system functionality:
 * - Running CLI with real tasks
 * - Full agent workflow execution
 * - Plan-only and skip-review modes
 * - Resume functionality
 *
 * These tests require:
 * - Real Convex backend (via Docker Compose)
 * - Anthropic API key
 * - Network access
 */
export default defineConfig({
  test: {
    include: ['src/**/__tests__/e2e/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/*.spec.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 60000, // E2E tests need more time for API calls
    reporters: ['verbose'],
    retry: 1, // Retry once on failure for flaky network/API issues
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/__tests__/**',
        'convex/_generated/**',
      ],
    },
  },
});
