import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // Tasks table - stores user tasks and their execution status
  tasks: defineTable({
    description: v.string(),
    status: v.string(),
    createdAt: v.number(),
    // Error handling for resume capability
    error: v.optional(v.string()),
    retryCount: v.optional(v.number()),
  })
    .index('by_status', ['status'])
    .index('by_created_at', ['createdAt']),

  // Agent sessions table - tracks individual agent executions
  agentSessions: defineTable({
    agentType: v.string(), // 'planner', 'coder', or 'reviewer'
    taskId: v.id('tasks'),
    result: v.optional(v.string()),
    status: v.string(), // 'pending', 'running', 'completed', 'failed'
    // Track execution order
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_task', ['taskId'])
    .index('by_status', ['status'])
    .index('by_agent_type', ['agentType']),

  // Plans table - stores implementation plans created by Planner agent
  plans: defineTable({
    taskId: v.id('tasks'),
    content: v.string(),
    createdAt: v.number(),
  })
    .index('by_task', ['taskId']),

  // Code changes table - tracks all file modifications made by Coder agent
  codeChanges: defineTable({
    taskId: v.id('tasks'),
    agentSessionId: v.id('agentSessions'),
    filePath: v.string(),
    changeType: v.string(), // 'create', 'edit', 'delete'
    summary: v.string(),
    createdAt: v.number(),
  })
    .index('by_task', ['taskId'])
    .index('by_agent_session', ['agentSessionId']),

  // Reviews table - stores review results from Reviewer agent
  reviews: defineTable({
    taskId: v.id('tasks'),
    agentSessionId: v.id('agentSessions'),
    status: v.string(), // 'passed', 'failed', 'needs_revision'
    feedback: v.string(),
    criteriaMet: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_task', ['taskId'])
    .index('by_agent_session', ['agentSessionId'])
    .index('by_status', ['status']),
});
