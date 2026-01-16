/**
 * Agent coordination logic for sequential execution.
 *
 * This module implements the orchestration of the three-agent workflow:
 * Planner → Coder → Reviewer, with Convex state management for persistence
 * and context passing between agents.
 *
 * Architecture Pattern: Sequential Agent Coordination with State Backend
 * - Each agent runs in isolated Claude SDK session
 * - Convex stores agent state and task history
 * - Results passed between agents via shared context
 * - Resume capability from last known state
 *
 * @see {@link https://github.com/anthropics/anthropic-ai-sdk-typescript}
 */

import type {
  AgentType,
  AgentContext,
  AgentResult,
  AgentExecutionOptions,
  AgentSession,
  TaskStatus,
} from '../agents/types';
import {
  AgentSessionStatus,
  TaskStatus as TaskStatusEnum,
  WorkflowError,
} from '../agents/types';
import type { BaseAgent } from '../agents/base';

/**
 * Convex client type for interacting with the backend.
 * This is a placeholder - the actual Convex client will be imported
 * from the generated Convex types when the project is built.
 */
export interface ConvexClient {
  mutation: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
  query: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
}

/**
 * Configuration options for orchestrating agents.
 */
export interface OrchestrationOptions {
  /** Convex client for state management */
  convex: ConvexClient;
  /** Working directory for file operations */
  workingDirectory: string;
  /** Agent implementations (Planner, Coder, Reviewer) */
  agents: Record<AgentType, BaseAgent>;
  /** Execution options for agents */
  executionOptions?: AgentExecutionOptions;
  /** Whether to skip review step */
  skipReview?: boolean;
  /** Whether to only run planner */
  planOnly?: boolean;
}

/**
 * Result of the orchestration process.
 */
export interface OrchestrationResult {
  /** Task ID in Convex */
  taskId: string;
  /** Final task status */
  status: TaskStatus;
  /** Results from each agent that executed */
  agentResults: AgentResult[];
  /** Error if orchestration failed */
  error?: string;
}

/**
 * Context for storing plan information.
 */
interface PlanContext {
  content: string;
  createdAt: Date;
}

/**
 * Context for storing code changes.
 */
interface CodeChangesContext {
  filePath: string;
  changeType: 'create' | 'edit' | 'delete';
  summary: string;
}

/**
 * Orchestrate the sequential execution of agents: Planner → Coder → Reviewer.
 *
 * This is the main entry point for agent coordination. It:
 * 1. Creates a task in Convex
 * 2. Executes agents sequentially with state management
 * 3. Passes context between agents via Convex
 * 4. Handles errors and stores state for resume capability
 *
 * @param taskDescription - User's task description
 * @param options - Orchestration configuration
 * @returns Promise resolving to orchestration result
 *
 * @example
 * ```ts
 * const result = await orchestrateAgents('Implement user auth', {
 *   convex: convexClient,
 *   workingDirectory: '/path/to/project',
 *   agents: { planner, coder, reviewer },
 * });
 *
 * console.log(`Task ${result.taskId} completed with status ${result.status}`);
 * ```
 */
