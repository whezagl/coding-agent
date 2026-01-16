import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for integration tests.
 *
 * Integration tests verify the interaction between multiple components:
 * - CLI ↔ Agents ↔ Convex full workflow
 * - Error recovery and resume functionality
 * - State persistence across sessions
 *
 * These tests use mocked Convex backend to test integration patterns
 * without requiring a running Docker container.
 */
export default defineConfig({
  test: {
    include: ['src/**/__tests__/integration/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/*.spec.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 10000,
    reporters: ['verbose'],
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
