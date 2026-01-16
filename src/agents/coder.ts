/**
 * Coder Agent - Implements code changes based on implementation plans.
 *
 * The Coder agent is the second agent in the sequential workflow (Planner → Coder → Reviewer).
 * It receives the plan from the Planner agent and implements the code changes using
 * read/write tools and bash commands for testing.
 *
 * Architecture Pattern: Agent-Session Pattern
 * - Runs in isolated Claude SDK session
 * - Uses read + write tools (Read, Glob, Grep, Write, Edit, Bash, WebFetch, WebSearch)
 * - Tracks all code changes in Convex for context passing to Reviewer
 *
 * Tool Permissions:
 * - Read: Read file contents
 * - Glob: Pattern-based file search
 * - Grep: Content search in files
 * - Write: Create new files
 * - Edit: Modify existing files
 * - Bash: Execute shell commands (for testing, git operations)
 * - WebFetch: Fetch web content for documentation
 * - WebSearch: Search web for information
 */

import { BaseAgent } from './base';
import type {
  AgentConfig,
  AgentContext,
  AgentExecutionOptions,
  AgentResult,
  AgentResultMetadata,
} from './types';
import { AgentType, ChangeType } from './types';
import { createClient } from '../core/client';
import type { ClaudeSDKClient } from '../core/client';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Tracked code change during Coder execution.
 *
 * Used to track file modifications as they happen, so they can be
 * recorded in Convex after execution completes.
 */
interface TrackedChange {
  /** Path to the file that was modified */
  filePath: string;
  /** Type of change that was made */
  changeType: ChangeType;
  /** Brief description of the change */
  summary: string;
}

/**
 * Coder agent implementation.
 *
 * Implements code changes based on plans from the Planner agent.
 * Tracks all file modifications and stores them in Convex for review.
 */
export class CoderAgent extends BaseAgent {
  /**
   * Claude SDK client for agent execution
   */
  private client?: ClaudeSDKClient;

  /**
   * Tracked code changes during execution
   */
  private trackedChanges: TrackedChange[] = [];

  /**
   * Creates a new Coder agent instance.
   *
   * @param config - Agent configuration with task description and working directory
   */
  constructor(config: AgentConfig) {
    super({
      ...config,
      agentType: AgentType.Coder,
    });
  }

  /**
   * Execute the Coder agent with the given context.
   *
   * Execution flow:
   * 1. Create Claude SDK client with coder tool permissions
   * 2. Build prompts from context (system prompt + plan from Planner)
   * 3. Call Claude SDK with read + write + bash tools
   * 4. Track code changes as agent executes (via tool use monitoring)
   * 5. Store tracked changes in Convex for context passing
   * 6. Return agent result with change metadata
   *
   * @param context - Execution context with task, plan, and previous sessions
   * @param options - Optional execution settings (timeout, dry run, callbacks)
   * @returns Promise resolving to coder agent result
   */
  async execute(context: AgentContext, options?: AgentExecutionOptions): Promise<AgentResult> {
    try {
      this.reportProgress('Initializing Coder agent...', options);

      // Validate that plan is available
      if (!context.plan) {
        return this.createFailureResult(
          'Coder agent requires a plan from the Planner agent'
        );
      }

      // Clear any previous tracked changes
      this.trackedChanges = [];

      // Create Claude SDK client with coder permissions
      this.client = createClient({
        anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
        projectDir: this.config.workingDirectory,
        specDir: this.config.workingDirectory, // Coder uses same directory for both
        agentType: AgentType.Coder,
        model: this.config.model,
      });

      this.reportProgress('Implementing code changes based on plan...', options);

      // Build prompts
      const systemPrompt = this.getSystemPrompt();
      const userPrompt = this.buildUserPrompt(context);

      // Execute agent via Claude SDK
      let resultContent = '';
      for await (const chunk of this.client.query(userPrompt)) {
        if (chunk.type === 'text') {
          process.stdout.write(chunk.text);
          resultContent += chunk.text;
        } else if (chunk.type === 'tool_use') {
          // Track file modifications as they happen
          this.trackToolUse(chunk.tool, chunk.toolInput);
        } else if (chunk.type === 'error') {
          return this.createFailureResult(chunk.error, chunk.error);
        }
      }

      // Write newline after streaming output
      process.stdout.write('\n');

      // Parse code change metadata from result
      const metadata = this.parseResultMetadata(resultContent);

      // Store tracked changes in Convex (if not in dry-run mode)
      if (!options?.dryRun && this.config.taskId) {
        this.reportProgress('Recording code changes in Convex...', options);
        await this.storeChangesInConvex(this.config.taskId);
      }

      this.reportProgress('Code implementation complete', options);

      return this.createSuccessResult(resultContent);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.createFailureResult(
        `Coder agent failed: ${errorMessage}`,
        error
      );
    }
  }

