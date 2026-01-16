/**
 * Planner Agent - Creates implementation plans based on task descriptions.
 *
 * The Planner agent is the first agent in the sequential workflow (Planner → Coder → Reviewer).
 * It analyzes the task description and codebase using read-only tools to create a detailed
 * implementation plan that the Coder agent will follow.
 *
 * Architecture Pattern: Agent-Session Pattern
 * - Runs in isolated Claude SDK session
 * - Uses read-only tools (Read, Glob, Grep, WebFetch, WebSearch)
 * - Stores plan in Convex for context passing to subsequent agents
 *
 * Tool Permissions:
 * - Read: Read file contents
 * - Glob: Pattern-based file search
 * - Grep: Content search in files
 * - WebFetch: Fetch web content for documentation
 * - WebSearch: Search web for information
 * - Write: NO (read-only agent)
 * - Edit: NO (read-only agent)
 * - Bash: NO (read-only agent)
 */

import { BaseAgent } from './base';
import type {
  AgentConfig,
  AgentContext,
  AgentExecutionOptions,
  AgentResult,
  AgentResultMetadata,
} from './types';
import { AgentType } from './types';
import { createClient } from '../core/client';
import type { ClaudeSDKClient } from '../core/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ConvexClient } from 'convex/dev';

/**
 * Planner agent implementation.
 *
 * Analyzes task descriptions and codebase to create detailed implementation plans.
 * Plans include file lists, step-by-step instructions, and complexity estimates.
 */
export class PlannerAgent extends BaseAgent {
  /**
   * Claude SDK client for agent execution
   */
  private client?: ClaudeSDKClient;

  /**
   * Creates a new Planner agent instance.
   *
   * @param config - Agent configuration with task description and working directory
   */
  constructor(config: AgentConfig) {
    super({
      ...config,
      agentType: AgentType.Planner,
    });
  }

  /**
   * Execute the Planner agent with the given context.
   *
   * Execution flow:
   * 1. Create Claude SDK client with planner tool permissions
   * 2. Build prompts from context (system prompt + task description)
   * 3. Call Claude SDK with read-only tools
   * 4. Parse structured plan from agent output
   * 5. Store plan in Convex for context passing
   * 6. Return agent result
   *
   * @param context - Execution context with task and previous sessions
   * @param options - Optional execution settings (timeout, dry run, callbacks)
   * @returns Promise resolving to planner agent result
   */
  async execute(context: AgentContext, options?: AgentExecutionOptions): Promise<AgentResult> {
    try {
      this.reportProgress('Initializing Planner agent...', options);

      // Create Claude SDK client with planner permissions
      this.client = createClient({
        anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
        projectDir: this.config.workingDirectory,
        agentType: AgentType.Planner,
        model: this.config.model,
      });

      this.reportProgress('Analyzing task and codebase...', options);

      // Build prompts
      const systemPrompt = this.getSystemPrompt();
      const userPrompt = this.buildUserPrompt(context);

      // Execute agent via Claude SDK
      let planContent = '';
      for await (const chunk of this.client.query(userPrompt)) {
        if (chunk.type === 'text') {
          process.stdout.write(chunk.text);
          planContent += chunk.text;
        } else if (chunk.type === 'error') {
          return this.createFailureResult(chunk.error, chunk.error);
        }
      }

      // Write newline after streaming output
      process.stdout.write('\n');

      // Parse plan metadata
      const metadata = this.parseResultMetadata(planContent);

      // Store plan in Convex (if not in dry-run mode)
      if (!options?.dryRun && this.config.taskId) {
        this.reportProgress('Storing plan in Convex...', options);
        await this.storePlanInConvex(this.config.taskId, planContent);
      }

      this.reportProgress('Plan created successfully', options);

      return this.createSuccessResult(planContent);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.createFailureResult(
        `Planner agent failed: ${errorMessage}`,
        error
      );
    }
  }

