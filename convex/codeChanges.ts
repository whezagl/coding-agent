/**
 * Convex functions for code change management.
 *
 * This module provides mutations and queries for storing and retrieving
 * code changes made by the Coder agent during implementation.
 *
 * Code changes are tracked in Convex to enable:
 * - Context passing from Coder to Reviewer agent
 * - Audit trail of all file modifications
 * - Resume capability (changes persist across sessions)
 * - Rollback and debugging support
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Record a code change for a task.
 *
 * Creates a code change record associated with a task and agent session.
 * This is called by the Coder agent after making file modifications.
 *
 * @param taskId - The ID of the task this change is for
 * @param agentSessionId - The ID of the agent session making the change
 * @param filePath - Path to the file that was changed
 * @param changeType - Type of change ('create', 'edit', 'delete')
 * @param summary - Brief description of the change
 * @returns The ID of the created code change record
 */
export const record = mutation({
  args: {
    taskId: v.id('tasks'),
    agentSessionId: v.id('agentSessions'),
    filePath: v.string(),
    changeType: v.string(),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const changeId = await ctx.db.insert('codeChanges', {
      taskId: args.taskId,
      agentSessionId: args.agentSessionId,
      filePath: args.filePath,
      changeType: args.changeType,
      summary: args.summary,
      createdAt: Date.now(),
    });
    return changeId;
  },
});

/**
 * Get a code change by its ID.
 *
 * Retrieves a specific code change record. Used when loading change
 * details for display or context passing.
 *
 * @param changeId - The ID of the code change to retrieve
 * @returns The code change record or null if not found
 */
export const get = query({
  args: {
    changeId: v.id('codeChanges'),
  },
  handler: async (ctx, args) => {
    const change = await ctx.db.get(args.changeId);
    return change;
  },
});

/**
 * Get all code changes for a task.
 *
 * Retrieves all code changes associated with a task, ordered by creation time.
 * Used by the Reviewer agent to understand what changes were made.
 *
 * @param taskId - The ID of the task
 * @returns Array of code change records, ordered by creation time (oldest first)
 */
export const getChangesForTask = query({
  args: {
    taskId: v.id('tasks'),
  },
  handler: async (ctx, args) => {
    const changes = await ctx.db
      .query('codeChanges')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .collect();

    // Sort by createdAt ascending (chronological order)
    changes.sort((a, b) => a.createdAt - b.createdAt);
    return changes;
  },
});

/**
 * Get all code changes for an agent session.
 *
 * Retrieves all code changes made during a specific agent session.
 * Useful for understanding the output of a single Coder agent execution.
 *
 * @param agentSessionId - The ID of the agent session
 * @returns Array of code change records, ordered by creation time (oldest first)
 */
export const getChangesForSession = query({
  args: {
    agentSessionId: v.id('agentSessions'),
  },
  handler: async (ctx, args) => {
    const changes = await ctx.db
      .query('codeChanges')
      .withIndex('by_agent_session', (q) => q.eq('agentSessionId', args.agentSessionId))
      .collect();

    // Sort by createdAt ascending (chronological order)
    changes.sort((a, b) => a.createdAt - b.createdAt);
    return changes;
  },
});

/**
 * Get code changes for a task grouped by file.
 *
 * Retrieves all code changes for a task, grouped by file path.
 * This provides a consolidated view of what was changed in each file.
 *
 * @param taskId - The ID of the task
 * @returns Object mapping file paths to arrays of changes
 */
export const getChangesGroupedByFile = query({
  args: {
    taskId: v.id('tasks'),
  },
  handler: async (ctx, args) => {
    const changes = await ctx.db
      .query('codeChanges')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .collect();

    // Group changes by file path
    const grouped: Record<string, typeof changes> = {};
    for (const change of changes) {
      if (!grouped[change.filePath]) {
        grouped[change.filePath] = [];
      }
      grouped[change.filePath].push(change);
    }

    // Sort changes within each file by creation time
    for (const filePath in grouped) {
      grouped[filePath].sort((a, b) => a.createdAt - b.createdAt);
    }

    return grouped;
  },
});
