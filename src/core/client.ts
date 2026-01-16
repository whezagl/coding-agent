/**
 * Claude SDK client factory and query integration.
 *
 * This module provides a factory function for creating configured Claude SDK clients
 * with proper tool permissions, security settings, and MCP server integrations.
 *
 * Architecture Pattern: Client Factory Pattern
 * - Centralized client creation with consistent configuration
 * - Tool permissions scoped per agent type
 * - Integration with Claude SDK query() for agent execution
 *
 * @see {@link https://docs.anthropic.com/en/docs/claude-code/client-sdk}
 */

import type { AgentType } from '../agents/types';
import { AGENT_TOOL_PERMISSIONS } from '../agents/types';

/**
 * Configuration options for creating a Claude SDK client.
 */
export interface ClientConfig {
  /** Project root path for capability detection */
  projectDir: string;
  /** Spec directory for tool permissions */
  specDir: string;
  /** Claude model identifier */
  model?: string;
  /** Agent type for tool permission scoping */
  agentType?: AgentType;
  /** Extended thinking budget in tokens (null, 5000, 10000, 16000) */
  maxThinkingTokens?: number | null;
}

/**
 * Default model to use if not specified.
 */
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

/**
 * Map agent types to their default thinking levels.
 * Based on reference implementation patterns.
 */
const DEFAULT_THINKING_LEVELS: Record<AgentType, number | null> = {
  planner: 10000,    // High thinking for complex planning
  coder: null,       // No thinking for fast code execution
  reviewer: 10000,   // High thinking for thorough review
};

/**
 * Get the list of allowed Claude SDK tools for an agent type.
 *
 * @param agentType - Agent type to get tools for
 * @returns Array of tool names allowed for this agent
 *
 * @example
 * ```ts
 * const tools = getAllowedTools('planner');
 * // Returns: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']
 * ```
 */
export function getAllowedTools(agentType: AgentType): string[] {
  const permissions = AGENT_TOOL_PERMISSIONS[agentType];
  const tools: string[] = [];

  if (permissions.Read) tools.push('Read');
  if (permissions.Glob) tools.push('Glob');
  if (permissions.Grep) tools.push('Grep');
  if (permissions.Write) tools.push('Write');
  if (permissions.Edit) tools.push('Edit');
  if (permissions.Bash) tools.push('Bash');
  if (permissions.WebFetch) tools.push('WebFetch');
  if (permissions.WebSearch) tools.push('WebSearch');

  return tools;
}

/**
 * Get the default thinking budget for an agent type.
 *
 * @param agentType - Agent type to get thinking budget for
 * @returns Default thinking token budget or null
 *
 * @example
 * ```ts
 * const budget = getDefaultThinkingBudget('planner');
 * // Returns: 10000
 * ```
 */
export function getDefaultThinkingBudget(agentType: AgentType): number | null {
  return DEFAULT_THINKING_LEVELS[agentType];
}

/**
 * Validate client configuration.
 *
 * @param config - Configuration to validate
 * @throws Error if configuration is invalid
 */
function validateConfig(config: ClientConfig): void {
  if (!config.projectDir || config.projectDir.trim().length === 0) {
    throw new Error('projectDir is required and cannot be empty');
  }

  if (!config.specDir || config.specDir.trim().length === 0) {
    throw new Error('specDir is required and cannot be empty');
  }

  // Validate model identifier format (basic check)
  const model = config.model || DEFAULT_MODEL;
  if (!model.startsWith('claude-')) {
    throw new Error(`Invalid model identifier: ${model}. Model must start with 'claude-'`);
  }

  // Validate maxThinkingTokens if provided
  if (config.maxThinkingTokens !== undefined && config.maxThinkingTokens !== null) {
    if (typeof config.maxThinkingTokens !== 'number') {
      throw new Error('maxThinkingTokens must be a number or null');
    }
    if (config.maxThinkingTokens < 0) {
      throw new Error('maxThinkingTokens must be non-negative');
    }
    // Claude SDK supports thinking tokens up to 200000
    if (config.maxThinkingTokens > 200000) {
      throw new Error('maxThinkingTokens cannot exceed 200000');
    }
  }
}

/**
 * Create a configured Claude SDK client.
 *
 * This factory function creates a Claude SDK client with:
 * - Proper tool permissions scoped to agent type
 * - Model configuration with optional extended thinking
 * - Security settings for filesystem access
 * - Integration with MCP servers (if configured)
 *
 * The returned client provides a `query()` method for agent execution,
 * following the Claude Agent SDK patterns.
 *
 * @param config - Client configuration options
 * @returns Configured client instance with query() support
 *
 * @example
 * ```ts
 * const client = createClient({
 *   projectDir: '/path/to/project',
 *   specDir: '/path/to/spec',
 *   agentType: 'planner',
 * });
 *
 * // Use query() for agent execution
 * const agent = client.query('Plan the implementation', {
 *   allowed_tools: getAllowedTools('planner')
 * });
 *
 * for await (const chunk of agent) {
 *   if (chunk.type === 'content') {
 *     console.log(chunk.content);
 *   }
 * }
 * ```
 */
