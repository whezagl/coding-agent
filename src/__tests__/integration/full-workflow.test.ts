/**
 * Integration test for full agent workflow.
 *
 * Tests the complete sequential execution flow:
 * - Task description → Plan → Code → Review
 * - All three agents execute sequentially
 * - Convex stores task, sessions, plan, changes, review
 *
 * Uses mocked Convex backend to test integration patterns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { orchestrateAgents } from '../../core/coordination';
import { PlannerAgent } from '../../agents/planner';
import { CoderAgent } from '../../agents/coder';
import { ReviewerAgent } from '../../agents/reviewer';
import type { ConvexClient, OrchestrationOptions } from '../../core/coordination';
import { AgentType, TaskStatus } from '../../agents/types';

describe('Full Workflow Integration', () => {
  let mockConvex: ConvexClient;
  let agents: OrchestrationOptions['agents'];
  let orchestrationOptions: OrchestrationOptions;
  let mutationCalls: any[] = [];
  let queryCalls: any[] = [];

  beforeEach(() => {
    mutationCalls = [];
    queryCalls = [];

    // Mock Convex client
    mockConvex = {
      mutation: vi.fn().mockImplementation((name: string, args: any) => {
        mutationCalls.push({ name, args });
        // Return appropriate IDs based on mutation name
        if (name === 'tasks/createTask') return { id: 'task-123' };
        if (name === 'agentSessions/createAgentSession') return { id: `session-${Math.random()}` };
        if (name === 'plans/store') return { id: 'plan-123' };
        if (name === 'codeChanges/record') return { id: 'change-123' };
        if (name === 'reviews/store') return { id: 'review-123' };
        return {};
      }),
      query: vi.fn().mockImplementation((name: string, args?: any) => {
        queryCalls.push({ name, args });
        return Promise.resolve([]);
      }),
    };

    // Create agent instances with mocked dependencies
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

    // Mock environment
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

    // Mock createClient to return mock client
    vi.doMock('../../core/client', () => ({
      createClient: vi.fn(() => ({
        query: vi.fn(() => {
          // Return async generator
          return (async function* () {
            // Mock different responses for different agents
            yield { type: 'text', text: getMockResponseForAgent() };
          })();
        }),
      })),
    }));

    // Mock convexClient
    vi.doMock('../../core/convexClient', () => ({
      getConvexClient: () => mockConvex,
    }));

    // Mock agent execute methods to simulate real behavior
    mockAgentExecute(agents.planner as any, {
      success: true,
      output: '# Implementation Plan\n\n## Steps\n1. Create auth module\n2. Implement login',
      metadata: {
        plan: {
          steps: [
            { description: 'Create auth module', files: ['src/auth/index.ts'], estimatedComplexity: 'medium' },
          ],
        },
      },
    });

    mockAgentExecute(agents.coder as any, {
      success: true,
      output: 'Implementation complete. Created auth module and login function.',
      metadata: {
        codeChanges: [
          { filePath: 'src/auth/index.ts', changeType: 'create', summary: 'Create auth module' },
          { filePath: 'src/api/login.ts', changeType: 'create', summary: 'Create login endpoint' },
        ],
      },
    });

    mockAgentExecute(agents.reviewer as any, {
      success: true,
      output: 'Review passed. All acceptance criteria met.',
      metadata: {
        review: {
          status: 'passed',
          criteriaMet: true,
          feedback: 'All criteria met',
          issues: [],
        },
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  function getMockResponseForAgent(): string {
    // Simple mock - in real test, would check which agent is calling
    return 'Mock response';
  }

  function mockAgentExecute(agent: any, result: any) {
    agent.execute = vi.fn().mockResolvedValue(result);
  }

  describe('sequential agent execution', () => {
    it('should execute all three agents in order', async () => {
      const taskDescription = 'Implement user authentication system';

      const result = await orchestrateAgents(taskDescription, orchestrationOptions);

      // Verify all agents executed
      expect(agents.planner.execute).toHaveBeenCalledTimes(1);
      expect(agents.coder.execute).toHaveBeenCalledTimes(1);
      expect(agents.reviewer.execute).toHaveBeenCalledTimes(1);

      // Verify final status
      expect(result.status).toBe(TaskStatus.Completed);
      expect(result.agentResults).toHaveLength(3);
    });

    it('should create task in Convex before agent execution', async () => {
      const taskDescription = 'Implement user authentication system';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Find createTask mutation
      const createTaskCall = mutationCalls.find((call) => call.name === 'tasks/createTask');
      expect(createTaskCall).toBeDefined();
      expect(createTaskCall.args.description).toBe(taskDescription);

      // Should be the first mutation
      expect(mutationCalls[0].name).toBe('tasks/createTask');
    });
  });

  describe('context passing between agents', () => {
    it('should pass plan from Planner to Coder', async () => {
      const taskDescription = 'Implement user authentication system';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Get Coder execute call
      const coderCall = (agents.coder.execute as any).mock.calls[0];
      const coderContext = coderCall[0];

      // Verify plan is present
      expect(coderContext.plan).toBeDefined();
      expect(coderContext.plan?.content).toContain('Implementation Plan');
    });

    it('should pass code changes from Coder to Reviewer', async () => {
      const taskDescription = 'Implement user authentication system';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Get Reviewer execute call
      const reviewerCall = (agents.reviewer.execute as any).mock.calls[0];
      const reviewerContext = reviewerCall[0];

      // Verify code changes are present
      expect(reviewerContext.codeChanges).toBeDefined();
      expect(reviewerContext.codeChanges?.length).toBe(2);
      expect(reviewerContext.codeChanges?.[0].filePath).toBe('src/auth/index.ts');
    });

    it('should include previous sessions in context', async () => {
      const taskDescription = 'Implement user authentication system';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Check Coder context includes Planner session
      const coderContext = (agents.coder.execute as any).mock.calls[0][0];
      expect(coderContext.previousSessions).toBeDefined();
      expect(coderContext.previousSessions.length).toBeGreaterThan(0);

      // Check Reviewer context includes both Planner and Coder sessions
      const reviewerContext = (agents.reviewer.execute as any).mock.calls[0][0];
      expect(reviewerContext.previousSessions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Convex state management', () => {
    it('should store all agent sessions in Convex', async () => {
      const taskDescription = 'Implement user authentication system';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Find all createAgentSession mutations
      const sessionCreations = mutationCalls.filter(
        (call) => call.name === 'agentSessions/createAgentSession'
      );

      expect(sessionCreations).toHaveLength(3);

      // Verify agent types
      const agentTypes = sessionCreations.map((call) => call.args.agentType);
      expect(agentTypes).toContain('planner');
      expect(agentTypes).toContain('coder');
      expect(agentTypes).toContain('reviewer');
    });

    it('should store plan from Planner in Convex', async () => {
      const taskDescription = 'Implement user authentication system';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Find plan store call
      const planStoreCall = mutationCalls.find((call) => call.name === 'plans/store');
      expect(planStoreCall).toBeDefined();
      expect(planStoreCall.args.content).toContain('Implementation Plan');
    });

    it('should store code changes from Coder in Convex', async () => {
      const taskDescription = 'Implement user authentication system';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Find code change records
      const changeRecords = mutationCalls.filter(
        (call) => call.name === 'codeChanges/record'
      );

      expect(changeRecords.length).toBeGreaterThanOrEqual(2);
      expect(changeRecords[0].args.filePath).toBe('src/auth/index.ts');
    });

    it('should store review from Reviewer in Convex', async () => {
      const taskDescription = 'Implement user authentication system';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Find review store call
      const reviewStoreCall = mutationCalls.find((call) => call.name === 'reviews/store');
      expect(reviewStoreCall).toBeDefined();
      expect(reviewStoreCall.args.status).toBe('passed');
    });

    it('should update task status through workflow', async () => {
      const taskDescription = 'Implement user authentication system';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // Find status updates
      const statusUpdates = mutationCalls.filter(
        (call) => call.name === 'tasks/updateTaskStatus'
      );

      // Should have status updates for each phase
      expect(statusUpdates.length).toBeGreaterThan(0);

      // Check status sequence
      const statuses = statusUpdates.map((call) => call.args.status);
      expect(statuses).toContain('planning');
      expect(statuses).toContain('coding');
      expect(statuss).toContain('reviewing');
      expect(statuses).toContain('completed');
    });
  });

  describe('session lifecycle', () => {
    it('should update session statuses from pending -> running -> completed', async () => {
      const taskDescription = 'Implement user authentication system';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // For each agent, verify session lifecycle
      const startSessionCalls = mutationCalls.filter(
        (call) => call.name === 'agentSessions/startAgentSession'
      );
      const completeSessionCalls = mutationCalls.filter(
        (call) => call.name === 'agentSessions/completeAgentSession'
      );

      expect(startSessionCalls).toHaveLength(3);
      expect(completeSessionCalls).toHaveLength(3);
    });

    it('should associate sessions with task ID', async () => {
      const taskDescription = 'Implement user authentication system';

      await orchestrateAgents(taskDescription, orchestrationOptions);

      // All session operations should reference the task
      const sessionCalls = mutationCalls.filter((call) =>
        call.name.startsWith('agentSessions/')
      );

      sessionCalls.forEach((call) => {
        if (call.args.taskId) {
          expect(call.args.taskId).toBe('task-123');
        }
      });
    });
  });

  describe('error handling', () => {
    it('should store error and stop workflow if Planner fails', async () => {
      // Make Planner fail
      (agents.planner.execute as any) = vi.fn().mockResolvedValue({
        success: false,
        error: new Error('Planner failed'),
      });

      const taskDescription = 'Implement user authentication system';

      const result = await orchestrateAgents(taskDescription, orchestrationOptions);

      expect(result.status).toBe(TaskStatus.Failed);
      expect(result.error).toBeDefined();

      // Verify error was stored
      const errorCall = mutationCalls.find((call) => call.name === 'tasks/setTaskError');
      expect(errorCall).toBeDefined();

      // Coder and Reviewer should not execute
      expect(agents.coder.execute).not.toHaveBeenCalled();
      expect(agents.reviewer.execute).not.toHaveBeenCalled();
    });

    it('should handle Coder failure and skip Reviewer', async () => {
      // Make Coder fail
      (agents.coder.execute as any) = vi.fn().mockResolvedValue({
        success: false,
        error: new Error('Coder failed'),
      });

      const taskDescription = 'Implement user authentication system';

      const result = await orchestrateAgents(taskDescription, orchestrationOptions);

      expect(result.status).toBe(TaskStatus.Failed);

      // Planner should execute, Coder should fail, Reviewer should not execute
      expect(agents.planner.execute).toHaveBeenCalledTimes(1);
      expect(agents.coder.execute).toHaveBeenCalledTimes(1);
      expect(agents.reviewer.execute).not.toHaveBeenCalled();
    });
  });

  describe('special modes', () => {
    it('should only run Planner in plan-only mode', async () => {
      const taskDescription = 'Implement user authentication system';

      const result = await orchestrateAgents(taskDescription, {
        ...orchestrationOptions,
        planOnly: true,
      });

      expect(result.status).toBe(TaskStatus.Completed); // Planning is complete

      // Only Planner should execute
      expect(agents.planner.execute).toHaveBeenCalledTimes(1);
      expect(agents.coder.execute).not.toHaveBeenCalled();
      expect(agents.reviewer.execute).not.toHaveBeenCalled();
    });

    it('should skip Reviewer in skip-review mode', async () => {
      const taskDescription = 'Implement user authentication system';

      const result = await orchestrateAgents(taskDescription, {
        ...orchestrationOptions,
        skipReview: true,
      });

      expect(result.status).toBe(TaskStatus.Completed);

      // Planner and Coder should execute, Reviewer should not
      expect(agents.planner.execute).toHaveBeenCalledTimes(1);
      expect(agents.coder.execute).toHaveBeenCalledTimes(1);
      expect(agents.reviewer.execute).not.toHaveBeenCalled();
    });
  });
});
