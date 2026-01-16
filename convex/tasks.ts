import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/**
 * Create a new task with the given description.
 * Initial status is 'pending' and retry count is 0.
 */
export const createTask = mutation({
  args: { description: v.string() },
  handler: async (ctx, args) => {
    const taskId = await ctx.db.insert('tasks', {
      description: args.description,
      status: 'pending',
      createdAt: Date.now(),
      retryCount: 0,
    });
    return taskId;
  },
});

/**
 * Update the status of a task.
 * Valid statuses: 'pending', 'planning', 'coding', 'reviewing', 'completed', 'failed'
 */
export const updateTaskStatus = mutation({
  args: {
    taskId: v.id('tasks'),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      status: args.status,
    });
  },
});

/**
 * Set error information for a failed task.
 * Stores the error message and increments retry count.
 */
export const setTaskError = mutation({
  args: {
    taskId: v.id('tasks'),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    await ctx.db.patch(args.taskId, {
      error: args.error,
      status: 'failed',
      retryCount: (task.retryCount || 0) + 1,
    });
  },
});

/**
 * Clear error from a task and reset status to pending.
 * Used when resuming a failed task.
 */
export const clearTaskError = mutation({
  args: {
    taskId: v.id('tasks'),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      error: undefined,
      status: 'pending',
    });
  },
});

/**
 * Get a single task by ID.
 */
export const getTask = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.taskId);
  },
});

/**
 * Get all tasks.
 */
export const getTasks = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect();
  },
});

/**
 * Get tasks filtered by status.
 * Useful for finding pending, in-progress, or failed tasks.
 */
export const getTasksByStatus = query({
  args: { status: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('tasks')
      .withIndex('by_status', (q) => q.eq('status', args.status))
      .collect();
  },
});

/**
 * Get the most recent task.
 * Used for --continue functionality to resume the last incomplete task.
 */
export const getLatestTask = query({
  handler: async (ctx) => {
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_created_at')
      .order('desc')
      .take(1);

    return tasks[0] ?? null;
  },
});

/**
 * Get the most recent incomplete task (status is not 'completed').
 * Returns the most recent task that needs to be resumed.
 */
export const getLatestIncompleteTask = query({
  handler: async (ctx) => {
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_status')
      .filter((q) => q.neq(q.field('status'), 'completed'))
      .collect();

    // Sort by createdAt descending and return the first one
    tasks.sort((a, b) => b.createdAt - a.createdAt);
    return tasks[0] ?? null;
  },
});
