/**
 * Base agent class with common functionality for all agent implementations.
 *
 * This abstract class provides the foundation for Planner, Coder, and Reviewer agents.
 * It handles configuration, tool permissions, progress reporting, and defines the
 * interface that all agents must implement.
 *
 * Architecture Pattern: Agent-Session Pattern
 * - Each agent runs in isolated Claude SDK session
 * - Sessions can be tracked in Convex for state management
 * - Results passed between agents via shared context
 */

import type {
  AgentType,
  AgentConfig,
  AgentResult,
  AgentContext,
  AgentExecutionOptions,
  AgentProgressUpdate,
  AgentToolPermissions,
  AgentResultMetadata,
} from './types';
import { AGENT_TOOL_PERMISSIONS, AgentExecutionError } from './types';

/**
 * Abstract base class for all agent implementations.
 *
 * Provides common functionality including:
 * - Configuration and validation
 * - Tool permission management
 * - Progress reporting
 * - Prompt building
 * - Result formatting
 *
 * Subclasses must implement:
 * - execute(): Main execution logic
 * - getSystemPrompt(): Returns agent's system prompt
 * - parseResult(): Extracts structured result from agent output
 */
export abstract class BaseAgent {
  /**
   * Agent type identifier (planner, coder, reviewer)
   */
  protected readonly agentType: AgentType;

  /**
   * Agent configuration including task description and working directory
   */
  protected readonly config: AgentConfig;

  /**
   * Tool permissions for this agent type
   */
  protected readonly toolPermissions: AgentToolPermissions;

  /**
   * Creates a new agent instance.
   *
   * @param config - Agent configuration including type, task, and working directory
   * @throws Error if configuration is invalid
   */
  constructor(config: AgentConfig) {
    this.agentType = config.agentType;
    this.config = config;
    this.toolPermissions = AGENT_TOOL_PERMISSIONS[config.agentType];

    // Validate required configuration
    this.validateConfig(config);
  }

  /**
   * Execute the agent with the given context and options.
   *
   * This is the main entry point for agent execution. Subclasses must
   * implement the full execution flow including:
   * 1. Building prompts from context
   * 2. Calling Claude SDK with appropriate tools
   * 3. Parsing and validating results
   * 4. Returning structured AgentResult
   *
   * @param context - Execution context with task, plan, and previous sessions
   * @param options - Optional execution settings (timeout, dry run, callbacks)
   * @returns Promise resolving to agent execution result
   */
  abstract execute(context: AgentContext, options?: AgentExecutionOptions): Promise<AgentResult>;

  /**
   * Get the system prompt for this agent type.
   *
   * System prompts define the agent's role, behavior, and output format.
   * Each agent type has its own system prompt file in src/prompts/.
   *
   * @returns System prompt string for this agent
   */
  protected abstract getSystemPrompt(): string;

  /**
   * Parse agent output into structured result metadata.
   *
   * Extracts agent-specific structured data from the raw text output.
   * For example:
   * - Planner: Extracts plan steps with file lists and complexity
   * - Coder: Extracts code changes with file paths and change types
   * - Reviewer: Extracts review status, criteria, and feedback
   *
   * @param content - Raw text output from the agent
   * @returns Parsed metadata specific to agent type
   */
  protected abstract parseResultMetadata(content: string): AgentResultMetadata | undefined;

