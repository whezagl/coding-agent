/**
 * Convex client singleton for backend operations.
 *
 * This module provides a shared Convex client instance used by all agents
 * for storing and retrieving task data, plans, code changes, and reviews.
 *
 * The client is configured to connect to the self-hosted Convex backend
 * specified by environment variables.
 */

import { ConvexClient } from 'convex/browser';

/**
 * Singleton Convex client instance.
 * Initialized on first access and reused for subsequent calls.
 */
let convexClient: ConvexClient | null = null;

/**
 * Get or create the Convex client singleton.
 *
 * The client is configured to connect to the self-hosted Convex backend
 * using the CONVEX_SELF_HOSTED_URL and CONVEX_SELF_HOSTED_ADMIN_KEY
 * environment variables.
 *
 * @returns Convex client instance
 * @throws Error if required environment variables are not set
 */
export function getConvexClient(): ConvexClient {
  if (convexClient) {
    return convexClient;
  }

  const convexUrl = process.env.CONVEX_SELF_HOSTED_URL;
  const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY;

  if (!convexUrl) {
    throw new Error(
      'CONVEX_SELF_HOSTED_URL environment variable is required. ' +
      'Set it in your .env file or environment.'
    );
  }

  if (!adminKey) {
    throw new Error(
      'CONVEX_SELF_HOSTED_ADMIN_KEY environment variable is required. ' +
      'Set it in your .env file or environment.'
    );
  }

  // Create Convex client configured for self-hosted backend
  convexClient = new ConvexClient(convexUrl, {
    // For backend operations, we use admin authentication
    // In production with proper auth, this would use user credentials
    async unsafelyGetAuthToken() {
      return adminKey;
    },
  });

  return convexClient;
}

/**
 * Close the Convex client connection.
 *
 * Call this when shutting down the application to clean up resources.
 */
export function closeConvexClient(): void {
  if (convexClient) {
    convexClient.close();
    convexClient = null;
  }
}

/**
 * Reset the Convex client singleton.
 *
 * Primarily used for testing purposes to create a fresh client instance.
 * In production, this should rarely be needed.
 */
export function resetConvexClient(): void {
  closeConvexClient();
}
