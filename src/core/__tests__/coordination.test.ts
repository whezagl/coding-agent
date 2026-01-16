/**
 * Unit tests for agent coordination logic.
 *
 * Tests:
 * - orchestrateAgents() executes Planner → Coder → Reviewer in order
 * - Context passes between agents (plan from Planner to Coder, codeChanges from Coder to Reviewer)
 * - Error handling stores errors in Convex
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  orchestrateAgents,
  resumeOrchestration,
  executeAgent,
} from '../coordination';
import type { ConvexClient, OrchestrationOptions, OrchestrationResult } from '../coordination';
import { AgentType, TaskStatus, AgentSessionStatus } from '../../agents/types';
import type { BaseAgent } from '../../agents/base';
import type { AgentResult, AgentContext } from '../../agents/types';

describe('Agent Coordination', () => {
  let mockConvex: ConvexClient;
  let mockPlanner: BaseAgent;
  let mockCoder: BaseAgent;
  let mockReviewer: BaseAgent;
  let mockOptions: OrchestrationOptions;

  beforeEach(() => {
    // Mock Convex client
    mockConvex = {
      mutation: vi.fn().mockResolvedValue({ id: 'task-123' }),
      query: vi.fn(),
    };

    // Mock agent results
    const mockPlannerResult: AgentResult = {
      success: true,
      output: '# Implementation Plan\n\n1. Create auth module',
      metadata: {
        plan: {
          steps: [
            {
              description: 'Create auth module',
              files: ['src/auth/index.ts'],
              estimatedComplexity: 'medium',
            },
          ],
        },
      },
    };

    const mockCoderResult: AgentResult = {
      success: true,
      output: 'Implementation complete',
      metadata: {
        codeChanges: [
          {
            filePath: 'src/auth/index.ts',
            changeType: 'create',
            summary: 'Create auth module',
          },
        ],
      },
    };

    const mockReviewerResult: AgentResult = {
      success: true,
      output: 'Review passed',
      metadata: {
        review: {
          status: 'passed',
          criteriaMet: true,
          feedback: 'All criteria met',
          issues: [],
        },
      },
    };

    // Mock agents
    mockPlanner = {
      getAgentType: () => AgentType.Planner,
      execute: vi.fn().mockResolvedValue(mockPlannerResult),
    } as unknown as BaseAgent;

    mockCoder = {
      getAgentType: () => AgentType.Coder,
      execute: vi.fn().mockResolvedValue(mockCoderResult),
    } as unknown as BaseAgent;

    mockReviewer = {
      getAgentType: () => AgentType.Reviewer,
      execute: vi.fn().mockResolvedValue(mockReviewerResult),
    } as unknown as BaseAgent;

    mockOptions = {
      convex: mockConvex,
      workingDirectory: '/test/project',
      agents: {
        planner: mockPlanner,
        coder: mockCoder,
        reviewer: mockReviewer,
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('orchestrateAgents', () => {
    it('should execute agents sequentially: Planner → Coder → Reviewer', async () => {
      const taskDescription = 'Implement user authentication';

      const result = await orchestrateAgents(taskDescription, mockOptions);

      // Verify all agents were called in order
      expect(mockPlanner.execute).toHaveBeenCalledTimes(1);
      expect(mockCoder.execute).toHaveBeenCalledTimes(1);
      expect(mockReviewer.execute).toHaveBeenCalledTimes(1);

      // Verify agent execution order
      const plannerCallOrder = (mockPlanner.execute as any).mock.invocationCallOrder;
      const coderCallOrder = (mockCoder.execute as any).mock.invocationCallOrder;
      const reviewerCallOrder = (mockReviewer.execute as any).mock.invocationCallOrder;

      expect(plannerCallOrder).toBeLessThan(coderCallOrder);
      expect(coderCallOrder).toBeLessThan(reviewerCallOrder);
    });

    it('should pass plan from Planner to Coder', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, mockOptions);

      // Get the context passed to Coder
      const coderContext = (mockCoder.execute as any).mock.calls[0][0] as AgentContext;

      // Verify plan is present
      expect(coderContext.plan).toBeDefined();
      expect(coderContext.plan?.content).toContain('Implementation Plan');
    });

    it('should pass code changes from Coder to Reviewer', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, mockOptions);

      // Get the context passed to Reviewer
      const reviewerContext = (mockReviewer.execute as any).mock.calls[0][0] as AgentContext;

      // Verify code changes are present
      expect(reviewerContext.codeChanges).toBeDefined();
      expect(reviewerContext.codeChanges?.length).toBeGreaterThan(0);
      expect(reviewerContext.codeChanges?.[0].filePath).toBe('src/auth/index.ts');
    });

    it('should create task in Convex before starting agents', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, mockOptions);

      // Verify Convex mutation was called
      expect(mockConvex.mutation).toHaveBeenCalledWith('tasks/createTask', {
        description: taskDescription,
      });
    });

    it('should store agent sessions in Convex', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, mockOptions);

      // Verify session creations
      expect(mockConvex.mutation).toHaveBeenCalledWith('agentSessions/createAgentSession', {
        taskId: 'task-123',
        agentType: 'planner',
      });
      expect(mockConvex.mutation).toHaveBeenCalledWith('agentSessions/createAgentSession', {
        taskId: 'task-123',
        agentType: 'coder',
      });
      expect(mockConvex.mutation).toHaveBeenCalledWith('agentSessions/createAgentSession', {
        taskId: 'task-123',
        agentType: 'reviewer',
      });
    });

    it('should return completed orchestration result', async () => {
      const taskDescription = 'Implement user authentication';

      const result = await orchestrateAgents(taskDescription, mockOptions);

      expect(result.status).toBe(TaskStatus.Completed);
      expect(result.taskId).toBe('task-123');
      expect(result.agentResults).toHaveLength(3);
      expect(result.error).toBeUndefined();
    });

    it('should handle plan-only mode (skip Coder and Reviewer)', async () => {
      const taskDescription = 'Implement user authentication';
      const planOnlyOptions = { ...mockOptions, planOnly: true };

      await orchestrateAgents(taskDescription, planOnlyOptions);

      // Only Planner should execute
      expect(mockPlanner.execute).toHaveBeenCalledTimes(1);
      expect(mockCoder.execute).not.toHaveBeenCalled();
      expect(mockReviewer.execute).not.toHaveBeenCalled();
    });

    it('should handle skip-review mode (skip Reviewer)', async () => {
      const taskDescription = 'Implement user authentication';
      const skipReviewOptions = { ...mockOptions, skipReview: true };

      await orchestrateAgents(taskDescription, skipReviewOptions);

      // Planner and Coder should execute, Reviewer should not
      expect(mockPlanner.execute).toHaveBeenCalledTimes(1);
      expect(mockCoder.execute).toHaveBeenCalledTimes(1);
      expect(mockReviewer.execute).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should store error in Convex when agent fails', async () => {
      // Make Planner fail
      (mockPlanner.execute as any) = vi.fn().mockResolvedValue({
        success: false,
        error: new Error('Planner failed'),
      });

      const taskDescription = 'Implement user authentication';

      const result = await orchestrateAgents(taskDescription, mockOptions);

      // Verify error was stored
      expect(mockConvex.mutation).toHaveBeenCalledWith('tasks/setTaskError', {
        taskId: 'task-123',
        error: expect.stringContaining('failed'),
      });

      expect(result.status).toBe(TaskStatus.Failed);
      expect(result.error).toBeDefined();
    });

    it('should stop execution after first agent failure', async () => {
      // Make Planner fail
      (mockPlanner.execute as any) = vi.fn().mockResolvedValue({
        success: false,
        error: new Error('Planner failed'),
      });

      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, mockOptions);

      // Coder and Reviewer should not execute
      expect(mockCoder.execute).not.toHaveBeenCalled();
      expect(mockReviewer.execute).not.toHaveBeenCalled();
    });

    it('should continue to next agent if previous succeeds', async () => {
      // Make Coder fail
      (mockCoder.execute as any) = vi.fn().mockResolvedValue({
        success: false,
        error: new Error('Coder failed'),
      });

      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, mockOptions);

      // Planner should execute, Coder should fail, Reviewer should not execute
      expect(mockPlanner.execute).toHaveBeenCalledTimes(1);
      expect(mockCoder.execute).toHaveBeenCalledTimes(1);
      expect(mockReviewer.execute).not.toHaveBeenCalled();
    });
  });

  describe('resumeOrchestration', () => {
    it('should resume from last incomplete agent', async () => {
      // Mock existing task and sessions
      mockConvex.query = vi.fn()
        .mockResolvedValueOnce({
          // getLatestIncompleteTask
          id: 'task-123',
          description: 'Implement user authentication',
          status: 'planning',
        })
        .mockResolvedValueOnce([
          // getAgentSessionsByTask
          {
            id: 'session-1',
            agentType: 'planner',
            status: 'completed',
            result: '# Plan',
          },
        ]);

      const result = await resumeOrchestration(mockOptions);

      // Should only execute remaining agents (Coder, Reviewer)
      expect(mockPlanner.execute).not.toHaveBeenCalled();
      expect(mockCoder.execute).toHaveBeenCalledTimes(1);
      expect(mockReviewer.execute).toHaveBeenCalledTimes(1);
    });

    it('should clear error when resuming from failed task', async () => {
      mockConvex.query = vi.fn().mockResolvedValueOnce({
        id: 'task-123',
        description: 'Implement user authentication',
        status: 'failed',
        error: 'Previous error',
      });

      mockConvex.mutation = vi.fn()
        .mockResolvedValueOnce({ id: 'task-123' })
        .mockResolvedValueOnce({ id: 'session-1' })
        .mockResolvedValueOnce({});

      await resumeOrchestration(mockOptions);

      // Verify error was cleared
      expect(mockConvex.mutation).toHaveBeenCalledWith('tasks/clearTaskError', {
        taskId: 'task-123',
      });
    });

    it('should throw error when no incomplete task found', async () => {
      mockConvex.query = vi.fn().mockResolvedValueOnce(null);

      await expect(resumeOrchestration(mockOptions)).rejects.toThrow(
        'No incomplete task found'
      );
    });
  });

  describe('executeAgent', () => {
    it('should create agent session and update status', async () => {
      const mockContext: AgentContext = {
        task: {
          id: 'task-123',
          description: 'Test task',
          status: 'pending',
        },
        plan: undefined,
        codeChanges: [],
        previousSessions: [],
      };

      mockConvex.mutation = vi.fn()
        .mockResolvedValueOnce({ id: 'session-1' }) // createAgentSession
        .mockResolvedValueOnce({}) // startAgentSession
        .mockResolvedValueOnce({}); // completeAgentSession

      await executeAgent(
        mockPlanner,
        'task-123',
        mockContext,
        mockConvex,
        mockOptions.executionOptions
      );

      // Verify session lifecycle
      expect(mockConvex.mutation).toHaveBeenCalledWith('agentSessions/createAgentSession', {
        taskId: 'task-123',
        agentType: 'planner',
      });
      expect(mockConvex.mutation).toHaveBeenCalledWith('agentSessions/startAgentSession', {
        sessionId: 'session-1',
      });
      expect(mockConvex.mutation).toHaveBeenCalledWith('agentSessions/completeAgentSession', {
        sessionId: 'session-1',
        result: expect.any(String),
      });
    });

    it('should call agent execute with correct context', async () => {
      const mockContext: AgentContext = {
        task: {
          id: 'task-123',
          description: 'Test task',
          status: 'pending',
        },
        plan: undefined,
        codeChanges: [],
        previousSessions: [],
      };

      mockConvex.mutation = vi.fn().mockResolvedValue({ id: 'session-1' });

      await executeAgent(
        mockPlanner,
        'task-123',
        mockContext,
        mockConvex,
        mockOptions.executionOptions
      );

      expect(mockPlanner.execute).toHaveBeenCalledWith(
        mockContext,
        mockOptions.executionOptions
      );
    });

    it('should handle agent execution failure', async () => {
      const mockContext: AgentContext = {
        task: {
          id: 'task-123',
          description: 'Test task',
          status: 'pending',
        },
        plan: undefined,
        codeChanges: [],
        previousSessions: [],
      };

      // Make agent fail
      (mockPlanner.execute as any) = vi.fn().mockResolvedValue({
        success: false,
        error: new Error('Agent failed'),
      });

      mockConvex.mutation = vi.fn()
        .mockResolvedValueOnce({ id: 'session-1' })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const result = await executeAgent(
        mockPlanner,
        'task-123',
        mockContext,
        mockConvex,
        mockOptions.executionOptions
      );

      expect(result.success).toBe(false);
      expect(mockConvex.mutation).toHaveBeenCalledWith('agentSessions/failAgentSession', {
        sessionId: 'session-1',
        error: expect.any(String),
      });
    });
  });

  describe('context passing', () => {
    it('should include previous sessions in context', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, mockOptions);

      // Get context passed to Coder
      const coderContext = (mockCoder.execute as any).mock.calls[0][0] as AgentContext;

      // Verify previous sessions are included
      expect(coderContext.previousSessions).toBeDefined();
      expect(coderContext.previousSessions?.length).toBeGreaterThan(0);
      expect(coderContext.previousSessions?.[0].agentType).toBe(AgentType.Planner);
    });

    it('should pass task information to all agents', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, mockOptions);

      // Get contexts for all agents
      const plannerContext = (mockPlanner.execute as any).mock.calls[0][0] as AgentContext;
      const coderContext = (mockCoder.execute as any).mock.calls[0][0] as AgentContext;
      const reviewerContext = (mockReviewer.execute as any).mock.calls[0][0] as AgentContext;

      // All contexts should have the task
      expect(plannerContext.task.description).toBe(taskDescription);
      expect(coderContext.task.description).toBe(taskDescription);
      expect(reviewerContext.task.description).toBe(taskDescription);
    });
  });
});
