/**
 * Convex functions for plan management.
 *
 * This module provides mutations and queries for storing and retrieving
 * implementation plans created by the Planner agent.
 *
 * Plans are stored in Convex to enable:
 * - Context passing from Planner to Coder and Reviewer agents
 * - Resume capability (plan persists across sessions)
 * - Audit trail of what was planned
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Store a new plan for a task.
 *
 * Creates a plan record associated with a task. This is called by the
 * Planner agent after generating an implementation plan.
 *
 * @param taskId - The ID of the task this plan is for
 * @param content - The plan content (markdown formatted)
 * @returns The ID of the created plan
 */
export const store = mutation({
  args: {
    taskId: v.id('tasks'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const planId = await ctx.db.insert('plans', {
      taskId: args.taskId,
      content: args.content,
      createdAt: Date.now(),
    });
    return planId;
  },
});

/**
 * Get a plan by its ID.
 *
 * Retrieves a specific plan record. Used when loading plan details
 * for display or context passing.
 *
 * @param planId - The ID of the plan to retrieve
 * @returns The plan record or null if not found
 */
export const get = query({
  args: {
    planId: v.id('plans'),
  },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    return plan;
  },
});

/**
 * Get the plan for a specific task.
 *
 * Retrieves the most recent plan associated with a task. Used by the
 * Coder and Reviewer agents to get the implementation plan.
 *
 * @param taskId - The ID of the task
 * @returns The plan record or null if not found
 */
export const getPlanForTask = query({
  args: {
    taskId: v.id('tasks'),
  },
  handler: async (ctx, args) => {
    // Get plans for this task
    const plans = await ctx.db
      .query('plans')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .collect();

    // Return the most recent plan (should only be one)
    if (plans.length === 0) {
      return null;
    }

    // Sort by createdAt descending and return the first (most recent)
    plans.sort((a, b) => b.createdAt - a.createdAt);
    return plans[0];
  },
});

/**
 * Get all plans for a task.
 *
 * Retrieves all plans associated with a task, ordered by creation time.
 * Useful for showing plan history or revisions.
 *
 * @param taskId - The ID of the task
 * @returns Array of plan records, ordered by creation time (newest first)
 */
export const getPlansForTask = query({
  args: {
    taskId: v.id('tasks'),
  },
  handler: async (ctx, args) => {
    const plans = await ctx.db
      .query('plans')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .collect();

    // Sort by createdAt descending
    plans.sort((a, b) => b.createdAt - a.createdAt);
    return plans;
  },
});

/**
 * Update an existing plan.
 *
 * Updates the content of an existing plan. This can be used when
 * revising a plan based on new information or feedback.
 *
 * @param planId - The ID of the plan to update
 * @param content - The new plan content
 * @returns The ID of the updated plan
 */
export const update = mutation({
  args: {
    planId: v.id('plans'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new Error(`Plan not found: ${args.planId}`);
    }

    await ctx.db.patch(args.planId, {
      content: args.content,
    });

    return args.planId;
  },
});

/**
 * Delete a plan.
 *
 * Permanently removes a plan from the database. Use with caution.
 *
 * @param planId - The ID of the plan to delete
 * @returns The ID of the deleted plan
 */
export const remove = mutation({
  args: {
    planId: v.id('plans'),
  },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new Error(`Plan not found: ${args.planId}`);
    }

    await ctx.db.delete(args.planId);
    return args.planId;
  },
});