  /**
   * Build the user prompt from the given context.
   *
   * Constructs the user-facing prompt that includes the task description
   * and any relevant context from previous agents (plan, code changes, etc.).
   *
   * @param context - Agent execution context
   * @returns Formatted user prompt string
   */
  protected buildUserPrompt(context: AgentContext): string {
    const parts: string[] = [];

    // Add task description
    parts.push(`# Task\n${context.task.description}\n`);

    // Add plan if available (for Coder and Reviewer)
    if (context.plan) {
      parts.push(`# Plan (from Planner)\n${context.plan.content}\n`);
    }

    // Add code changes if available (for Reviewer)
    if (context.codeChanges && context.codeChanges.length > 0) {
      parts.push('# Code Changes (from Coder)\n');
      context.codeChanges.forEach((change) => {
        parts.push(`- ${change.filePath}: ${change.summary}\n`);
      });
      parts.push('');
    }

    // Add previous session context if available
    if (context.previousSessions.length > 0) {
      parts.push('# Previous Agent Sessions\n');
      context.previousSessions.forEach((session) => {
        parts.push(`- ${session.agentType}: ${session.status}`);
        if (session.result) {
          parts.push(`  Result: ${session.result.substring(0, 100)}...`);
        }
      });
      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * Get the list of allowed Claude SDK tools for this agent.
   *
   * Tools are filtered based on agent type permissions:
   * - Planner: Read-only tools (Read, Glob, Grep, WebFetch, WebSearch)
   * - Coder: Read + Write + Bash (all tools)
   * - Reviewer: Read-only tools (Read, Glob, Grep)
   *
   * @returns Array of tool names allowed for this agent
   */
  protected getAllowedTools(): string[] {
    const tools: string[] = [];

    if (this.toolPermissions.Read) tools.push('Read');
    if (this.toolPermissions.Glob) tools.push('Glob');
    if (this.toolPermissions.Grep) tools.push('Grep');
    if (this.toolPermissions.Write) tools.push('Write');
    if (this.toolPermissions.Edit) tools.push('Edit');
    if (this.toolPermissions.Bash) tools.push('Bash');
    if (this.toolPermissions.WebFetch) tools.push('WebFetch');
    if (this.toolPermissions.WebSearch) tools.push('WebSearch');

    return tools;
  }

  /**
   * Report progress during agent execution.
   *
   * Calls the optional progress callback if provided in execution options.
   * Useful for providing real-time feedback to users during long-running operations.
   *
   * @param activity - Description of current activity
   * @param options - Execution options containing progress callback
   */
  protected reportProgress(activity: string, options?: AgentExecutionOptions): void {
    const update: AgentProgressUpdate = {
      agentType: this.agentType,
      activity,
      timestamp: new Date(),
    };

    options?.onProgress?.(update);
  }

  /**
   * Create a successful agent result.
   *
   * Formats a successful execution result with parsed metadata.
   *
   * @param content - Primary result content from agent
   * @returns Formatted AgentResult with success=true
   */
  protected createSuccessResult(content: string): AgentResult {
    return {
      agentType: this.agentType,
      success: true,
      content,
      completedAt: new Date(),
      metadata: this.parseResultMetadata(content),
    };
  }

  /**
   * Create a failed agent result.
   *
   * Formats a failed execution result with error information.
   *
   * @param error - Error message describing the failure
   * @param originalError - Optional original error object for debugging
   * @returns Formatted AgentResult with success=false
   */
  protected createFailureResult(error: string, originalError?: unknown): AgentResult {
    return {
      agentType: this.agentType,
      success: false,
      content: '',
      error,
      completedAt: new Date(),
    };
  }

  /**
   * Validate agent configuration.
   *
   * Ensures required fields are present and valid before execution.
   *
   * @param config - Configuration to validate
   * @throws Error if configuration is invalid
   */
  private validateConfig(config: AgentConfig): void {
    if (!config.taskDescription || config.taskDescription.trim().length === 0) {
      throw new Error('Task description is required');
    }

    if (!config.workingDirectory || config.workingDirectory.trim().length === 0) {
      throw new Error('Working directory is required');
    }
  }

  /**
   * Get agent type identifier.
   *
   * @returns Agent type enum value
   */
  getAgentType(): AgentType {
    return this.agentType;
  }

  /**
   * Get agent configuration.
   *
   * @returns Agent configuration object
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * Get tool permissions for this agent.
   *
   * @returns Tool permissions object
   */
  getToolPermissions(): AgentToolPermissions {
    return { ...this.toolPermissions };
  }

  /**
   * Create an AgentExecutionError with proper context.
   *
   * Utility method for creating consistent error objects.
   *
   * @param message - Error message
   * @param originalError - Optional original error
   * @returns AgentExecutionError instance
   */
  protected createExecutionError(message: string, originalError?: unknown): AgentExecutionError {
    return new AgentExecutionError(this.agentType, message, originalError);
  }
}