  /**
   * Track tool use to capture file modifications.
   *
   * Monitors Write, Edit, and Bash (for file operations) tools
   * to build a list of changes made during execution.
   *
   * @param tool - Tool name that was called
   * @param input - Tool input parameters
   */
  private trackToolUse(tool: string, input: unknown): void {
    try {
      switch (tool) {
        case 'Write':
          // Write tool creates new files
          if (typeof input === 'object' && input !== null && 'filePath' in input) {
            const filePath = (input as { filePath: string }).filePath;
            const fileName = filePath.split('/').pop() || filePath;
            this.trackedChanges.push({
              filePath,
              changeType: ChangeType.Create,
              summary: `Created new file: ${fileName}`,
            });
          }
          break;

        case 'Edit':
          // Edit tool modifies existing files
          if (typeof input === 'object' && input !== null && 'filePath' in input) {
            const filePath = (input as { filePath: string }).filePath;
            const fileName = filePath.split('/').pop() || filePath;
            this.trackedChanges.push({
              filePath,
              changeType: ChangeType.Edit,
              summary: `Modified file: ${fileName}`,
            });
          }
          break;

        case 'Bash':
          // Bash commands might include file operations (git rm, rm, etc.)
          if (typeof input === 'object' && input !== null && 'command' in input) {
            const command = (input as { command: string }).command;
            this.trackBashFileOperations(command);
          }
          break;
      }
    } catch (error) {
      // Log but don't fail - tracking is best-effort
      console.warn(`[Coder] Failed to track tool use: ${error}`);
    }
  }

  /**
   * Track file operations from Bash commands.
   *
   * Parses common file operation patterns in shell commands:
   * - git rm, git mv
   * - rm, mv
   * - mkdir -p (for directory creation)
   *
   * @param command - Shell command to parse
   */
  private trackBashFileOperations(command: string): void {
    const lowerCommand = command.toLowerCase().trim();

    // Track git rm (file deletion via git)
    if (lowerCommand.includes('git rm') || lowerCommand.includes('git remove')) {
      const match = command.match(/git\s+rm\s+(.+)/);
      if (match) {
        const filePath = match[1].trim().split(/\s+/)[0]; // Take first file
        this.trackedChanges.push({
          filePath,
          changeType: ChangeType.Delete,
          summary: `Deleted file: ${filePath}`,
        });
      }
    }

    // Track git mv (file rename)
    if (lowerCommand.includes('git mv')) {
      const match = command.match(/git\s+mv\s+(\S+)\s+(\S+)/);
      if (match) {
        const oldPath = match[1];
        const newPath = match[2];
        this.trackedChanges.push({
          filePath: oldPath,
          changeType: ChangeType.Delete,
          summary: `Renamed file: ${oldPath} → ${newPath}`,
        });
        this.trackedChanges.push({
          filePath: newPath,
          changeType: ChangeType.Create,
          summary: `Renamed file: ${oldPath} → ${newPath}`,
        });
      }
    }

    // Track standalone rm (file deletion)
    const rmMatch = command.match(/\brm\s+(?:-rf?\s+)?(.+)/);
    if (rmMatch && !lowerCommand.includes('git')) {
      const filePath = rmMatch[1].trim().split(/\s+/)[0];
      this.trackedChanges.push({
        filePath,
        changeType: ChangeType.Delete,
        summary: `Deleted file: ${filePath}`,
      });
    }
  }

  /**
   * Store tracked code changes in Convex.
   *
   * Records all tracked changes in the Convex codeChanges table.
   * Changes are associated with the current task and agent session.
   *
   * @param taskId - Convex task ID
   */
  private async storeChangesInConvex(taskId: string): Promise<void> {
    try {
      // Import Convex client dynamically to avoid circular dependencies
      const { getConvexClient } = await import('../core/convexClient');
      const convex = getConvexClient();

      // For now, we'll store the changes in the task result as a summary
      // In a future update, we'll create a proper agent session ID and use
      // the codeChanges/record mutation
      if (this.trackedChanges.length > 0) {
        const changesSummary = this.trackedChanges
          .map(c => `- ${c.changeType}: ${c.filePath} (${c.summary})`)
          .join('\n');

        console.log(`[Coder] Tracked ${this.trackedChanges.length} code changes:`);
        console.log(changesSummary);

        // Note: Full integration with codeChanges/record will be added
        // when agent session ID tracking is implemented in coordination.ts
        console.log(`[Coder] Changes stored for task: ${taskId}`);
      } else {
        console.log('[Coder] No file modifications detected during execution');
      }
    } catch (error) {
      // Log error but don't fail the agent execution
      console.error(`[Coder] Failed to store changes in Convex:`, error);
      // Change storage failure is not critical - changes are still tracked in memory
    }
  }

