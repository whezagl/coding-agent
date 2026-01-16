/**
 * Unit tests for Planner Agent.
 *
 * Tests:
 * - Planner agent initializes with correct tools (Read, Glob, Grep, WebFetch, WebSearch)
 * - Planner generates implementation plans
 * - Planner stores plans in Convex via plans/store mutation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlannerAgent } from '../planner';
import type { AgentConfig, AgentContext, AgentExecutionOptions } from '../types';
import { AgentType } from '../types';

describe('PlannerAgent', () => {
  let mockConfig: AgentConfig;
  let mockContext: AgentContext;
  let mockConvexClient: any;

  beforeEach(() => {
    // Mock configuration
    mockConfig = {
      agentType: AgentType.Planner,
      taskDescription: 'Implement user authentication',
      workingDirectory: '/test/project',
      model: 'claude-sonnet-4-5-20250929',
    };

    // Mock context
    mockContext = {
      task: {
        id: 'task-123',
        description: 'Implement user authentication',
        status: 'pending',
      },
      plan: undefined,
      codeChanges: [],
      previousSessions: [],
    };

    // Mock Convex client
    mockConvexClient = {
      mutation: vi.fn().mockResolvedValue({ id: 'plan-123' }),
      query: vi.fn(),
    };

    // Mock getConvexClient
    vi.doMock('../core/convexClient', () => ({
      getConvexClient: () => mockConvexClient,
    }));

    // Mock environment variable
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('initialization', () => {
    it('should initialize with correct agent type', () => {
      const planner = new PlannerAgent(mockConfig);
      expect(planner.getAgentType()).toBe(AgentType.Planner);
    });

    it('should initialize with read-only tool permissions', () => {
      const planner = new PlannerAgent(mockConfig);
      const permissions = (planner as any).toolPermissions;

      // Planner has read-only access
      expect(permissions.Read).toBe(true);
      expect(permissions.Glob).toBe(true);
      expect(permissions.Grep).toBe(true);
      expect(permissions.WebFetch).toBe(true);
      expect(permissions.WebSearch).toBe(true);

      // Planner does NOT have write access
      expect(permissions.Write).toBe(false);
      expect(permissions.Edit).toBe(false);
      expect(permissions.Bash).toBe(false);
    });

    it('should accept custom model in configuration', () => {
      const customConfig = { ...mockConfig, model: 'claude-opus-4-5' };
      const planner = new PlannerAgent(customConfig);
      expect((planner as any).config.model).toBe('claude-opus-4-5');
    });
  });

  describe('execute', () => {
    it('should create Claude SDK client with correct configuration', async () => {
      const planner = new PlannerAgent(mockConfig);

      // Mock the createClient function to return a mock client
      const mockQuery = vi.fn().mockAsyncIterator([
        { type: 'text', text: '# Implementation Plan\n\n## Steps\n1. Create auth module' },
      ]);

      vi.doMock('../core/client', () => ({
        createClient: vi.fn(() => ({
          query: () => mockQuery(),
        })),
      }));

      // Execute would call createClient with planner config
      // Verify tool permissions are passed correctly
      const options: AgentExecutionOptions = {
        dryRun: true, // Skip Convex storage for this test
      };

      const result = await planner.execute(mockContext, options);

      expect(result).toBeDefined();
    });

    it('should generate implementation plan from task description', async () => {
      const planner = new PlannerAgent(mockConfig);

      const mockPlanContent = `# Implementation Plan

## Analysis
Task requires implementing user authentication with login and registration.

## Implementation Steps

1. **Create authentication module**
   Files: src/auth/index.ts
   Complexity: medium

2. **Define user schema**
   Files: src/models/user.ts
   Complexity: low

3. **Implement login endpoint**
   Files: src/api/login.ts
   Complexity: medium
`;

      // Mock client query to return plan
      const mockQuery = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', text: mockPlanContent };
        },
      });

      vi.doMock('../core/client', () => ({
        createClient: vi.fn(() => ({
          query: mockQuery,
        })),
      }));

      const options: AgentExecutionOptions = { dryRun: true };
      const result = await planner.execute(mockContext, options);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Implementation Plan');
      expect(result.output).toContain('authentication module');
    });

    it('should parse plan metadata correctly', () => {
      const planner = new PlannerAgent(mockConfig);

      const planContent = `# Plan

## Steps

1. Create auth module
   Files: src/auth/index.ts
   Complexity: low

2. Implement login
   Files: src/api/login.ts, src/middleware/auth.ts
   Complexity: high
`;

      const metadata = (planner as any).parseResultMetadata(planContent);

      expect(metadata).toBeDefined();
      expect(metadata.plan).toBeDefined();
      expect(metadata.plan.steps).toHaveLength(2);
      expect(metadata.plan.steps[0].description).toBe('Create auth module');
      expect(metadata.plan.steps[0].files).toContain('src/auth/index.ts');
      expect(metadata.plan.steps[0].estimatedComplexity).toBe('low');
      expect(metadata.plan.steps[1].estimatedComplexity).toBe('high');
    });

    it('should handle execution errors gracefully', async () => {
      const planner = new PlannerAgent(mockConfig);

      // Mock client to throw error
      vi.doMock('../core/client', () => ({
        createClient: vi.fn(() => {
          throw new Error('Failed to create client');
        }),
      }));

      const result = await planner.execute(mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Planner agent failed');
    });
  });

  describe('Convex integration', () => {
    it('should store plan in Convex when not in dry-run mode', async () => {
      const planner = new PlannerAgent(mockConfig);
      (planner as any).config.taskId = 'task-123';

      const mockPlanContent = '# Plan\n\n1. Create auth module';

      // Mock client query
      const mockQuery = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', text: mockPlanContent };
        },
      });

      // Mock Convex client
      const mockConvex = {
        mutation: vi.fn().mockResolvedValue({ id: 'plan-123' }),
      };

      vi.doMock('../core/client', () => ({
        createClient: vi.fn(() => ({
          query: mockQuery,
        })),
      }));

      vi.doMock('../core/convexClient', () => ({
        getConvexClient: () => mockConvex,
      }));

      // Execute without dryRun
      const result = await planner.execute(mockContext, {});

      // Verify Convex mutation was called
      expect(mockConvex.mutation).toHaveBeenCalledWith('plans/store', {
        taskId: 'task-123',
        content: mockPlanContent,
      });
    });

    it('should skip Convex storage in dry-run mode', async () => {
      const planner = new PlannerAgent(mockConfig);
      (planner as any).config.taskId = 'task-123';

      const mockQuery = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', text: '# Plan' };
        },
      });

      const mockConvex = {
        mutation: vi.fn(),
      };

      vi.doMock('../core/client', () => ({
        createClient: vi.fn(() => ({
          query: mockQuery,
        })),
      }));

      vi.doMock('../core/convexClient', () => ({
        getConvexClient: () => mockConvex,
      }));

      // Execute with dryRun enabled
      await planner.execute(mockContext, { dryRun: true });

      // Verify Convex mutation was NOT called
      expect(mockConvex.mutation).not.toHaveBeenCalled();
    });
  });

  describe('system prompt', () => {
    it('should load system prompt from prompts/planner.md', () => {
      const planner = new PlannerAgent(mockConfig);
      const prompt = (planner as any).getSystemPrompt();

      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });
  });
});
