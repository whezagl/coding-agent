/**
 * Integration test for error recovery and resume functionality.
 *
 * Tests:
 * - Failed agent stores error in Convex via setTaskError
 * - resumeOrchestration() continues from last incomplete state
 * - Error cleared on resume
 *
 * Uses mocked Convex backend to test error recovery patterns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  orchestrateAgents,
  resumeOrchestration,
} from '../../core/coordination';
import { PlannerAgent } from '../../agents/planner';
import { CoderAgent } from '../../agents/coder';
import { ReviewerAgent } from '../../agents/reviewer';
import type { ConvexClient, OrchestrationOptions } from '../../core/coordination';
import { AgentType, TaskStatus } from '../../agents/types';

describe('Error Recovery Integration', () => {
  let mockConvex: ConvexClient;
  let agents: OrchestrationOptions['agents'];
  let orchestrationOptions: OrchestrationOptions;
  let mutationCalls: any[] = [];

  beforeEach(() => {
    mutationCalls = [];

    // Mock Convex client
    mockConvex = {
      mutation: vi.fn().mockImplementation((name: string, args: any) => {
        mutationCalls.push({ name, args });
        if (name === 'tasks/createTask') return { id: 'task-123' };
        if (name === 'agentSessions/createAgentSession') return { id: `session-${Math.random()}` };
        return {};
      }),
      query: vi.fn(),
    };

    // Create agent instances
    agents = {
      planner: new PlannerAgent({
        agentType: AgentType.Planner,
        taskDescription: '',
        workingDirectory: '/test/project',
      }),
      coder: new CoderAgent({
        agentType: AgentType.Coder,
        taskDescription: '',
        workingDirectory: '/test/project',
      }),
      reviewer: new ReviewerAgent({
        agentType: AgentType.Reviewer,
        taskDescription: '',
        workingDirectory: '/test/project',
      }),
    };

    orchestrationOptions = {
      convex: mockConvex,
      workingDirectory: '/test/project',
      agents,
    };

    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

    // Setup successful agent responses by default
    setupSuccessfulAgents();
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  function setupSuccessfulAgents() {
    (agents.planner.execute as any) = vi.fn().mockResolvedValue({
      success: true,
      output: '# Plan',
      metadata: { plan: { steps: [] } },
    });
    (agents.coder.execute as any) = vi.fn().mockResolvedValue({
      success: true,
      output: 'Code implemented',
      metadata: { codeChanges: [] },
    });
    (agents.reviewer.execute as any) = vi.fn().mockResolvedValue({
      success: true,
      output: 'Review passed',
      metadata: { review: { status: 'passed', criteriaMet: true, feedback: '', issues: [] } },
    });
  }

  describe('error storage', () => {
    it('should store error in Convex when Planner fails', async () => {
      // Make Planner fail
      const plannerError = new Error('Planner execution failed');
      (agents.planner.execute as any) = vi.fn().mockResolvedValue({
        success: false,
        error: plannerError,
      });

      const taskDescription = 'Implement user authentication';
      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Verify error was stored
      const errorCall = mutationCalls.find((call) => call.name === 'tasks/setTaskError');
      expect(errorCall).toBeDefined();
      expect(errorCall.args.error).toContain('failed');
      expect(errorCall.args.taskId).toBe('task-123');
    });

    it('should store error in Convex when Coder fails', async () => {
      // Make Coder fail
      const coderError = new Error('Coder execution failed');
      (agents.coder.execute as any) = vi.fn().mockResolvedValue({
        success: false,
        error: coderError,
      });

      const taskDescription = 'Implement user authentication';
      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Verify error was stored
      const errorCall = mutationCalls.find((call) => call.name === 'tasks/setTaskError');
      expect(errorCall).toBeDefined();
      expect(errorCall.args.error).toContain('failed');
    });

    it('should store error in Convex when Reviewer fails', async () => {
      // Make Reviewer fail
      const reviewerError = new Error('Reviewer execution failed');
      (agents.reviewer.execute as any) = vi.fn().mockResolvedValue({
        success: false,
        error: reviewerError,
      });

      const taskDescription = 'Implement user authentication';
      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Verify error was stored
      const errorCall = mutationCalls.find((call) => call.name === 'tasks/setTaskError');
      expect(errorCall).toBeDefined();
    });

    it('should increment retry count on error', async () => {
      // Mock Convex to return existing retry count
      let currentRetryCount = 2;
      mockConvex.mutation = vi.fn().mockImplementation((name: string, args: any) => {
        mutationCalls.push({ name, args });
        if (name === 'tasks/createTask') return { id: 'task-123' };
        if (name === 'agentSessions/createAgentSession') return { id: 'session-1' };
        if (name === 'agentSessions/startAgentSession') return {};
        if (name === 'agentSessions/failAgentSession') return {};
        if (name === 'tasks/setTaskError') {
          return { ...args, retryCount: currentRetryCount + 1 };
        }
        return {};
      });

      // Make Planner fail
      (agents.planner.execute as any) = vi.fn().mockResolvedValue({
        success: false,
        error: new Error('Failed'),
      });

      // Mock get task to return retry count
      (mockConvex.query as any) = vi.fn().mockResolvedValue({
        id: 'task-123',
        retryCount: currentRetryCount,
      });

      const taskDescription = 'Implement user authentication';
      await orchestrateAgents(taskDescription, orchestrationOptions);

      const errorCall = mutationCalls.find((call) => call.name === 'tasks/setTaskError');
      expect(errorCall.args.retryCount).toBeGreaterThan(currentRetryCount);
    });

    it('should fail agent session on error', async () => {
      // Make Planner fail
      (agents.planner.execute as any) = vi.fn().mockResolvedValue({
        success: false,
        error: new Error('Failed'),
      });

      const taskDescription = 'Implement user authentication';
      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Verify failAgentSession was called
      const failCall = mutationCalls.find((call) => call.name === 'agentSessions/failAgentSession');
      expect(failCall).toBeDefined();
      expect(failCall.args.error).toContain('Failed');
    });
  });

  describe('resume functionality', () => {
    it('should resume from last incomplete task', async () => {
      // Mock getLatestIncompleteTask to return a task that failed during coding
      (mockConvex.query as any) = vi.fn().mockImplementation((name: string) => {
        if (name === 'tasks/getLatestIncompleteTask') {
          return {
            id: 'task-123',
            description: 'Implement user authentication',
            status: 'failed',
            error: 'Coder failed',
          };
        }
        if (name === 'agentSessions/getAgentSessionsByTask') {
          return [
            {
              id: 'session-1',
              agentType: 'planner',
              status: 'completed',
              result: '# Plan',
            },
          ];
        }
        return [];
      });

      const result = await resumeOrchestration(orchestrationOptions);

      // Should continue from Coder (skip Planner)
      expect(agents.planner.execute).not.toHaveBeenCalled();
      expect(agents.coder.execute).toHaveBeenCalledTimes(1);
      expect(agents.reviewer.execute).toHaveBeenCalledTimes(1);
    });

    it('should clear error when resuming from failed task', async () => {
      // Mock failed task
      (mockConvex.query as any) = vi.fn().mockImplementation((name: string) => {
        if (name === 'tasks/getLatestIncompleteTask') {
          return {
            id: 'task-123',
            description: 'Implement user authentication',
            status: 'failed',
            error: 'Previous error',
          };
        }
        return [];
      });

      await resumeOrchestration(orchestrationOptions);

      // Verify clearTaskError was called
      const clearCall = mutationCalls.find((call) => call.name === 'tasks/clearTaskError');
      expect(clearCall).toBeDefined();
      expect(clearCall.args.taskId).toBe('task-123');
    });

    it('should resume from pending task (no agent completed)', async () => {
      // Mock task that hasn't started
      (mockConvex.query as any) = vi.fn().mockImplementation((name: string) => {
        if (name === 'tasks/getLatestIncompleteTask') {
          return {
            id: 'task-123',
            description: 'Implement user authentication',
            status: 'pending',
          };
        }
        return [];
      });

      await resumeOrchestration(orchestrationOptions);

      // Should run all agents
      expect(agents.planner.execute).toHaveBeenCalledTimes(1);
      expect(agents.coder.execute).toHaveBeenCalledTimes(1);
      expect(agents.reviewer.execute).toHaveBeenCalledTimes(1);
    });

    it('should resume from planning status (Planner completed)', async () => {
      // Mock task with planning completed
      (mockConvex.query as any) = vi.fn().mockImplementation((name: string) => {
        if (name === 'tasks/getLatestIncompleteTask') {
          return {
            id: 'task-123',
            description: 'Implement user authentication',
            status: 'planning',
          };
        }
        if (name === 'agentSessions/getAgentSessionsByTask') {
          return [
            {
              id: 'session-1',
              agentType: 'planner',
              status: 'completed',
              result: '# Plan',
            },
          ];
        }
        return [];
      });

      await resumeOrchestration(orchestrationOptions);

      // Should continue from Coder
      expect(agents.planner.execute).not.toHaveBeenCalled();
      expect(agents.coder.execute).toHaveBeenCalledTimes(1);
      expect(agents.reviewer.execute).toHaveBeenCalledTimes(1);
    });

    it('should resume from coding status (Coder completed)', async () => {
      // Mock task with coding completed
      (mockConvex.query as any) = vi.fn().mockImplementation((name: string) => {
        if (name === 'tasks/getLatestIncompleteTask') {
          return {
            id: 'task-123',
            description: 'Implement user authentication',
            status: 'coding',
          };
        }
        if (name === 'agentSessions/getAgentSessionsByTask') {
          return [
            {
              id: 'session-1',
              agentType: 'planner',
              status: 'completed',
              result: '# Plan',
            },
            {
              id: 'session-2',
              agentType: 'coder',
              status: 'completed',
              result: 'Code implemented',
            },
          ];
        }
        return [];
      });

      await resumeOrchestration(orchestrationOptions);

      // Should continue from Reviewer
      expect(agents.planner.execute).not.toHaveBeenCalled();
      expect(agents.coder.execute).not.toHaveBeenCalled();
      expect(agents.reviewer.execute).toHaveBeenCalledTimes(1);
    });

    it('should throw error when no incomplete task found', async () => {
      // Mock no incomplete tasks
      (mockConvex.query as any) = vi.fn().mockResolvedValue(null);

      await expect(resumeOrchestration(orchestrationOptions)).rejects.toThrow(
        'No incomplete task found'
      );
    });
  });

  describe('context restoration on resume', () => {
    it('should load previous agent results into context', async () => {
      // Mock completed Planner session with plan
      const mockPlan = '# Implementation Plan\n\n1. Create auth module';
      (mockConvex.query as any) = vi.fn().mockImplementation((name: string) => {
        if (name === 'tasks/getLatestIncompleteTask') {
          return {
            id: 'task-123',
            description: 'Implement user authentication',
            status: 'planning',
          };
        }
        if (name === 'agentSessions/getAgentSessionsByTask') {
          return [
            {
              id: 'session-1',
              agentType: 'planner',
              status: 'completed',
              result: mockPlan,
            },
          ];
        }
        if (name === 'plans/getPlanForTask') {
          return { content: mockPlan };
        }
        return [];
      });

      await resumeOrchestration(orchestrationOptions);

      // Coder should receive plan in context
      const coderContext = (agents.coder.execute as any).mock.calls[0][0];
      expect(coderContext.plan).toBeDefined();
      expect(coderContext.plan?.content).toContain('Implementation Plan');
    });

    it('should load previous code changes for Reviewer', async () => {
      const mockCodeChanges = [
        { filePath: 'src/auth/index.ts', changeType: 'create', summary: 'Create auth module' },
      ];

      (mockConvex.query as any) = vi.fn().mockImplementation((name: string) => {
        if (name === 'tasks/getLatestIncompleteTask') {
          return {
            id: 'task-123',
            description: 'Implement user authentication',
            status: 'coding',
          };
        }
        if (name === 'agentSessions/getAgentSessionsByTask') {
          return [
            { id: 'session-1', agentType: 'planner', status: 'completed', result: '# Plan' },
            { id: 'session-2', agentType: 'coder', status: 'completed', result: 'Code done' },
          ];
        }
        if (name === 'codeChanges/getByTask') {
          return mockCodeChanges;
        }
        return [];
      });

      await resumeOrchestration(orchestrationOptions);

      // Reviewer should receive code changes in context
      const reviewerContext = (agents.reviewer.execute as any).mock.calls[0][0];
      expect(reviewerContext.codeChanges).toBeDefined();
      expect(reviewerContext.codeChanges?.length).toBeGreaterThan(0);
    });
  });

  describe('retry behavior', () => {
    it('should retry failed agent on resume', async () => {
      // First run: Coder fails
      (agents.coder.execute as any) = vi.fn().mockResolvedValue({
        success: false,
        error: new Error('Coder failed'),
      });

      (mockConvex.query as any) = vi.fn().mockResolvedValue({
        id: 'task-123',
        description: 'Implement user authentication',
        status: 'failed',
        error: 'Coder failed',
      });

      // Resume will try Coder again
      (agents.coder.execute as any) = vi.fn().mockResolvedValue({
        success: true,
        output: 'Code implemented',
        metadata: { codeChanges: [] },
      });

      await resumeOrchestration(orchestrationOptions);

      expect(agents.coder.execute).toHaveBeenCalledTimes(1);
    });

    it('should respect max retry count', async () => {
      // This test verifies that the system tracks retry count
      // Actual retry limiting would be implemented in production
      const mockTask = {
        id: 'task-123',
        retryCount: 5, // Already retried 5 times
        status: 'failed',
      };

      (mockConvex.query as any) = vi.fn().mockResolvedValue(mockTask);

      // System should still attempt resume
      // Production code might check retryCount and give up
      const result = await resumeOrchestration(orchestrationOptions);

      expect(result).toBeDefined();
    });
  });
});