export function createClient(config: ClientConfig): ClaudeSDKClient {
  // Validate configuration
  validateConfig(config);

  // Determine agent type and model
  const agentType = config.agentType ?? 'coder';
  const model = config.model ?? DEFAULT_MODEL;

  // Determine thinking budget
  let maxThinkingTokens = config.maxThinkingTokens;
  if (maxThinkingTokens === undefined) {
    maxThinkingTokens = getDefaultThinkingBudget(agentType);
  }

  // Get allowed tools for this agent type
  const allowedTools = getAllowedTools(agentType);

  // Create client configuration
  const clientConfig: ClaudeSDKClientConfig = {
    model,
    // Security: Restrict filesystem to project directory
    workingDirectory: config.projectDir,
    // Tool permissions
    allowedTools,
    // Extended thinking configuration
    thinking: {
      budgetTokens: maxThinkingTokens ?? undefined,
    },
    // Environment variables for API keys
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    },
  };

  // Create and return the client
  // Note: The actual SDK client will be instantiated when query() is called
  return new ClaudeSDKClient(clientConfig, config);
}

/**
 * Claude SDK Client wrapper.
 *
 * Provides a wrapper around the Claude Agent SDK's query() function
 * with pre-configured settings for the agent system.
 *
 * This class implements the Client interface expected by the agents,
 * providing the query() method for agent execution.
 */
export class ClaudeSDKClient {
  private readonly config: ClaudeSDKClientConfig;
  private readonly clientConfig: ClientConfig;

  constructor(config: ClaudeSDKClientConfig, clientConfig: ClientConfig) {
    this.config = config;
    this.clientConfig = clientConfig;
  }

  /**
   * Execute a query with the Claude SDK.
   *
   * This is the primary method for agent execution. It creates an async
   * generator that yields streaming response chunks from Claude.
   *
   * @param prompt - The user prompt to send to Claude
   * @param options - Optional query configuration overrides
   * @returns Async generator yielding response chunks
   *
   * @example
   * ```ts
   * const agent = client.query('Implement user authentication', {
   *   allowed_tools: ['Read', 'Write', 'Edit', 'Bash']
   * });
   *
   * for await (const chunk of agent) {
   *   if (chunk.type === 'content') {
   *     console.log(chunk.content);
   *   }
   * }
   * ```
   */
  async *query(
    prompt: string,
    options?: Partial<ClaudeSDKClientConfig>
  ): AsyncGenerator<ClaudeSDKChunk, void, unknown> {
    // Import query dynamically to avoid issues if SDK is not installed
    const { query: sdkQuery } = await import('@anthropic-ai/claude-code');

    // Merge client config with query options
    const queryOptions = {
      ...this.config,
      ...options,
      // Ensure working directory is set
      workingDirectory: this.config.workingDirectory,
      // Ensure model is set
      model: options?.model ?? this.config.model,
    };

    // Call the SDK's query function and yield chunks
    const agent = sdkQuery(prompt, queryOptions);

    for await (const chunk of agent) {
      yield chunk;
    }
  }

  /**
   * Get the client configuration.
   *
   * @returns Client configuration object (read-only)
   */
  getConfig(): Readonly<ClientConfig> {
    return { ...this.clientConfig };
  }

  /**
   * Get the model being used by this client.
   *
   * @returns Model identifier
   */
  getModel(): string {
    return this.config.model;
  }

  /**
   * Get the allowed tools for this client.
   *
   * @returns Array of allowed tool names
   */
  getAllowedTools(): string[] {
    return this.config.allowedTools ?? [];
  }

  /**
   * Get the working directory for this client.
   *
   * @returns Working directory path
   */
  getWorkingDirectory(): string {
    return this.config.workingDirectory;
  }
}

/**
 * Internal interface for Claude SDK client configuration.
 */
interface ClaudeSDKClientConfig {
  /** Claude model to use */
  model: string;
  /** Working directory for file operations */
  workingDirectory: string;
  /** Allowed tools for this agent */
  allowedTools?: string[];
  /** Extended thinking configuration */
  thinking?: {
    budgetTokens?: number;
  };
  /** Environment variables */
  env?: {
    ANTHROPIC_API_KEY?: string;
  };
}

/**
 * Response chunk from Claude SDK query().
 *
 * Chunks are yielded as Claude streams responses.
 *
 * @example
 * ```ts
 * for await (const chunk of client.query('Hello')) {
 *   if (chunk.type === 'content') {
 *     console.log(chunk.content); // "Hello! How can I help..."
 *   } else if (chunk.type === 'tool_use') {
 *     console.log(chunk.tool); // "Read"
 *   }
 * }
 * ```
 */
export interface ClaudeSDKChunk {
  /** Type of chunk */
  type: 'content' | 'tool_use' | 'tool_result' | 'error' | 'metadata';
  /** Content text (for type='content') */
  content?: string;
  /** Tool name (for type='tool_use') */
  tool?: string;
  /** Tool input (for type='tool_use') */
  toolInput?: unknown;
  /** Tool result (for type='tool_result') */
  toolResult?: unknown;
  /** Error message (for type='error') */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}
