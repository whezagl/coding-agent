/**
 * Unit tests for Convex task management functions.
 *
 * Tests:
 * - Tasks persist to Convex via createTask mutation
 * - Agent sessions persist via createAgentSession mutation
 * - Query functions (getTask, getTasks, getAgentSessionsByTask) return data
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTask,
  updateTaskStatus,
  setTaskError,
  clearTaskError,
  getTask,
  getTasks,
  getTasksByStatus,
  getLatestTask,
  getLatestIncompleteTask,
} from '../tasks';
import {
  createAgentSession,
  startAgentSession,
  completeAgentSession,
  failAgentSession,
  getAgentSession,
  getAgentSessionsByTask,
  getAgentSessionsByStatus,
} from '../agentSessions';

// Mock Convex server functions
const mockCtx = {
  db: {
    insert: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    query: vi.fn(),
  },
};

describe('Convex Task Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTask mutation', () => {
    it('should create a new task with pending status', async () => {
      const mockTaskId = 'task-123';
      mockCtx.db.insert.mockResolvedValue(mockTaskId);

      const description = 'Implement user authentication';
      const result = await createTask.handler(mockCtx as any, { description });

      expect(mockCtx.db.insert).toHaveBeenCalledWith('tasks', {
        description,
        status: 'pending',
        createdAt: expect.any(Number),
        retryCount: 0,
      });
      expect(result).toBe(mockTaskId);
    });

    it('should initialize retryCount to 0', async () => {
      mockCtx.db.insert.mockResolvedValue('task-123');

      await createTask.handler(mockCtx as any, { description: 'Test task' });

      const insertArgs = mockCtx.db.insert.mock.calls[0][1];
      expect(insertArgs.retryCount).toBe(0);
    });
  });

  describe('updateTaskStatus mutation', () => {
    it('should update task status', async () => {
      const mockTaskId = 'task-123' as any;
      mockCtx.db.patch.mockResolvedValue({ id: mockTaskId });

      await updateTaskStatus.handler(mockCtx as any, {
        taskId: mockTaskId,
        status: 'in_progress',
      });

      expect(mockCtx.db.patch).toHaveBeenCalledWith(mockTaskId, {
        status: 'in_progress',
      });
    });

    it('should support all valid status values', async () => {
      const statuses = ['pending', 'planning', 'coding', 'reviewing', 'completed', 'failed'];

      for (const status of statuses) {
        mockCtx.db.patch.mockResolvedValue({ id: 'task-123' });

        await updateTaskStatus.handler(mockCtx as any, {
          taskId: 'task-123' as any,
          status,
        });

        expect(mockCtx.db.patch).toHaveBeenCalledWith('task-123' as any, {
          status,
        });
      }
    });
  });

  describe('setTaskError mutation', () => {
    it('should set error and increment retry count', async () => {
      const mockTaskId = 'task-123' as any;
      const mockTask = {
        id: mockTaskId,
        retryCount: 2,
      };
      mockCtx.db.get.mockResolvedValue(mockTask);
      mockCtx.db.patch.mockResolvedValue({ ...mockTask, retryCount: 3 });

      const errorMessage = 'Agent execution failed';

      await setTaskError.handler(mockCtx as any, {
        taskId: mockTaskId,
        error: errorMessage,
      });

      expect(mockCtx.db.get).toHaveBeenCalledWith(mockTaskId);
      expect(mockCtx.db.patch).toHaveBeenCalledWith(mockTaskId, {
        error: errorMessage,
        status: 'failed',
        retryCount: 3,
      });
    });

    it('should throw error when task not found', async () => {
      mockCtx.db.get.mockResolvedValue(null);

      await expect(
        setTaskError.handler(mockCtx as any, {
          taskId: 'nonexistent' as any,
          error: 'Test error',
        })
      ).rejects.toThrow('Task not found');
    });

    it('should initialize retry count if not present', async () => {
      const mockTaskId = 'task-123' as any;
      const mockTask = {
        id: mockTaskId,
        retryCount: undefined,
      };
      mockCtx.db.get.mockResolvedValue(mockTask);
      mockCtx.db.patch.mockResolvedValue({});

      await setTaskError.handler(mockCtx as any, {
        taskId: mockTaskId,
        error: 'Error',
      });

      expect(mockCtx.db.patch).toHaveBeenCalledWith(mockTaskId, {
        error: 'Error',
        status: 'failed',
        retryCount: 1,
      });
    });
  });

  describe('clearTaskError mutation', () => {
    it('should clear error and reset status to pending', async () => {
      const mockTaskId = 'task-123' as any;
      mockCtx.db.patch.mockResolvedValue({ id: mockTaskId });

      await clearTaskError.handler(mockCtx as any, { taskId: mockTaskId });

      expect(mockCtx.db.patch).toHaveBeenCalledWith(mockTaskId, {
        error: undefined,
        status: 'pending',
      });
    });
  });

  describe('getTask query', () => {
    it('should retrieve task by ID', async () => {
      const mockTask = {
        id: 'task-123' as any,
        description: 'Test task',
        status: 'pending',
      };
      mockCtx.db.get.mockResolvedValue(mockTask);

      const result = await getTask.handler(mockCtx as any, {
        taskId: 'task-123' as any,
      });

      expect(mockCtx.db.get).toHaveBeenCalledWith('task-123' as any);
      expect(result).toEqual(mockTask);
    });

    it('should return null for non-existent task', async () => {
      mockCtx.db.get.mockResolvedValue(null);

      const result = await getTask.handler(mockCtx as any, {
        taskId: 'nonexistent' as any,
      });

      expect(result).toBeNull();
    });
  });

  describe('getTasks query', () => {
    it('should return all tasks', async () => {
      const mockTasks = [
        { id: 'task-1', description: 'Task 1', status: 'pending' },
        { id: 'task-2', description: 'Task 2', status: 'completed' },
      ];

      const mockQueryChain = {
        collect: vi.fn().mockResolvedValue(mockTasks),
      };
      mockCtx.db.query.mockReturnValue(mockQueryChain);

      const result = await getTasks.handler(mockCtx as any);

      expect(mockCtx.db.query).toHaveBeenCalledWith('tasks');
      expect(mockQueryChain.collect).toHaveBeenCalled();
      expect(result).toEqual(mockTasks);
    });
  });

  describe('getTasksByStatus query', () => {
    it('should filter tasks by status', async () => {
      const mockTasks = [
        { id: 'task-1', description: 'Task 1', status: 'pending' },
        { id: 'task-2', description: 'Task 2', status: 'pending' },
      ];

      const mockIndexChain = {
        eq: vi.fn().mockReturnThis(),
        collect: vi.fn().mockResolvedValue(mockTasks),
      };
      const mockQueryChain = {
        withIndex: vi.fn().mockReturnValue(mockIndexChain),
      };
      mockCtx.db.query.mockReturnValue(mockQueryChain);

      const result = await getTasksByStatus.handler(mockCtx as any, {
        status: 'pending',
      });

      expect(mockCtx.db.query).toHaveBeenCalledWith('tasks');
      expect(mockQueryChain.withIndex).toHaveBeenCalledWith('by_status', expect.any(Function));
      expect(result).toEqual(mockTasks);
    });
  });

  describe('getLatestTask query', () => {
    it('should return the most recent task', async () => {
      const mockTask = {
        id: 'task-123',
        description: 'Latest task',
        status: 'pending',
      };

      const mockOrderChain = {
        order: vi.fn().mockReturnThis(),
        take: vi.fn().mockResolvedValue([mockTask]),
      };
      const mockIndexChain = {
        withIndex: vi.fn().mockReturnValue(mockOrderChain),
      };
      const mockQueryChain = {
        query: vi.fn().mockReturnValue(mockIndexChain),
      };

      // Mock the db.query to return the chain
      mockCtx.db.query = vi.fn().mockReturnValue(mockIndexChain);

      const result = await getLatestTask.handler(mockCtx as any);

      expect(mockCtx.db.query).toHaveBeenCalledWith('tasks');
      expect(result).toEqual(mockTask);
    });

    it('should return null when no tasks exist', async () => {
      const mockOrderChain = {
        order: vi.fn().mockReturnThis(),
        take: vi.fn().mockResolvedValue([]),
      };
      const mockIndexChain = {
        withIndex: vi.fn().mockReturnValue(mockOrderChain),
      };

      mockCtx.db.query = vi.fn().mockReturnValue(mockIndexChain);

      const result = await getLatestTask.handler(mockCtx as any);

      expect(result).toBeNull();
    });
  });

  describe('getLatestIncompleteTask query', () => {
    it('should return the most recent incomplete task', async () => {
      const mockTasks = [
        {
          id: 'task-123',
          description: 'Incomplete task',
          status: 'pending',
          createdAt: 1000,
        },
        {
          id: 'task-456',
          description: 'Older task',
          status: 'failed',
          createdAt: 500,
        },
      ];

      const mockFilterChain = {
        filter: vi.fn().mockReturnThis(),
        collect: vi.fn().mockResolvedValue(mockTasks),
      };
      const mockIndexChain = {
        withIndex: vi.fn().mockReturnValue(mockFilterChain),
      };

      mockCtx.db.query = vi.fn().mockReturnValue(mockIndexChain);

      const result = await getLatestIncompleteTask.handler(mockCtx as any);

      expect(mockCtx.db.query).toHaveBeenCalledWith('tasks');
      expect(result).toEqual(mockTasks[0]); // Most recent incomplete task
    });

    it('should return null when all tasks are completed', async () => {
      const mockTasks = [
        { id: 'task-1', status: 'completed', createdAt: 1000 },
        { id: 'task-2', status: 'completed', createdAt: 500 },
      ];

      const mockFilterChain = {
        filter: vi.fn().mockReturnThis(),
        collect: vi.fn().mockResolvedValue(mockTasks),
      };
      const mockIndexChain = {
        withIndex: vi.fn().mockReturnValue(mockFilterChain),
      };

      mockCtx.db.query = vi.fn().mockReturnValue(mockIndexChain);

      // Filter out completed tasks - returns empty array
      mockFilterChain.collect = vi.fn().mockResolvedValue([]);

      const result = await getLatestIncompleteTask.handler(mockCtx as any);

      expect(result).toBeNull();
    });
  });
});

describe('Convex Agent Session Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createAgentSession mutation', () => {
    it('should create a new agent session', async () => {
      const mockSessionId = 'session-123';
      mockCtx.db.insert.mockResolvedValue(mockSessionId);

      const result = await createAgentSession.handler(mockCtx as any, {
        taskId: 'task-123' as any,
        agentType: 'planner',
      });

      expect(mockCtx.db.insert).toHaveBeenCalledWith('agentSessions', {
        taskId: 'task-123' as any,
        agentType: 'planner',
        status: 'pending',
        startedAt: expect.any(Number),
        completedAt: undefined,
      });
      expect(result).toBe(mockSessionId);
    });
  });

  describe('startAgentSession mutation', () => {
    it('should update session status to running', async () => {
      const mockSessionId = 'session-123' as any;
      mockCtx.db.patch.mockResolvedValue({ id: mockSessionId });

      await startAgentSession.handler(mockCtx as any, {
        sessionId: mockSessionId,
      });

      expect(mockCtx.db.patch).toHaveBeenCalledWith(mockSessionId, {
        status: 'running',
      });
    });
  });

  describe('completeAgentSession mutation', () => {
    it('should update session with result and completed status', async () => {
      const mockSessionId = 'session-123' as any;
      const result = 'Agent completed successfully';
      mockCtx.db.patch.mockResolvedValue({ id: mockSessionId });

      await completeAgentSession.handler(mockCtx as any, {
        sessionId: mockSessionId,
        result,
      });

      expect(mockCtx.db.patch).toHaveBeenCalledWith(mockSessionId, {
        status: 'completed',
        result,
        completedAt: expect.any(Number),
      });
    });
  });

  describe('failAgentSession mutation', () => {
    it('should update session with error and failed status', async () => {
      const mockSessionId = 'session-123' as any;
      const error = 'Agent execution failed';
      mockCtx.db.patch.mockResolvedValue({ id: mockSessionId });

      await failAgentSession.handler(mockCtx as any, {
        sessionId: mockSessionId,
        error,
      });

      expect(mockCtx.db.patch).toHaveBeenCalledWith(mockSessionId, {
        status: 'failed',
        error,
        completedAt: expect.any(Number),
      });
    });
  });

  describe('getAgentSession query', () => {
    it('should retrieve session by ID', async () => {
      const mockSession = {
        id: 'session-123' as any,
        agentType: 'planner',
        status: 'completed',
      };
      mockCtx.db.get.mockResolvedValue(mockSession);

      const result = await getAgentSession.handler(mockCtx as any, {
        sessionId: 'session-123' as any,
      });

      expect(mockCtx.db.get).toHaveBeenCalledWith('session-123' as any);
      expect(result).toEqual(mockSession);
    });
  });

  describe('getAgentSessionsByTask query', () => {
    it('should retrieve all sessions for a task', async () => {
      const mockSessions = [
        {
          id: 'session-1',
          agentType: 'planner',
          taskId: 'task-123',
        },
        {
          id: 'session-2',
          agentType: 'coder',
          taskId: 'task-123',
        },
      ];

      const mockCollectChain = {
        collect: vi.fn().mockResolvedValue(mockSessions),
      };
      const mockFilterChain = {
        filter: vi.fn().mockReturnValue(mockCollectChain),
      };
      const mockQueryChain = {
        query: vi.fn().mockReturnValue(mockFilterChain),
      };

      mockCtx.db.query = vi.fn().mockReturnValue(mockFilterChain);

      const result = await getAgentSessionsByTask.handler(mockCtx as any, {
        taskId: 'task-123' as any,
      });

      expect(result).toEqual(mockSessions);
      expect(result).toHaveLength(2);
    });
  });

  describe('getAgentSessionsByStatus query', () => {
    it('should filter sessions by status', async () => {
      const mockSessions = [
        {
          id: 'session-1',
          agentType: 'planner',
          status: 'running',
        },
        {
          id: 'session-2',
          agentType: 'coder',
          status: 'running',
        },
      ];

      const mockEqChain = {
        eq: vi.fn().mockReturnThis(),
        collect: vi.fn().mockResolvedValue(mockSessions),
      };
      const mockIndexChain = {
        withIndex: vi.fn().mockReturnValue(mockEqChain),
      };

      mockCtx.db.query = vi.fn().mockReturnValue(mockIndexChain);

      const result = await getAgentSessionsByStatus.handler(mockCtx as any, {
        status: 'running',
      });

      expect(result).toEqual(mockSessions);
    });
  });
});
