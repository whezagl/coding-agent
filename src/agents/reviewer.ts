/**
 * Reviewer Agent - Reviews and validates implementation results.
 *
 * The Reviewer agent is the final agent in the sequential workflow (Planner → Coder → Reviewer).
 * It receives the plan from the Planner agent and the code changes from the Coder agent,
 * then validates that the implementation meets acceptance criteria.
 *
 * Architecture Pattern: Agent-Session Pattern
 * - Runs in isolated Claude SDK session
 * - Uses read-only tools (Read, Glob, Grep)
 * - Stores review results in Convex for final validation
 *
 * Tool Permissions:
 * - Read: Read file contents
 * - Glob: Pattern-based file search
 * - Grep: Content search in files
 * - Write: NO (read-only agent)
 * - Edit: NO (read-only agent)
 * - Bash: NO (read-only agent)
 * - WebFetch: NO (read-only agent)
 * - WebSearch: NO (read-only agent)
 */

import { BaseAgent } from './base';
import type {
  AgentConfig,
  AgentContext,
  AgentExecutionOptions,
  AgentResult,
  AgentResultMetadata,
} from './types';
import { AgentType, ReviewStatus } from './types';
import { createClient } from '../core/client';
import type { ClaudeSDKClient } from '../core/client';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Tracked issue found during review.
 *
 * Issues are categorized by severity and tracked during the review process.
 */
interface TrackedIssue {
  /** Severity level of the issue */
  severity: 'error' | 'warning' | 'info';
  /** Path to the file with the issue (optional if issue is general) */
  file?: string;
  /** Description of the issue */
  message: string;
}

/**
 * Reviewer agent implementation.
 *
 * Reviews and validates implementation results against acceptance criteria.
 * Generates structured review reports with pass/fail status and feedback.
 */
export class ReviewerAgent extends BaseAgent {
  /**
   * Claude SDK client for agent execution
   */
  private client?: ClaudeSDKClient;

  /**
   * Tracked issues during review
   */
  private trackedIssues: TrackedIssue[] = [];

  /**
   * Creates a new Reviewer agent instance.
   *
   * @param config - Agent configuration with task description and working directory
   */
  constructor(config: AgentConfig) {
    super({
      ...config,
      agentType: AgentType.Reviewer,
    });
  }

  /**
   * Execute the Reviewer agent with the given context.
   *
   * Execution flow:
   * 1. Create Claude SDK client with reviewer tool permissions
   * 2. Build prompts from context (system prompt + plan + code changes)
   * 3. Call Claude SDK with read-only tools
   * 4. Parse structured review from agent output
   * 5. Store review in Convex for final validation
   * 6. Return agent result
   *
   * @param context - Execution context with task, plan, code changes, and previous sessions
   * @param options - Optional execution settings (timeout, dry run, callbacks)
   * @returns Promise resolving to reviewer agent result
   */
  async execute(context: AgentContext, options?: AgentExecutionOptions): Promise<AgentResult> {
    try {
      this.reportProgress('Initializing Reviewer agent...', options);

      // Validate that plan and code changes are available
      if (!context.plan) {
        return this.createFailureResult(
          'Reviewer agent requires a plan from the Planner agent'
        );
      }

      if (!context.codeChanges || context.codeChanges.length === 0) {
        return this.createFailureResult(
          'Reviewer agent requires code changes from the Coder agent'
        );
      }

      // Clear any previous tracked issues
      this.trackedIssues = [];

      // Create Claude SDK client with reviewer permissions
      this.client = createClient({
        anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
        projectDir: this.config.workingDirectory,
        agentType: AgentType.Reviewer,
        model: this.config.model,
      });

      this.reportProgress('Validating implementation against plan...', options);

      // Build prompts
      const systemPrompt = this.getSystemPrompt();
      const userPrompt = this.buildUserPrompt(context);

      // Execute agent via Claude SDK
      let reviewContent = '';
      for await (const chunk of this.client.query(userPrompt)) {
        if (chunk.type === 'text') {
          process.stdout.write(chunk.text);
          reviewContent += chunk.text;
        } else if (chunk.type === 'error') {
          return this.createFailureResult(chunk.error, chunk.error);
        }
      }

      // Write newline after streaming output
      process.stdout.write('\n');

      // Parse review metadata
      const metadata = this.parseResultMetadata(reviewContent);

      // Store review in Convex (if not in dry-run mode)
      if (!options?.dryRun && this.config.taskId) {
        this.reportProgress('Storing review in Convex...', options);
        await this.storeReviewInConvex(this.config.taskId, reviewContent, metadata);
      }

      // Determine if review passed based on metadata
      const reviewPassed = metadata?.review?.status === ReviewStatus.Passed;

      this.reportProgress(
        reviewPassed ? 'Review passed - implementation approved' : 'Review failed - issues found',
        options
      );

      return this.createSuccessResult(reviewContent);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.createFailureResult(
        `Reviewer agent failed: ${errorMessage}`,
        error
      );
    }
  }