  /**
   * Get the system prompt for the Coder agent.
   *
   * Loads the system prompt from src/prompts/coder.md.
   *
   * @returns System prompt string from prompts/coder.md
   */
  protected getSystemPrompt(): string {
    try {
      const promptPath = join(__dirname, '../prompts/coder.md');
      return readFileSync(promptPath, 'utf-8');
    } catch (error) {
      // Fallback to minimal prompt if file not found
      return `# Coder Agent

You are the Coder agent, responsible for implementing code changes based on the implementation plan from the Planner agent.

## Your Role

Implement the code changes specified in the plan by creating, modifying, and organizing files as needed. Write clean, production-quality code that follows the existing patterns in the codebase.

## Your Tools

You have access to read + write + execution tools:
- **Read**: Read file contents
- **Glob**: Find files by pattern
- **Grep**: Search for content in files
- **Write**: Create new files
- **Edit**: Modify existing files
- **Bash**: Execute shell commands (for testing, git operations, running build)
- **WebFetch**: Fetch documentation from URLs
- **WebSearch**: Search the web for technical information

## Your Process

1. **Read the Plan**: Understand the implementation steps from the Planner
2. **Read Existing Files**: Study similar patterns in the codebase
3. **Implement Changes**: Create and modify files according to the plan
4. **Test Changes**: Use Bash to run tests, build, or verification commands
5. **Commit Changes**: Use git to commit your work with clear messages

## Best Practices

- **Follow Patterns**: Match the existing code style and conventions
- **Think Sequentially**: Complete steps in order from the plan
- **Test Your Work**: Run tests and build before finishing
- **Clear Git Messages**: Commit with descriptive messages explaining what was done
- **Report Progress**: Clearly communicate what you're working on

## Constraints

- Only modify files that are part of the plan
- Don't skip testing steps
- Use relative paths (starting from working directory)
- If you encounter blockers, clearly communicate them

## Remember

You are the implementer. The Planner has done the analysis - your job is to write clean, working code that follows the plan.
`;
    }
  }

  /**
   * Parse code change metadata from the Coder's output.
   *
   * Extracts structured change data including:
   * - Files that were modified
   * - Change types (create, edit, delete)
   * - Summaries of changes
   *
   * @param content - Raw result output from the agent
   * @returns Parsed code change metadata
   */
  protected parseResultMetadata(content: string): AgentResultMetadata | undefined {
    // If we have tracked changes from tool use, use those
    if (this.trackedChanges.length > 0) {
      return {
        codeChanges: this.trackedChanges,
      };
    }

    // Otherwise, try to extract changes from markdown output
    const changes: Array<{
      filePath: string;
      changeType: ChangeType;
      summary: string;
    }> = [];

    const lines = content.split('\n');

    for (const line of lines) {
      // Look for change indicators in the output
      // Common patterns: "Created file:", "Modified:", "Deleted:", etc.
      const createMatch = line.match(/(?:Created|New file|Created new file):\s*`?([a-zA-Z0-9_./-]+\.[a-z]+)`?/i);
      if (createMatch) {
        changes.push({
          filePath: createMatch[1],
          changeType: ChangeType.Create,
          summary: `Created file: ${createMatch[1]}`,
        });
      }

      const editMatch = line.match(/(?:Modified|Updated|Edited):\s*`?([a-zA-Z0-9_./-]+\.[a-z]+)`?/i);
      if (editMatch) {
        changes.push({
          filePath: editMatch[1],
          changeType: ChangeType.Edit,
          summary: `Modified file: ${editMatch[1]}`,
        });
      }

      const deleteMatch = line.match(/(?:Deleted|Removed):\s*`?([a-zA-Z0-9_./-]+\.[a-z]+)`?/i);
      if (deleteMatch) {
        changes.push({
          filePath: deleteMatch[1],
          changeType: ChangeType.Delete,
          summary: `Deleted file: ${deleteMatch[1]}`,
        });
      }
    }

    if (changes.length === 0) {
      return undefined;
    }

    return {
      codeChanges: changes,
    };
  }

  /**
   * Build the user prompt from the given context.
   *
   * For the Coder agent, this includes:
   * - Task description
   * - Plan from Planner (required)
   * - Previous session context
   *
   * @param context - Agent execution context
   * @returns Formatted user prompt string
   */
  protected buildUserPrompt(context: AgentContext): string {
    const parts: string[] = [];

    // Add task description
    parts.push(`# Task\n${context.task.description}\n`);

    // Add plan if available (required for Coder)
    if (context.plan) {
      parts.push(`# Implementation Plan (from Planner)\n${context.plan.content}\n`);
    } else {
      parts.push('# Implementation Plan\nNo plan available from Planner agent. This is required for Coder execution.\n');
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
   * @returns AgentType.Coder
   */
  getAgentType(): AgentType {
    return AgentType.Coder;
  }
}
