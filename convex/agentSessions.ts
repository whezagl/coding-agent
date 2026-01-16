import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/**
 * Create a new agent session for a task.
 * Initial status is 'pending' with startedAt timestamp.
 */
export const createAgentSession = mutation({
  args: {
    taskId: v.id('tasks'),
    agentType: v.string(),
  },
  handler: async (ctx, args) => {
    const sessionId = await ctx.db.insert('agentSessions', {
      taskId: args.taskId,
      agentType: args.agentType,
      status: 'pending',
      startedAt: Date.now(),
    });
    return sessionId;
  },
});

/**
 * Start an agent session by setting status to 'running'.
 */
export const startAgentSession = mutation({
  args: {
    sessionId: v.id('agentSessions'),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      status: 'running',
    });
  },
});

/**
 * Complete an agent session with the result.
 * Sets status to 'completed' and records completion time.
 */
export const completeAgentSession = mutation({
  args: {
    sessionId: v.id('agentSessions'),
    result: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      result: args.result,
      status: 'completed',
      completedAt: Date.now(),
    });
  },
});

/**
 * Mark an agent session as failed with error information.
 * Stores the error in the result field and sets status to 'failed'.
 */
export const failAgentSession = mutation({
  args: {
    sessionId: v.id('agentSessions'),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      result: args.error,
      status: 'failed',
      completedAt: Date.now(),
    });
  },
});

/**
 * Get a single agent session by ID.
 */
export const getAgentSession = query({
  args: { sessionId: v.id('agentSessions') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

/**
 * Get all agent sessions for a specific task.
 * Returns sessions ordered by startedAt (most recent first).
 */
export const getAgentSessionsByTask = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query('agentSessions')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .collect();

    // Sort by startedAt descending
    return sessions.sort((a, b) => b.startedAt - a.startedAt);
  },
});

/**
 * Get agent sessions filtered by status.
 * Useful for finding pending, running, or failed sessions.
 */
export const getAgentSessionsByStatus = query({
  args: { status: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('agentSessions')
      .withIndex('by_status', (q) => q.eq('status', args.status))
      .collect();
  },
});

/**
 * Get agent sessions filtered by agent type.
 * Useful for finding all planner, coder, or reviewer sessions.
 */
export const getAgentSessionsByType = query({
  args: { agentType: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('agentSessions')
      .withIndex('by_agent_type', (q) => q.eq('agentType', args.agentType))
      .collect();
  },
});

/**
 * Get the most recent agent session for a specific task and agent type.
 * Returns null if no session exists for the given task and type.
 */
export const getLatestAgentSessionForTask = query({
  args: {
    taskId: v.id('tasks'),
    agentType: v.string(),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query('agentSessions')
      .withIndex('by_task', (q) =>
        q.eq('taskId', args.taskId)
      )
      .filter((q) => q.eq(q.field('agentType'), args.agentType))
      .collect();

    // Sort by startedAt descending and return the first one
    sessions.sort((a, b) => b.startedAt - a.startedAt);
    return sessions[0] ?? null;
  },
});

/**
 * Get all agent sessions for a specific task and agent type.
 */
export const getAgentSessionsByTaskAndType = query({
  args: {
    taskId: v.id('tasks'),
    agentType: v.string(),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query('agentSessions')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .filter((q) => q.eq(q.field('agentType'), args.agentType))
      .collect();

    // Sort by startedAt descending
    return sessions.sort((a, b) => b.startedAt - a.startedAt);
  },
});
