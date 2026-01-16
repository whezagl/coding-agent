/**
 * Unit tests for Coder Agent.
 *
 * Tests:
 * - Coder agent initializes with correct tools (Read, Write, Edit, Bash)
 * - Coder executes code changes based on plan
 * - Coder tracks changes in Convex codeChanges table
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CoderAgent } from '../coder';
import type { AgentConfig, AgentContext, AgentExecutionOptions } from '../types';
import { AgentType, ChangeType } from '../types';

describe('CoderAgent', () => {
  let mockConfig: AgentConfig;
  let mockContext: AgentContext;
  let mockConvexClient: any;

  beforeEach(() => {
    // Mock configuration
    mockConfig = {
      agentType: AgentType.Coder,
      taskDescription: 'Implement user authentication',
      workingDirectory: '/test/project',
      model: 'claude-sonnet-4-5-20250929',
    };

    // Mock context with plan from Planner
    mockContext = {
      task: {
        id: 'task-123',
        description: 'Implement user authentication',
        status: 'planning',
      },
      plan: {
        content: '# Implementation Plan\n\n1. Create auth module\n2. Implement login',
        createdAt: new Date(),
      },
      codeChanges: [],
      previousSessions: [],
    };

    // Mock Convex client
    mockConvexClient = {
      mutation: vi.fn().mockResolvedValue({ id: 'change-123' }),
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
      const coder = new CoderAgent(mockConfig);
      expect(coder.getAgentType()).toBe(AgentType.Coder);
    });

    it('should initialize with read + write tool permissions', () => {
      const coder = new CoderAgent(mockConfig);
      const permissions = (coder as any).toolPermissions;

      // Coder has read access
      expect(permissions.Read).toBe(true);
      expect(permissions.Glob).toBe(true);
      expect(permissions.Grep).toBe(true);
      expect(permissions.WebFetch).toBe(true);
      expect(permissions.WebSearch).toBe(true);

      // Coder also has write access
      expect(permissions.Write).toBe(true);
      expect(permissions.Edit).toBe(true);
      expect(permissions.Bash).toBe(true);
    });
  });

  describe('execute', () => {
    it('should validate plan presence before execution', async () => {
      const coder = new CoderAgent(mockConfig);

      // Context without plan
      const contextWithoutPlan: AgentContext = {
        ...mockContext,
        plan: undefined,
      };

      const result = await coder.execute(contextWithoutPlan);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('plan');
    });

    it('should execute code changes based on plan', async () => {
      const coder = new CoderAgent(mockConfig);

      const mockOutput = `I'll implement the authentication system based on the plan.

<write>
<path>src/auth/index.ts</path>
<content>export function login() { ... }</content>
</write>

<edit>
<path>src/index.ts</path>
<diff>- import { oldFunc }
+ import { login } from './auth';
+ export { login };</diff>
</edit>
`;

      // Mock client query to return execution result
      const mockQuery = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', text: mockOutput };
        },
      });

      vi.doMock('../core/client', () => ({
        createClient: vi.fn(() => ({
          query: mockQuery,
        })),
      }));

      const options: AgentExecutionOptions = { dryRun: true };
      const result = await coder.execute(mockContext, options);

      expect(result.success).toBe(true);
      expect(result.output).toContain('authentication');
    });

    it('should track code changes during execution', () => {
      const coder = new CoderAgent(mockConfig);

      // Simulate tracking changes
      (coder as any).trackedChanges = [];

      // Track a write operation
      (coder as any).trackChange('src/auth/index.ts', ChangeType.Create, 'Create auth module');

      // Track an edit operation
      (coder as any).trackChange('src/index.ts', ChangeType.Edit, 'Import auth module');

      const changes = (coder as any).trackedChanges;

      expect(changes).toHaveLength(2);
      expect(changes[0]).toEqual({
        filePath: 'src/auth/index.ts',
        changeType: ChangeType.Create,
        summary: 'Create auth module',
      });
      expect(changes[1]).toEqual({
        filePath: 'src/index.ts',
        changeType: ChangeType.Edit,
        summary: 'Import auth module',
      });
    });

    it('should parse code changes from output', () => {
      const coder = new CoderAgent(mockConfig);

      const output = `Created 3 files, modified 2 files.

Changes:
- src/auth/index.ts (create)
- src/models/user.ts (create)
- src/api/login.ts (create)
- src/index.ts (edit)
- src/app.ts (edit)`;

      const metadata = (coder as any).parseResultMetadata(output);

      expect(metadata).toBeDefined();
      expect(metadata.codeChanges).toBeDefined();
      expect(metadata.codeChanges.length).toBeGreaterThan(0);
    });

    it('should handle execution errors gracefully', async () => {
      const coder = new CoderAgent(mockConfig);

      // Mock client to throw error
      vi.doMock('../core/client', () => ({
        createClient: vi.fn(() => {
          throw new Error('File write failed');
        }),
      }));

      const result = await coder.execute(mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Convex integration', () => {
    it('should store tracked changes in Convex codeChanges table', async () => {
      const coder = new CoderAgent(mockConfig);
      (coder as any).config.taskId = 'task-123';

      const mockOutput = 'Implementation complete';

      const mockQuery = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', text: mockOutput };
        },
      });

      const mockConvex = {
        mutation: vi.fn().mockResolvedValue({ id: 'change-123' }),
        query: vi.fn().mockResolvedValue([
          {
            sessionId: 'session-123',
            agentType: 'planner',
            result: '# Plan content',
          },
        ]),
      };

      // Create a mock agent session ID
      const mockAgentSessionId = 'session-coder-123';

      vi.doMock('../core/client', () => ({
        createClient: vi.fn(() => ({
          query: mockQuery,
        })),
      }));

      vi.doMock('../core/convexClient', () => ({
        getConvexClient: () => mockConvex,
      }));

      // Manually track some changes
      (coder as any).trackedChanges = [
        {
          filePath: 'src/auth/index.ts',
          changeType: ChangeType.Create,
          summary: 'Create authentication module',
        },
        {
          filePath: 'src/index.ts',
          changeType: ChangeType.Edit,
          summary: 'Import auth functions',
        },
      ];

      // Execute
      const options: AgentExecutionOptions = {
        agentSessionId: mockAgentSessionId,
      };

      const result = await coder.execute(mockContext, options);

      // Verify codeChanges mutations were called
      expect(mockConvex.mutation).toHaveBeenCalledWith('codeChanges/record', {
        taskId: 'task-123',
        agentSessionId: mockAgentSessionId,
        filePath: 'src/auth/index.ts',
        changeType: 'create',
        summary: 'Create authentication module',
      });

      expect(mockConvex.mutation).toHaveBeenCalledWith('codeChanges/record', {
        taskId: 'task-123',
        agentSessionId: mockAgentSessionId,
        filePath: 'src/index.ts',
        changeType: 'edit',
        summary: 'Import auth functions',
      });
    });

    it('should skip Convex storage in dry-run mode', async () => {
      const coder = new CoderAgent(mockConfig);
      (coder as any).config.taskId = 'task-123';

      const mockQuery = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', text: 'Implementation complete' };
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

      // Execute with dryRun
      await coder.execute(mockContext, { dryRun: true });

      // Verify mutations were NOT called
      expect(mockConvex.mutation).not.toHaveBeenCalled();
    });
  });

  describe('change type parsing', () => {
    it('should detect git rm commands as delete operations', () => {
      const coder = new CoderAgent(mockConfig);

      const gitCommands = 'git rm old-file.ts\ngit rm unused.ts';
      const detectedDeletes = (coder as any).detectGitDeletes(gitCommands);

      expect(detectedDeletes).toContain('old-file.ts');
      expect(detectedDeletes).toContain('unused.ts');
    });

    it('should detect git mv commands as rename operations', () => {
      const coder = new CoderAgent(mockConfig);

      const gitCommands = 'git mv old.ts new.ts\ngit mv file1.ts file2.ts';
      const detectedRenames = (coder as any).detectGitRenames(gitCommands);

      expect(detectedRenames.length).toBeGreaterThan(0);
    });
  });

  describe('system prompt', () => {
    it('should load system prompt from prompts/coder.md', () => {
      const coder = new CoderAgent(mockConfig);
      const prompt = (coder as any).getSystemPrompt();

      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });
  });
});