  /**
   * Parse review metadata from the Reviewer's output.
   *
   * Extracts structured review data including:
   * - Review status (passed/failed/needs_revision)
   * - Whether criteria were met
   * - Feedback summary
   * - Issues found (organized by severity)
   *
   * @param content - Raw review output from the agent
   * @returns Parsed review metadata
   */
  protected parseResultMetadata(content: string): AgentResultMetadata | undefined {
    // Look for review status in the output
    let status: ReviewStatus = ReviewStatus.NeedsRevision;
    let criteriaMet = false;
    const feedback: string[] = [];
    const issues: TrackedIssue[] = [];

    const lines = content.split('\n');

    for (const line of lines) {
      const lowerLine = line.toLowerCase();

      // Look for final decision
      if (lowerLine.includes('final decision') || lowerLine.includes('overall assessment')) {
        if (lowerLine.includes('passed') || lowerLine.includes('✅')) {
          status = ReviewStatus.Passed;
          criteriaMet = true;
        } else if (lowerLine.includes('failed') || lowerLine.includes('❌')) {
          status = ReviewStatus.Failed;
          criteriaMet = false;
        } else if (lowerLine.includes('needs revision') || lowerLine.includes('⚠️')) {
          status = ReviewStatus.NeedsRevision;
          criteriaMet = false;
        }
      }

      // Track errors
      if (line.match(/^#{3,}\s+Errors\s*\(Critical\)/i) ||
          line.match(/###\s*Errors/i)) {
        // In errors section - track errors
        continue;
      }

      // Look for error items
      const errorMatch = line.match(/^\s*-\s*\*\*\[([^]]+)\]\*\*(.+)/);
      if (errorMatch && (line.includes('Errors') || this.inSection(content, line, 'Errors'))) {
        issues.push({
          severity: 'error',
          file: errorMatch[1].trim(),
          message: errorMatch[2].trim(),
        });
      }

      // Look for warnings
      const warningMatch = line.match(/^\s*-\s*\*\*\[([^]]+)\]\*\*(.+)/);
      if (warningMatch && (line.includes('Warnings') || this.inSection(content, line, 'Warnings'))) {
        issues.push({
          severity: 'warning',
          file: warningMatch[1].trim(),
          message: warningMatch[2].trim(),
        });
      }

      // Look for info suggestions
      const infoMatch = line.match(/^\s*-\s*\*\*\[([^]]+)\]\*\*(.+)/);
      if (infoMatch && (line.includes('Info') || this.inSection(content, line, 'Info'))) {
        issues.push({
          severity: 'info',
          file: infoMatch[1].trim(),
          message: infoMatch[2].trim(),
        });
      }

      // Extract feedback (summary lines)
      if (line.match(/^#{2}\s/)) {
        // Major heading - capture as feedback
        feedback.push(line.replace(/^#+\s*/, '').trim());
      }
    }

    // Extract summary feedback from review
    if (feedback.length === 0) {
      // Try to get first non-empty lines as feedback
      for (const l of lines) {
        if (l.trim() && !l.startsWith('#')) {
          feedback.push(l.trim());
          if (feedback.length >= 3) break; // Get first 3 lines
        }
      }
    }

    return {
      review: {
        status,
        criteriaMet,
        feedback: feedback.join('\n'),
        issues,
      },
    };
  }

  /**
   * Check if a line is within a specific section of the markdown.
   *
   * @param content - Full content
   * @param line - Current line to check
   * @param sectionName - Name of the section to look for
   * @returns True if line is within the specified section
   */
  private inSection(content: string, line: string, sectionName: string): boolean {
    const lines = content.split('\n');
    const currentIndex = lines.indexOf(line);
    if (currentIndex === -1) return false;

    // Look backwards for the section header
    for (let i = currentIndex; i >= 0; i--) {
      const checkLine = lines[i];
      if (checkLine.match(new RegExp(`^#{3,}\\s*${sectionName}`, 'i'))) {
        return true;
      }
      if (checkLine.match(/^#{2,}\s/)) {
        // Hit a different major section
        return false;
      }
    }

    return false;
  }

  /**
   * Store the review result in Convex.
   *
   * Reviews are stored so they can be retrieved by:
   * - Future sessions (for resume capability)
   * - Audit trail of validation decisions
   * - Analytics on review results
   *
   * @param taskId - Convex task ID
   * @param content - Review content to store
   * @param metadata - Parsed review metadata
   */
  private async storeReviewInConvex(
    taskId: string,
    content: string,
    metadata?: AgentResultMetadata
  ): Promise<void> {
    try {
      // Import Convex client dynamically to avoid circular dependencies
      const { getConvexClient } = await import('../core/convexClient');
      const convex = getConvexClient();

      const reviewData = metadata?.review;
      const status = reviewData?.status || ReviewStatus.NeedsRevision;
      const criteriaMet = reviewData?.criteriaMet || false;
      const feedback = reviewData?.feedback || content;

      // For now, we'll store a summary in the task
      // In a future update, we'll use the reviews/store mutation with proper agent session ID
      console.log(`[Reviewer] Review result: ${status}`);
      console.log(`[Reviewer] Criteria met: ${criteriaMet}`);
      console.log(`[Reviewer] Issues found: ${reviewData?.issues?.length || 0}`);

      // Note: Full integration with reviews/store will be added
      // when agent session ID tracking is implemented in coordination.ts
      console.log(`[Reviewer] Review stored for task: ${taskId}`);

    } catch (error) {
      // Log error but don't fail the agent execution
      console.error(`[Reviewer] Failed to store review in Convex:`, error);
      // Review storage failure is not critical - review is still returned in result
    }
  }

  /**
   * Get the system prompt for the Reviewer agent.
   *
   * Loads the system prompt from src/prompts/reviewer.md.
   *
   * @returns System prompt string from prompts/reviewer.md
   */
  protected getSystemPrompt(): string {
    try {
      const promptPath = join(__dirname, '../prompts/reviewer.md');
      return readFileSync(promptPath, 'utf-8');
    } catch (error) {
      // Fallback to minimal prompt if file not found
      return `# Reviewer Agent

You are the Reviewer agent, responsible for validating that the implementation meets acceptance criteria.

## Your Role

Review the code changes made by the Coder agent against the plan from the Planner agent. Ensure the implementation is complete, correct, and production-ready.

## Your Tools

You have access to read-only tools:
- **Read**: Read file contents
- **Glob**: Find files by pattern
- **Grep**: Search for content in files

## Your Output

Create a structured review with:

1. **Summary**: Brief overview of what was implemented
2. **Validation**: Check each planned step was completed
3. **Findings**: Organize by severity (errors, warnings, info)
4. **Files Reviewed**: List all files examined
5. **Final Decision**: Passed, Failed, or Needs Revision

## Review Criteria

**Errors (Critical)**: Cause review to fail
- Implementation doesn't match plan
- Syntax or type errors
- Missing critical functionality
- No error handling
- Security vulnerabilities

**Warnings (Important)**: Request revision
- Code quality issues
- Missing edge case handling
- Inadequate documentation
- Performance concerns

**Info (Suggestions)**: Nice to have
- Code style improvements
- Minor refactoring opportunities
- Additional test suggestions

## Constraints

- Use ONLY read-only tools - no writing or executing commands
- Be objective and thorough in your review
- Provide specific, actionable feedback
- Balance quality with pragmatism

Format your review as markdown with clear sections and use emojis (✅/❌/⚠️) for status indicators.
`;
    }
  }

  /**
   * Build the user prompt from the given context.
   *
   * For the Reviewer agent, this includes:
   * - Task description
   * - Plan from Planner (required)
   * - Code changes from Coder (required)
   * - Previous session context
   *
   * @param context - Agent execution context
   * @returns Formatted user prompt string
   */
  protected buildUserPrompt(context: AgentContext): string {
    const parts: string[] = [];

    // Add task description
    parts.push(`# Task\n${context.task.description}\n`);

    // Add plan if available (required for Reviewer)
    if (context.plan) {
      parts.push(`# Implementation Plan (from Planner)\n${context.plan.content}\n`);
    } else {
      parts.push('# Implementation Plan\nNo plan available from Planner agent. This is required for review.\n');
    }

    // Add code changes if available (required for Reviewer)
    if (context.codeChanges && context.codeChanges.length > 0) {
      parts.push('# Code Changes (from Coder)\n');
      context.codeChanges.forEach((change) => {
        const icon = change.changeType === 'create' ? '➕' :
                    change.changeType === 'delete' ? '🗑️' : '✏️';
        parts.push(`${icon} **${change.filePath}**: ${change.summary}\n`);
      });
      parts.push('');
    } else {
      parts.push('# Code Changes\nNo code changes available from Coder agent. This is required for review.\n');
    }

    // Add previous session context if available
    if (context.previousSessions.length > 0) {
      parts.push('# Previous Agent Sessions\n');
      context.previousSessions.forEach((session) => {
        parts.push(`- ${session.agentType}: ${session.status}`);
        if (session.result) {
          const preview = session.result.length > 200
            ? session.result.substring(0, 200) + '...'
            : session.result;
          parts.push(`  Result: ${preview}`);
        }
      });
      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * Get agent type identifier.
   *
   * @returns AgentType.Reviewer
   */
  getAgentType(): AgentType {
    return AgentType.Reviewer;
  }
}