  /**
   * Get the system prompt for the Planner agent.
   *
   * Loads the system prompt from src/prompts/planner.md.
   *
   * @returns System prompt string from prompts/planner.md
   */
  protected getSystemPrompt(): string {
    try {
      const promptPath = join(__dirname, '../prompts/planner.md');
      return readFileSync(promptPath, 'utf-8');
    } catch (error) {
      // Fallback to minimal prompt if file not found
      return `# Planner Agent

You are the Planner agent, responsible for creating detailed implementation plans based on task descriptions.

## Your Role

Analyze the task description and explore the codebase to create a comprehensive implementation plan that will guide the Coder agent.

## Your Tools

You have access to read-only tools:
- **Read**: Read file contents
- **Glob**: Find files by pattern
- **Grep**: Search for content in files
- **WebFetch**: Fetch documentation from URLs
- **WebSearch**: Search the web for information

## Your Output

Create a structured plan with:

1. **Analysis**: Brief understanding of the task and existing codebase
2. **Implementation Steps**: Numbered list of concrete steps
3. **Files to Modify**: List all files that need changes
4. **Dependencies**: Any external dependencies or imports needed
5. **Testing Strategy**: How to verify the implementation

Format your plan as markdown with clear sections.

## Constraints

- Use ONLY read-only tools - no writing or executing commands
- Focus on understanding the existing codebase structure
- Provide concrete, actionable steps for the Coder agent
- Estimate complexity for each step (low/medium/high)
`;
    }
  }

  /**
   * Parse plan metadata from the Planner's output.
   *
   * Extracts structured plan data including:
   * - Implementation steps
   * - Files to modify
   * - Complexity estimates
   *
   * @param content - Raw plan output from the agent
   * @returns Parsed plan metadata
   */
  protected parseResultMetadata(content: string): AgentResultMetadata | undefined {
    // Try to extract structured plan from markdown output
    const steps: Array<{
      description: string;
      files: string[];
      estimatedComplexity: 'low' | 'medium' | 'high';
    }> = [];

    // Simple parsing logic - in production this would be more robust
    const lines = content.split('\n');
    let currentStep: { description: string; files: string[]; estimatedComplexity: 'low' | 'medium' | 'high' } | null = null;

    for (const line of lines) {
      // Look for numbered steps
      const stepMatch = line.match(/^\d+\.\s+(.+)$/);
      if (stepMatch) {
        if (currentStep) {
          steps.push(currentStep);
        }
        currentStep = {
          description: stepMatch[1],
          files: [],
          estimatedComplexity: 'medium',
        };
      }

      // Look for file mentions
      const fileMatch = line.match(/[\s-*]\s*`?([a-zA-Z0-9_./-]+\.(ts|js|tsx|jsx|json|md))`?/);
      if (fileMatch && currentStep) {
        const filePath = fileMatch[1];
        if (!currentStep.files.includes(filePath)) {
          currentStep.files.push(filePath);
        }
      }

      // Look for complexity indicators
      if (line.toLowerCase().includes('complexity: low') && currentStep) {
        currentStep.estimatedComplexity = 'low';
      } else if (line.toLowerCase().includes('complexity: high') && currentStep) {
        currentStep.estimatedComplexity = 'high';
      }
    }

    if (currentStep) {
      steps.push(currentStep);
    }

    if (steps.length === 0) {
      return undefined;
    }

    return {
      plan: { steps },
    };
  }

  /**
   * Store the generated plan in Convex.
   *
   * Plans are stored so they can be retrieved by:
   * - The Coder agent (for implementation guidance)
   * - The Reviewer agent (for validation criteria)
   * - Future sessions (for resume capability)
   *
   * @param taskId - Convex task ID
   * @param content - Plan content to store
   */
  private async storePlanInConvex(taskId: string, content: string): Promise<void> {
    try {
      // Import Convex client dynamically to avoid circular dependencies
      const { getConvexClient } = await import('../core/convexClient');
      const convex = getConvexClient();

      // Convert taskId string to Convex ID
      // The taskId should be a valid Convex ID string
      await convex.mutation('plans/store', {
        taskId: taskId as any, // Will be validated by Convex
        content,
      });

      console.log(`[Planner] Plan stored successfully for task: ${taskId}`);
    } catch (error) {
      // Log error but don't fail the agent execution
      console.error(`[Planner] Failed to store plan in Convex:`, error);
      // Plan storage failure is not critical - plan is still returned in result
    }
  }

  /**
   * Get agent type identifier.
   *
   * @returns AgentType.Planner
   */
  getAgentType(): AgentType {
    return AgentType.Planner;
  }
}
