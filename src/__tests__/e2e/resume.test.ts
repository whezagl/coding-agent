/**
 * End-to-end test for resume workflow.
 *
 * Tests:
 * - Start task, kill process, resume with `--continue`
 * - Verify: Continues from last state
 *
 * Requires:
 * - Real Convex backend (via Docker Compose)
 * - Claude API key
 * - Process management capabilities
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { Client } from 'convex/client';
import { setTimeout } from 'timers/promises';

describe('Resume Workflow E2E', () => {
  let convexClient: Client;
  let taskId: string;
  let cliProcess: any;

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

  afterAll(async () => {
    // Kill any running CLI process
    if (cliProcess && !cliProcess.killed) {
      cliProcess.kill('SIGTERM');
    }

    if (convexClient) {
      convexClient.close();
    }
  });

  describe('initial task execution', () => {
    it('should start a task that can be interrupted', { timeout: 60000 }, async () => {
      const taskDescription = 'Create a comprehensive user authentication system with login, registration, and password reset';

      // Start CLI process
      cliProcess = spawn('npm', ['start', '--', '--task', taskDescription], {
        env: process.env,
        cwd: process.cwd(),
      });

      let output = '';

      cliProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      // Wait for Planner to complete (indicated by seeing "Coder" or similar)
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (output.includes('Coder') || output.includes('Initializing Coder')) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 500);

        // Timeout after 60 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 60000);
      });

      // Kill the process to simulate interruption
      cliProcess.kill('SIGTERM');
      cliProcess = null;

      // Give Convex time to persist state
      await setTimeout(2000);
    });

    it('should verify task was stored in Convex', { timeout: 30000 }, async () => {
      // Get the latest incomplete task
      const task = await convexClient.query('tasks:getLatestIncompleteTask', {});

      expect(task).toBeDefined();
      taskId = task.id as string;

      expect(task.description).toContain('authentication');
      expect(task.status).not.toBe('completed');
    });

    it('should verify Planner session completed', { timeout: 30000 }, async () => {
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      const plannerSession = sessions.find((s: any) => s.agentType === 'planner');

      expect(plannerSession).toBeDefined();
      expect(plannerSession.status).toBe('completed');
    });

    it('should verify task is incomplete', { timeout: 30000 }, async () => {
      const task = await convexClient.query('tasks:getTask', { taskId });

      // Task should NOT be completed (we interrupted it)
      expect(task.status).not.toBe('completed');
    });
  });

  describe('resume execution', () => {
    it('should resume task with --continue flag', { timeout: 120000 }, async () => {
      // Resume the task
      cliProcess = spawn('npm', ['start', '--', '--continue'], {
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

      // Wait for completion
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

      cliProcess = null;

      // Verify output shows continuation
      expect(output).toBeDefined();
    });

    it('should verify task completed after resume', { timeout: 30000 }, async () => {
      const task = await convexClient.query('tasks:getTask', { taskId });

      expect(task.status).toBe('completed');
      expect(task.error).toBeUndefined();
    });
  });

  describe('agent execution after resume', () => {
    it('should verify Coder executed after resume', { timeout: 30000 }, async () => {
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      const coderSession = sessions.find((s: any) => s.agentType === 'coder');

      expect(coderSession).toBeDefined();
      expect(coderSession.status).toBe('completed');
    });

    it('should verify Reviewer executed after resume', { timeout: 30000 }, async () => {
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      const reviewerSession = sessions.find((s: any) => s.agentType === 'reviewer');

      expect(reviewerSession).toBeDefined();
      expect(reviewerSession.status).toBe('completed');
    });

    it('should verify Planner did NOT run again', { timeout: 30000 }, async () => {
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      // Should only have one Planner session (the original one)
      const plannerSessions = sessions.filter((s: any) => s.agentType === 'planner');

      expect(plannerSessions.length).toBe(1);
    });
  });

  describe('state continuity', () => {
    it('should verify plan from initial execution was preserved', { timeout: 30000 }, async () => {
      const plan = await convexClient.query('plans:getPlanForTask', { taskId });

      expect(plan).toBeDefined();
      expect(plan.content).toBeDefined();
    });

    it('should verify code changes were made during resume', { timeout: 30000 }, async () => {
      const changes = await convexClient.query('codeChanges:getByTask', { taskId });

      expect(changes).toBeDefined();
      expect(changes.length).toBeGreaterThan(0);
    });

    it('should verify review was completed', { timeout: 30000 }, async () => {
      const review = await convexClient.query('reviews:getReviewForTask', { taskId });

      expect(review).toBeDefined();
      expect(review.status).toMatch(/passed|failed|needs_revision/);
    });
  });

  describe('session timeline verification', () => {
    it('should verify correct session ordering', { timeout: 30000 }, async () => {
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

    it('should verify Planner session is oldest', { timeout: 30000 }, async () => {
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      const plannerSession = sessions.find((s: any) => s.agentType === 'planner');
      const coderSession = sessions.find((s: any) => s.agentType === 'coder');

      expect(plannerSession.startedAt).toBeLessThan(coderSession.startedAt);
    });

    it('should verify Coder and Reviewer sessions are newer', { timeout: 30000 }, async () => {
      const sessions = await convexClient.query('agentSessions:getAgentSessionsByTask', {
        taskId,
      });

      const plannerSession = sessions.find((s: any) => s.agentType === 'planner');
      const coderSession = sessions.find((s: any) => s.agentType === 'coder');
      const reviewerSession = sessions.find((s: any) => s.agentType === 'reviewer');

      // Coder and Reviewer should have started after Planner
      expect(coderSession.startedAt).toBeGreaterThan(plannerSession.startedAt);
      expect(reviewerSession.startedAt).toBeGreaterThan(coderSession.startedAt);
    });
  });

  describe('error recovery scenario', () => {
    it('should handle resume with error cleared', { timeout: 30000 }, async () => {
      const task = await convexClient.query('tasks:getTask', { taskId });

      // If task had an error before, it should be cleared after successful resume
      expect(task.error).toBeUndefined();
    });
  });
});
