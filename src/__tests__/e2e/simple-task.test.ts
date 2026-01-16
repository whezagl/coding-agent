/**
 * End-to-end test for simple task execution.
 *
 * Tests:
 * - Run CLI with simple task
 * - Verify: All three agents execute
 * - Verify: Result stored in Convex
 *
 * Requires:
 * - Real Convex backend (via Docker Compose)
 * - Claude API key
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'convex/client';

describe('Simple Task E2E', () => {
  let convexClient: Client;
  let taskId: string;

  beforeAll(async () => {
    // Verify environment is set up
    expect(process.env.ANTHROPIC_API_KEY).toBeDefined();
    expect(process.env.CONVEX_SELF_HOSTED_URL).toBeDefined();
    expect(process.env.CONVEX_SELF_HOSTED_ADMIN_KEY).toBeDefined();

    // Initialize Convex client
    convexClient = new Client(process.env.CONVEX_SELF_HOSTED_URL!, {
      async unsafelyGetAuthToken() {
        return process.env.CONVEX_SELF_HOSTED_ADMIN_KEY!;
      },
    });
  });

  afterAll(() => {
    if (convexClient) {
      convexClient.close();
    }
  });

  describe('CLI execution', () => {
    it('should run CLI with simple task and execute all agents', { timeout: 120000 }, async () => {
      const taskDescription = 'Create a hello world function in src/hello.ts';

      // Run CLI with simple task
      const cliProcess = spawn('npm', ['start', '--', '--task', taskDescription], {
        env: process.env,
        cwd: process.cwd(),
      });

      let output = '';
      let errorOutput = '';

      cliProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      cliProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      // Wait for CLI to complete
      await new Promise<void>((resolve, reject) => {
        cliProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`CLI exited with code ${code}\nError: ${errorOutput}`));
          }
        });

        // Timeout after 2 minutes
        setTimeout(() => {
          cliProcess.kill();
          reject(new Error('CLI timeout after 2 minutes'));
        }, 120000);
      });

      // Verify output contains agent progress
      expect(output).toContain('Planner');
      expect(output).toContain('Coder');
      expect(output).toContain('Reviewer');
    });

    it('should create task in Convex', { timeout: 30000 }, async () => {
      // Query Convex for the latest task
      const tasks = await convexClient.query('tasks:getLatestTask', {});

      expect(tasks).toBeDefined();
      taskId = tasks?.id as string;

      // Verify task was created
      expect(taskId).toBeDefined();

      // Verify task details
      const task = await convexClient.query('tasks:getTask', { taskId });
      expect(task).toBeDefined();
      expect(task.description).toContain('hello world');
    });
  });

  describe('agent execution verification', () => {
    it('should verify Planner agent executed', { timeout: 30000 }, async () => {
      // Get agent sessions for the task
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      expect(sessions).toBeDefined();
      expect(sessions.length).toBeGreaterThanOrEqual(1);

      // Find Planner session
      const plannerSession = sessions.find((s: any) => s.agentType === 'planner');
      expect(plannerSession).toBeDefined();
      expect(plannerSession.status).toBe('completed');

      // Verify plan was stored
      const plan = await convexClient.query('plans:getPlanForTask', { taskId });
      expect(plan).toBeDefined();
      expect(plan.content).toBeDefined();
    });

    it('should verify Coder agent executed', { timeout: 30000 }, async () => {
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      // Find Coder session
      const coderSession = sessions.find((s: any) => s.agentType === 'coder');
      expect(coderSession).toBeDefined();
      expect(coderSession.status).toBe('completed');

      // Verify code changes were tracked
      const changes = await convexClient.query('codeChanges:getByTask', { taskId });
      expect(changes).toBeDefined();
      expect(changes.length).toBeGreaterThan(0);
    });

    it('should verify Reviewer agent executed', { timeout: 30000 }, async () => {
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      // Find Reviewer session
      const reviewerSession = sessions.find((s: any) => s.agentType === 'reviewer');
      expect(reviewerSession).toBeDefined();
      expect(reviewerSession.status).toBe('completed');

      // Verify review was stored
      const review = await convexClient.query('reviews:getReviewForTask', { taskId });
      expect(review).toBeDefined();
      expect(review.status).toMatch(/passed|failed|needs_revision/);
    });
  });

  describe('result verification', () => {
    it('should verify task completed successfully', { timeout: 30000 }, async () => {
      const task = await convexClient.query('tasks:getTask', { taskId });

      expect(task.status).toBe('completed');
      expect(task.error).toBeUndefined();
    });

    it('should verify file was created', { timeout: 30000 }, async () => {
      // Check if hello.ts exists
      const helloPath = join(process.cwd(), 'src', 'hello.ts');

      let fileExists = false;
      try {
        readFileSync(helloPath, 'utf-8');
        fileExists = true;
      } catch {
        fileExists = false;
      }

      expect(fileExists).toBe(true);
    });

    it('should verify all agent sessions completed', { timeout: 30000 }, async () => {
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      // All sessions should be completed
      sessions.forEach((session: any) => {
        expect(session.status).toBe('completed');
        expect(session.completedAt).toBeDefined();
      });
    });
  });

  describe('sequential execution order', () => {
    it('should verify agents executed in correct order', { timeout: 30000 }, async () => {
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      // Sort by startedAt
      const sortedSessions = [...sessions].sort(
        (a: any, b: any) => a.startedAt - b.startedAt
      );

      // Verify order: Planner → Coder → Reviewer
      expect(sortedSessions[0].agentType).toBe('planner');
      expect(sortedSessions[1].agentType).toBe('coder');
      expect(sortedSessions[2].agentType).toBe('reviewer');
    });
  });
});
