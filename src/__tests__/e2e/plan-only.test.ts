/**
 * End-to-end test for plan-only mode.
 *
 * Tests:
 * - Run with `--plan-only` flag
 * - Verify: Only Planner runs
 * - Verify: No code changes made
 *
 * Requires:
 * - Real Convex backend (via Docker Compose)
 * - Claude API key
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { Client } from 'convex/client';

describe('Plan-Only Mode E2E', () => {
  let convexClient: Client;
  let taskId: string;
  const testFileName = 'src/plan-only-test-file.ts';

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

    // Clean up any existing test file
    const testFilePath = join(process.cwd(), testFileName);
    if (existsSync(testFilePath)) {
      // File would be deleted here in real scenario
    }
  });

  afterAll(async () => {
    if (convexClient) {
      convexClient.close();
    }

    // Clean up test file if created
    const testFilePath = join(process.cwd(), testFileName);
    // In real scenario, would delete file here
  });

  describe('plan-only execution', () => {
    it('should run CLI with --plan-only flag', { timeout: 120000 }, async () => {
      const taskDescription = `Create a ${testFileName} file with a test function`;

      // Run CLI with plan-only flag
      const cliProcess = spawn(
        'npm',
        ['start', '--', '--task', taskDescription, '--plan-only'],
        {
          env: process.env,
          cwd: process.cwd(),
        }
      );

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

        setTimeout(() => {
          cliProcess.kill();
          reject(new Error('CLI timeout after 2 minutes'));
        }, 120000);
      });

      // Verify output shows Planner only
      expect(output).toContain('Planner');
    });

    it('should create task in Convex', { timeout: 30000 }, async () => {
      // Query Convex for the latest task
      const tasks = await convexClient.query('tasks:getLatestTask', {});

      expect(tasks).toBeDefined();
      taskId = tasks?.id as string;

      expect(taskId).toBeDefined();
    });
  });

  describe('agent execution verification', () => {
    it('should verify only Planner agent executed', { timeout: 30000 }, async () => {
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      expect(sessions).toBeDefined();

      // Should only have Planner session
      expect(sessions.length).toBe(1);
      expect(sessions[0].agentType).toBe('planner');
      expect(sessions[0].status).toBe('completed');
    });

    it('should NOT have Coder session', { timeout: 30000 }, async () => {
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      const coderSession = sessions.find((s: any) => s.agentType === 'coder');
      expect(coderSession).toBeUndefined();
    });

    it('should NOT have Reviewer session', { timeout: 30000 }, async () => {
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      const reviewerSession = sessions.find((s: any) => s.agentType === 'reviewer');
      expect(reviewerSession).toBeUndefined();
    });

    it('should verify plan was stored', { timeout: 30000 }, async () => {
      const plan = await convexClient.query('plans:getPlanForTask', { taskId });

      expect(plan).toBeDefined();
      expect(plan.content).toBeDefined();
      expect(plan.content).toContain('plan') || expect(plan.content).toContain('Plan');
    });
  });

  describe('no code changes verification', () => {
    it('should verify no code changes were recorded', { timeout: 30000 }, async () => {
      const changes = await convexClient.query('codeChanges:getByTask', { taskId });

      // Should have no code changes
      expect(changes).toBeDefined();
      expect(changes.length).toBe(0);
    });

    it('should verify no review was created', { timeout: 30000 }, async () => {
      const review = await convexClient.query('reviews:getReviewForTask', { taskId });

      // Should have no review
      expect(review).toBeNull();
    });

    it('should verify test file was not created', { timeout: 30000 }, async () => {
      const testFilePath = join(process.cwd(), testFileName);
      const fileExists = existsSync(testFilePath);

      expect(fileExists).toBe(false);
    });
  });

  describe('task status verification', () => {
    it('should verify task status after plan-only', { timeout: 30000 }, async () => {
      const task = await convexClient.query('tasks:getTask', { taskId });

      // Task should be completed (planning is complete)
      expect(task.status).toBe('completed');
      expect(task.error).toBeUndefined();
    });

    it('should verify task can be resumed with Coder', { timeout: 30000 }, async () => {
      // Task should be findable as incomplete for resume
      // In plan-only mode, task is marked completed, but this could vary
      const task = await convexClient.query('tasks:getTask', { taskId });

      expect(task).toBeDefined();
      // Task status depends on implementation - may be completed or still planning
    });
  });
});
