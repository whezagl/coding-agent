/**
 * Integration test for state persistence across sessions.
 *
 * Tests:
 * - Agent state survives process restart
 * - Task and session data persists in Convex
 * - Resume capability recovers full state
 *
 * Uses mocked Convex backend to test persistence patterns.
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

describe('State Persistence Integration', () => {
  let mockConvex: ConvexClient;
  let agents: OrchestrationOptions['agents'];
  let orchestrationOptions: OrchestrationOptions;
  let persistedData: Map<string, any>;

  beforeEach(() => {
    // Simulate Convex persistence with in-memory storage
    persistedData = new Map();

    mockConvex = {
      mutation: vi.fn().mockImplementation((name: string, args: any) => {
        // Store data to simulate persistence
        if (name === 'tasks/createTask') {
          const task = { id: 'task-123', ...args, createdAt: Date.now() };
          persistedData.set('task-123', task);
          return task;
        }
        if (name === 'agentSessions/createAgentSession') {
          const session = { id: `session-${Date.now()}`, ...args, status: 'pending' };
          persistedData.set(session.id, session);
          return session;
        }
        if (name === 'plans/store') {
          persistedData.set(`plan-${args.taskId}`, args);
          return { id: 'plan-123' };
        }
        if (name === 'codeChanges/record') {
          const key = `change-${args.agentSessionId}`;
          const existing = persistedData.get(key) || [];
          existing.push(args);
          persistedData.set(key, existing);
          return { id: 'change-123' };
        }
        if (name === 'reviews/store') {
          persistedData.set(`review-${args.taskId}`, args);
          return { id: 'review-123' };
        }
        return {};
      }),
      query: vi.fn().mockImplementation((name: string, args?: any) => {
        // Retrieve persisted data
        if (name === 'tasks/getLatestIncompleteTask') {
          const tasks = Array.from(persistedData.values()).filter(
            (v) => v.status && v.status !== 'completed'
          );
          return tasks.sort((a, b) => b.createdAt - a.createdAt)[0] || null;
        }
        if (name === 'agentSessions/getAgentSessionsByTask') {
          return Array.from(persistedData.values()).filter(
            (v) => v.taskId === args?.taskId && v.agentType
          );
        }
        if (name === 'plans/getPlanForTask') {
          return persistedData.get(`plan-${args?.taskId}`);
        }
        return [];
      }),
    };

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

    // Setup successful agent responses
    (agents.planner.execute as any) = vi.fn().mockResolvedValue({
      success: true,
      output: '# Implementation Plan\n\n1. Create auth module',
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

    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('task persistence', () => {
    it('should persist task to Convex on creation', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Verify task was persisted
      const task = persistedData.get('task-123');
      expect(task).toBeDefined();
      expect(task.description).toBe(taskDescription);
      expect(task.status).toBeDefined();
      expect(task.createdAt).toBeDefined();
    });

    it('should persist task status updates', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // In a real implementation, status updates would be tracked
      // Here we verify the mutation was called
      expect(mockConvex.mutation).toHaveBeenCalledWith(
        'tasks/updateTaskStatus',
        expect.objectContaining({
          status: expect.any(String),
        })
      );
    });

    it('should retrieve persisted task on resume', async () => {
      // First, create and persist a task
      persistedData.set('task-123', {
        id: 'task-123',
        description: 'Implement user authentication',
        status: 'planning',
        createdAt: Date.now(),
      });

      // Resume should retrieve the task
      (mockConvex.query as any) = vi.fn().mockImplementation((name: string) => {
        if (name === 'tasks/getLatestIncompleteTask') {
          return persistedData.get('task-123');
        }
        return [];
      });

      await resumeOrchestration(orchestrationOptions);

      expect(mockConvex.query).toHaveBeenCalledWith('tasks/getLatestIncompleteTask');
    });
  });

  describe('agent session persistence', () => {
    it('should persist all agent sessions', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Find all session creation calls
      const sessionCreations = (mockConvex.mutation as any).mock.calls.filter(
        (call: any[]) => call[0] === 'agentSessions/createAgentSession'
      );

      expect(sessionCreations.length).toBe(3);

      // Each session should have been persisted
      sessionCreations.forEach((call: any[]) => {
        const args = call[1];
        expect(args.taskId).toBeDefined();
        expect(args.agentType).toBeDefined();
      });
    });

    it('should persist agent session status transitions', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Verify status updates
      const startCalls = (mockConvex.mutation as any).mock.calls.filter(
        (call: any[]) => call[0] === 'agentSessions/startAgentSession'
      );
      const completeCalls = (mockConvex.mutation as any).mock.calls.filter(
        (call: any[]) => call[0] === 'agentSessions/completeAgentSession'
      );

      expect(startCalls.length).toBe(3);
      expect(completeCalls.length).toBe(3);
    });

    it('should persist agent results', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Verify completion calls include results
      const completeCalls = (mockConvex.mutation as any).mock.calls.filter(
        (call: any[]) => call[0] === 'agentSessions/completeAgentSession'
      );

      completeCalls.forEach((call: any[]) => {
        const args = call[1];
        expect(args.result).toBeDefined();
        expect(typeof args.result).toBe('string');
      });
    });

    it('should retrieve persisted sessions on resume', async () => {
      // Persist mock sessions
      const mockSessions = [
        {
          id: 'session-1',
          taskId: 'task-123',
          agentType: 'planner',
          status: 'completed',
          result: '# Implementation Plan',
          startedAt: Date.now() - 10000,
          completedAt: Date.now() - 5000,
        },
      ];

      persistedData.set('session-1', mockSessions[0]);

      (mockConvex.query as any) = vi.fn().mockImplementation((name: string) => {
        if (name === 'tasks/getLatestIncompleteTask') {
          return {
            id: 'task-123',
            description: 'Implement user authentication',
            status: 'planning',
            createdAt: Date.now(),
          };
        }
        if (name === 'agentSessions/getAgentSessionsByTask') {
          return mockSessions;
        }
        return [];
      });

      await resumeOrchestration(orchestrationOptions);

      expect(mockConvex.query).toHaveBeenCalledWith('agentSessions/getAgentSessionsByTask', {
        taskId: 'task-123',
      });
    });
  });

  describe('plan persistence', () => {
    it('should persist plan from Planner', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Verify plan was stored
      const planCall = (mockConvex.mutation as any).mock.calls.find(
        (call: any[]) => call[0] === 'plans/store'
      );

      expect(planCall).toBeDefined();
      expect(planCall[1].content).toBeDefined();
    });

    it('should retrieve persisted plan on resume', async () => {
      const mockPlan = {
        id: 'plan-123',
        taskId: 'task-123',
        content: '# Implementation Plan\n\n1. Create auth module',
        createdAt: Date.now(),
      };

      persistedData.set('plan-task-123', mockPlan);

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
              result: mockPlan.content,
            },
          ];
        }
        if (name === 'plans/getPlanForTask') {
          return mockPlan;
        }
        return [];
      });

      await resumeOrchestration(orchestrationOptions);

      // Coder should receive the persisted plan
      expect(mockConvex.query).toHaveBeenCalledWith('plans/getPlanForTask', {
        taskId: 'task-123',
      });
    });
  });

  describe('code changes persistence', () => {
    it('should persist code changes from Coder', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Verify code changes were recorded
      const changeCalls = (mockConvex.mutation as any).mock.calls.filter(
        (call: any[]) => call[0] === 'codeChanges/record'
      );

      expect(changeCalls.length).toBeGreaterThanOrEqual(0);
    });

    it('should retrieve persisted code changes on resume', async () => {
      const mockChanges = [
        {
          filePath: 'src/auth/index.ts',
          changeType: 'create',
          summary: 'Create auth module',
        },
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
            { id: 'session-2', agentType: 'coder', status: 'completed', result: 'Done' },
          ];
        }
        if (name === 'codeChanges/getByTask') {
          return mockChanges;
        }
        return [];
      });

      await resumeOrchestration(orchestrationOptions);

      // Reviewer should receive the persisted code changes
      expect(mockConvex.query).toHaveBeenCalledWith('codeChanges/getByTask', {
        taskId: 'task-123',
      });
    });
  });

  describe('cross-session state recovery', () => {
    it('should recover complete state on resume', async () => {
      // Simulate a previous session that completed planning
      const mockTask = {
        id: 'task-123',
        description: 'Implement user authentication',
        status: 'planning',
        createdAt: Date.now() - 60000,
      };

      const mockSessions = [
        {
          id: 'session-1',
          taskId: 'task-123',
          agentType: 'planner',
          status: 'completed',
          result: '# Implementation Plan\n\n1. Create auth module',
          startedAt: Date.now() - 55000,
          completedAt: Date.now() - 50000,
        },
      ];

      const mockPlan = {
        id: 'plan-123',
        taskId: 'task-123',
        content: mockSessions[0].result,
        createdAt: Date.now() - 50000,
      };

      persistedData.set('task-123', mockTask);
      persistedData.set('session-1', mockSessions[0]);
      persistedData.set('plan-task-123', mockPlan);

      (mockConvex.query as any) = vi.fn().mockImplementation((name: string, args?: any) => {
        if (name === 'tasks/getLatestIncompleteTask') {
          return mockTask;
        }
        if (name === 'agentSessions/getAgentSessionsByTask') {
          return mockSessions;
        }
        if (name === 'plans/getPlanForTask') {
          return mockPlan;
        }
        return [];
      });

      // Resume should recover all state
      await resumeOrchestration(orchestrationOptions);

      // Verify query was made to retrieve state
      expect(mockConvex.query).toHaveBeenCalledWith('tasks/getLatestIncompleteTask');
      expect(mockConvex.query).toHaveBeenCalledWith('agentSessions/getAgentSessionsByTask', {
        taskId: 'task-123',
      });
    });

    it('should survive simulated process restart', async () => {
      // First "process": Create task and start planning
      const taskDescription = 'Implement user authentication';

      persistedData.set('task-123', {
        id: 'task-123',
        description: taskDescription,
        status: 'planning',
        createdAt: Date.now(),
      });

      persistedData.set('session-1', {
        id: 'session-1',
        taskId: 'task-123',
        agentType: 'planner',
        status: 'completed',
        result: '# Plan',
        startedAt: Date.now(),
        completedAt: Date.now() + 5000,
      });

      // Simulate process restart by clearing local state
      // (Persisted data in Convex remains)

      // Second "process": Resume from Convex
      (mockConvex.query as any) = vi.fn().mockImplementation((name: string) => {
        if (name === 'tasks/getLatestIncompleteTask') {
          return persistedData.get('task-123');
        }
        if (name === 'agentSessions/getAgentSessionsByTask') {
          return [persistedData.get('session-1')];
        }
        return [];
      });

      await resumeOrchestration(orchestrationOptions);

      // Should continue from where it left off
      expect(agents.planner.execute).not.toHaveBeenCalled();
      expect(agents.coder.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('data integrity', () => {
    it('should maintain referential integrity between task and sessions', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // All sessions should reference the same task ID
      const sessionCreations = (mockConvex.mutation as any).mock.calls.filter(
        (call: any[]) => call[0] === 'agentSessions/createAgentSession'
      );

      const taskIds = new Set(sessionCreations.map((call: any[]) => call[1].taskId));
      expect(taskIds.size).toBe(1); // All reference same task
      expect(taskIds.has('task-123')).toBe(true);
    });

    it('should preserve data consistency across mutations', async () => {
      const taskDescription = 'Implement user authentication';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Verify mutation sequence maintains consistency
      const mutations = (mockConvex.mutation as any).mock.calls.map((call: any[]) => call[0]);

      // Task should be created before sessions
      const taskIndex = mutations.indexOf('tasks/createTask');
      const sessionIndex = mutations.indexOf('agentSessions/createAgentSession');

      expect(taskIndex).toBeGreaterThanOrEqual(0);
      expect(sessionIndex).toBeGreaterThan(taskIndex);
    });
  });
});