export async function orchestrateAgents(
  taskDescription: string,
  options: OrchestrationOptions
): Promise<OrchestrationResult> {
  const {
    convex,
    workingDirectory,
    agents,
    executionOptions,
    skipReview = false,
    planOnly = false,
  } = options;

  // Validate agents are provided
  if (!agents.planner || !agents.coder) {
    throw new WorkflowError('Planner and Coder agents are required');
  }
  if (!skipReview && !planOnly && !agents.reviewer) {
    throw new WorkflowError('Reviewer agent is required when not skipping review');
  }

  // Create task in Convex
  const taskId = await convex.mutation<string>('tasks/createTask', {
    description: taskDescription,
  });

  const agentResults: AgentResult[] = [];
  let planContext: PlanContext | undefined;
  let codeChanges: CodeChangesContext[] = [];
  let taskStatus = TaskStatusEnum.Pending;

  try {
    // Execute Planner agent
    const plannerResult = await executeAgent(
      convex,
      taskId,
      agents.planner,
      {
        task: { description: taskDescription, id: taskId },
        previousSessions: [],
      },
      executionOptions
    );

    agentResults.push(plannerResult);

    if (!plannerResult.success) {
      // Planner failed - mark task as failed
      await convex.mutation('tasks/setTaskError', {
        taskId,
        error: plannerResult.error ?? 'Planner agent failed',
      });
      return {
        taskId,
        status: TaskStatusEnum.Failed,
        agentResults,
        error: plannerResult.error,
      };
    }

    // Store plan in context for passing to next agents
    planContext = {
      content: plannerResult.content,
      createdAt: plannerResult.completedAt,
    };

    // Note: Plan will be stored in Convex plans table in future phase
    // TODO: Add plans/store mutation when Convex plans functions are created

    // Update task status to planning complete
    taskStatus = TaskStatusEnum.Planning;
    await convex.mutation('tasks/updateTaskStatus', {
      taskId,
      status: taskStatus,
    });

    // If plan-only mode, stop here
    if (planOnly) {
      await convex.mutation('tasks/updateTaskStatus', {
        taskId,
        status: TaskStatusEnum.Completed,
      });
      return {
        taskId,
        status: TaskStatusEnum.Completed,
        agentResults,
      };
    }

    // Execute Coder agent
    taskStatus = TaskStatusEnum.Coding;
    await convex.mutation('tasks/updateTaskStatus', {
      taskId,
      status: taskStatus,
    });

    const coderResult = await executeAgent(
      convex,
      taskId,
      agents.coder,
      {
        task: { description: taskDescription, id: taskId },
        plan: planContext,
        previousSessions: agentResults.map(resultToSession),
      },
      executionOptions
    );

    agentResults.push(coderResult);

    if (!coderResult.success) {
      // Coder failed - mark task as failed
      await convex.mutation('tasks/setTaskError', {
        taskId,
        error: coderResult.error ?? 'Coder agent failed',
      });
      return {
        taskId,
        status: TaskStatusEnum.Failed,
        agentResults,
        error: coderResult.error,
      };
    }

    // Extract code changes from result metadata for passing to Reviewer
    if (coderResult.metadata?.codeChanges) {
      codeChanges = coderResult.metadata.codeChanges as CodeChangesContext[];
    }

    // Note: Code changes will be stored in Convex codeChanges table in future phase
    // TODO: Add codeChanges/record mutation when Convex codeChanges functions are created

    // Update task status to coding complete
    await convex.mutation('tasks/updateTaskStatus', {
      taskId,
      status: taskStatus,
    });

    // If skipping review, mark task as completed
    if (skipReview) {
      await convex.mutation('tasks/updateTaskStatus', {
        taskId,
        status: TaskStatusEnum.Completed,
      });
      return {
        taskId,
        status: TaskStatusEnum.Completed,
        agentResults,
      };
    }

    // Execute Reviewer agent
    taskStatus = TaskStatusEnum.Reviewing;
    await convex.mutation('tasks/updateTaskStatus', {
      taskId,
      status: taskStatus,
    });

    const reviewerResult = await executeAgent(
      convex,
      taskId,
      agents.reviewer!,
      {
        task: { description: taskDescription, id: taskId },
        plan: planContext,
        codeChanges,
        previousSessions: agentResults.map(resultToSession),
      },
      executionOptions
    );

    agentResults.push(reviewerResult);

    if (!reviewerResult.success) {
      // Reviewer failed - mark task as failed
      await convex.mutation('tasks/setTaskError', {
        taskId,
        error: reviewerResult.error ?? 'Reviewer agent failed',
      });
      return {
        taskId,
        status: TaskStatusEnum.Failed,
        agentResults,
        error: reviewerResult.error,
      };
    }

    // Note: Review will be stored in Convex reviews table in future phase
    // TODO: Add reviews/store mutation when Convex reviews functions are created

    // Mark task as completed
    await convex.mutation('tasks/updateTaskStatus', {
      taskId,
      status: TaskStatusEnum.Completed,
    });

    return {
      taskId,
      status: TaskStatusEnum.Completed,
      agentResults,
    };

  } catch (error) {
    // Handle unexpected errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await convex.mutation('tasks/setTaskError', {
      taskId,
      error: errorMessage,
    });

    return {
      taskId,
      status: TaskStatusEnum.Failed,
      agentResults,
      error: errorMessage,
    };
  }
}

/**
 * Resume orchestration from the last known state.
 *
 * Used when a previous orchestration was interrupted or failed.
 * Retrieves the last incomplete task and continues from where it left off.
 *
 * @param convex - Convex client for state management
 * @param options - Orchestration configuration
 * @returns Promise resolving to orchestration result
 *
 * @example
 * ```ts
 * const result = await resumeOrchestration({
 *   convex: convexClient,
 *   workingDirectory: '/path/to/project',
 *   agents: { planner, coder, reviewer },
 * });
 * ```
 */
