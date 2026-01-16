/**
 * Convex functions for review management.
 *
 * This module provides mutations and queries for storing and retrieving
 * reviews from the Reviewer agent.
 *
 * Reviews are stored in Convex to enable:
 * - Final validation of implementation quality
 * - Audit trail of acceptance/rejection decisions
 * - Feedback for iterative improvement
 * - Resume capability (reviews persist across sessions)
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Store a new review for a task.
 *
 * Creates a review record associated with a task and agent session.
 * This is called by the Reviewer agent after evaluating the implementation.
 *
 * @param taskId - The ID of the task this review is for
 * @param agentSessionId - The ID of the reviewer agent session
 * @param status - Review status ('passed', 'failed', 'needs_revision')
 * @param feedback - Detailed feedback and rationale
 * @param criteriaMet - Whether acceptance criteria were met
 * @returns The ID of the created review
 */
export const store = mutation({
  args: {
    taskId: v.id('tasks'),
    agentSessionId: v.id('agentSessions'),
    status: v.string(),
    feedback: v.string(),
    criteriaMet: v.boolean(),
  },
  handler: async (ctx, args) => {
    const reviewId = await ctx.db.insert('reviews', {
      taskId: args.taskId,
      agentSessionId: args.agentSessionId,
      status: args.status,
      feedback: args.feedback,
      criteriaMet: args.criteriaMet,
      createdAt: Date.now(),
    });
    return reviewId;
  },
});

/**
 * Get a review by its ID.
 *
 * Retrieves a specific review record. Used when loading review
 * details for display or context passing.
 *
 * @param reviewId - The ID of the review to retrieve
 * @returns The review record or null if not found
 */
export const get = query({
  args: {
    reviewId: v.id('reviews'),
  },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    return review;
  },
});

/**
 * Get the review for a specific task.
 *
 * Retrieves the most recent review associated with a task. Used for
 * checking the final validation status of an implementation.
 *
 * @param taskId - The ID of the task
 * @returns The review record or null if not found
 */
export const getReviewForTask = query({
  args: {
    taskId: v.id('tasks'),
  },
  handler: async (ctx, args) => {
    // Get reviews for this task
    const reviews = await ctx.db
      .query('reviews')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .collect();

    // Return the most recent review (should only be one)
    if (reviews.length === 0) {
      return null;
    }

    // Sort by createdAt descending and return the first (most recent)
    reviews.sort((a, b) => b.createdAt - a.createdAt);
    return reviews[0];
  },
});

/**
 * Get all reviews for a task.
 *
 * Retrieves all reviews associated with a task, ordered by creation time.
 * Useful for showing review history or revisions.
 *
 * @param taskId - The ID of the task
 * @returns Array of review records, ordered by creation time (newest first)
 */
export const getReviewsForTask = query({
  args: {
    taskId: v.id('tasks'),
  },
  handler: async (ctx, args) => {
    const reviews = await ctx.db
      .query('reviews')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .collect();

    // Sort by createdAt descending
    reviews.sort((a, b) => b.createdAt - a.createdAt);
    return reviews;
  },
});

/**
 * Get all reviews with a specific status.
 *
 * Retrieves all reviews with a given status (e.g., all failed reviews).
 * Useful for analytics and identifying patterns in issues.
 *
 * @param status - The review status to filter by
 * @returns Array of review records with the given status
 */
export const getReviewsByStatus = query({
  args: {
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const reviews = await ctx.db
      .query('reviews')
      .withIndex('by_status', (q) => q.eq('status', args.status))
      .collect();

    // Sort by createdAt descending (most recent first)
    reviews.sort((a, b) => b.createdAt - a.createdAt);
    return reviews;
  },
});

/**
 * Get review for a specific agent session.
 *
 * Retrieves the review created by a specific agent session.
 *
 * @param agentSessionId - The ID of the agent session
 * @returns The review record or null if not found
 */
export const getReviewForSession = query({
  args: {
    agentSessionId: v.id('agentSessions'),
  },
  handler: async (ctx, args) => {
    const reviews = await ctx.db
      .query('reviews')
      .withIndex('by_agent_session', (q) => q.eq('agentSessionId', args.agentSessionId))
      .collect();

    if (reviews.length === 0) {
      return null;
    }

    // Return the first (should only be one per session)
    return reviews[0];
  },
});

/**
 * Update an existing review.
 *
 * Updates the content of an existing review. This can be used when
 * revising a review based on new information or re-evaluation.
 *
 * @param reviewId - The ID of the review to update
 * @param status - New review status
 * @param feedback - Updated feedback
 * @param criteriaMet - Updated criteria met flag
 * @returns The ID of the updated review
 */
export const update = mutation({
  args: {
    reviewId: v.id('reviews'),
    status: v.optional(v.string()),
    feedback: v.optional(v.string()),
    criteriaMet: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) {
      throw new Error(`Review not found: ${args.reviewId}`);
    }

    const patchData: Record<string, unknown> = {};
    if (args.status !== undefined) {
      patchData.status = args.status;
    }
    if (args.feedback !== undefined) {
      patchData.feedback = args.feedback;
    }
    if (args.criteriaMet !== undefined) {
      patchData.criteriaMet = args.criteriaMet;
    }

    await ctx.db.patch(args.reviewId, patchData);

    return args.reviewId;
  },
});

/**
 * Delete a review.
 *
 * Permanently removes a review from the database. Use with caution.
 *
 * @param reviewId - The ID of the review to delete
 * @returns The ID of the deleted review
 */
export const remove = mutation({
  args: {
    reviewId: v.id('reviews'),
  },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) {
      throw new Error(`Review not found: ${args.reviewId}`);
    }

    await ctx.db.delete(args.reviewId);
    return args.reviewId;
  },
});