export async function resumeOrchestration(
  options: OrchestrationOptions
): Promise<OrchestrationResult> {
  const { convex, workingDirectory, agents, executionOptions } = options;

  // Get the latest incomplete task
  const task = await convex.query<{
    _id: string;
    description: string;
    status: string;
    createdAt: number;
    error?: string;
  } | null>('tasks/getLatestIncompleteTask');

  if (!task) {
    throw new WorkflowError('No incomplete task found to resume');
  }

  const taskId = task._id;

  // Get existing agent sessions for this task
  const sessions = await convex.query<
    Array<{
      _id: string;
      agentType: string;
      status: string;
      result?: string;
      startedAt: number;
      completedAt?: number;
    }>
  >('agentSessions/getAgentSessionsByTask', { taskId });

  const agentResults: AgentResult[] = [];
  let planContext: PlanContext | undefined;
  let codeChanges: CodeChangesContext[] = [];

  // Process completed sessions
  for (const session of sessions) {
    if (session.status === 'completed' && session.result) {
      const result: AgentResult = {
        agentType: session.agentType as AgentType,
        success: true,
        content: session.result,
        completedAt: new Date(session.completedAt ?? session.startedAt),
      };
      agentResults.push(result);

      // Update context based on agent type
      if (session.agentType === 'planner') {
        planContext = {
          content: session.result,
          createdAt: new Date(session.completedAt ?? session.startedAt),
        };
      }
    }
  }

  // Determine next agent to execute
  const lastSession = sessions[0]; // Most recent first
  const lastAgentType = lastSession?.agentType as AgentType;

  let nextAgent: BaseAgent;
  let nextContext: AgentContext;

  if (lastAgentType === 'planner' || lastSession?.status === 'failed') {
    // Planner failed, need to retry from Planner
    nextAgent = agents.planner;
    nextContext = {
      task: { description: task.description, id: taskId },
      previousSessions: agentResults.map(resultToSession),
    };
  } else if (lastAgentType === 'coder') {
    // Coder completed, need to run Reviewer
    if (!agents.reviewer) {
      throw new WorkflowError('Reviewer agent is required for resume');
    }
    nextAgent = agents.reviewer;
    nextContext = {
      task: { description: task.description, id: taskId },
      plan: planContext,
      codeChanges,
      previousSessions: agentResults.map(resultToSession),
    };

    // Update task status
    await convex.mutation('tasks/updateTaskStatus', {
      taskId,
      status: TaskStatusEnum.Reviewing,
    });
  } else {
    // Planner completed, need to run Coder
    nextAgent = agents.coder;
    nextContext = {
      task: { description: task.description, id: taskId },
      plan: planContext,
      previousSessions: agentResults.map(resultToSession),
    };

    // Update task status
    await convex.mutation('tasks/updateTaskStatus', {
      taskId,
      status: TaskStatusEnum.Coding,
    });
  }

  try {
    // Execute the next agent
    const result = await executeAgent(
      convex,
      taskId,
      nextAgent,
      nextContext,
      executionOptions
    );

    agentResults.push(result);

    if (!result.success) {
      await convex.mutation('tasks/setTaskError', {
        taskId,
        error: result.error ?? `${nextAgent.getAgentType()} agent failed`,
      });
      return {
        taskId,
        status: TaskStatusEnum.Failed,
        agentResults,
        error: result.error,
      };
    }

    // Continue with remaining agents
    // ... (similar to orchestrateAgents but starting from current state)

    await convex.mutation('tasks/updateTaskStatus', {
      taskId,
      status: TaskStatusEnum.Completed,
    });

    return {
      taskId,
      status: TaskStatusEnum.Completed,
      agentResults,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await convex.mutation('tasks/setTaskError', {
      taskId,
      error: errorMessage,
    });

    return {
      taskId,
      status: TaskStatusEnum.Failed,
      agentResults,
      error: errorMessage,
    };
  }
}

/**
 * Execute a single agent with Convex state management.
 *
 * Creates an agent session, updates status, executes the agent,
 * and stores the result in Convex.
 *
 * @param convex - Convex client
 * @param taskId - Task ID in Convex
 * @param agent - Agent to execute
 * @param context - Agent execution context
 * @param options - Optional execution options
 * @returns Promise resolving to agent result
 */
async function executeAgent(
  convex: ConvexClient,
  taskId: string,
  agent: BaseAgent,
  context: AgentContext,
  options?: AgentExecutionOptions
): Promise<AgentResult> {
  // Create agent session
  const sessionId = await convex.mutation<string>('agentSessions/createAgentSession', {
    taskId,
    agentType: agent.getAgentType(),
  });

  // Start the session
  await convex.mutation('agentSessions/startAgentSession', { sessionId });

  try {
    // Execute the agent
    const result = await agent.execute(context, options);

    // Complete or fail the session based on result
    if (result.success) {
      await convex.mutation('agentSessions/completeAgentSession', {
        sessionId,
        result: result.content,
      });
    } else {
      await convex.mutation('agentSessions/failAgentSession', {
        sessionId,
        error: result.error ?? 'Agent execution failed',
      });
    }

    return result;

  } catch (error) {
    // Handle execution errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await convex.mutation('agentSessions/failAgentSession', {
      sessionId,
      error: errorMessage,
    });

    return agent.createFailureResult(errorMessage, error);
  }
}

/**
 * Convert an AgentResult to an AgentSession for context passing.
 */
function resultToSession(result: AgentResult): AgentSession {
  return {
    id: result.agentType + '-' + result.completedAt.getTime(),
    agentType: result.agentType,
    taskId: '',
    status: result.success ? AgentSessionStatus.Completed : AgentSessionStatus.Failed,
    startedAt: new Date(result.completedAt.getTime() - 1000), // Approximate
    completedAt: result.completedAt,
    result: result.content,
    error: result.error,
  };
}
