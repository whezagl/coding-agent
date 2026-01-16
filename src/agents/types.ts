/**
 * Shared agent types and interfaces for the coding agent system.
 *
 * This module defines the core types used across all agent implementations,
 * including agent types, statuses, configurations, and execution results.
 */

/**
 * The three core agent types in the system.
 * Each agent has a specific role in the sequential workflow:
 * Planner → Coder → Reviewer
 */
export enum AgentType {
  /** Creates implementation plans based on task descriptions */
  Planner = 'planner',
  /** Implements code changes based on plans */
  Coder = 'coder',
  /** Reviews and validates implementation results */
  Reviewer = 'reviewer',
}

/**
 * Execution status of an agent session.
 * Follows the lifecycle: pending → running → completed/failed
 */
export enum AgentSessionStatus {
  /** Agent is queued but not yet started */
  Pending = 'pending',
  /** Agent is currently executing */
  Running = 'running',
  /** Agent completed successfully */
  Completed = 'completed',
  /** Agent failed with an error */
  Failed = 'failed',
}

/**
 * Overall status of a task.
 * Tasks progress through these statuses as agents execute.
 */
export enum TaskStatus {
  /** Task is created but not yet processed */
  Pending = 'pending',
  /** Planner agent is working on the task */
  Planning = 'planning',
  /** Plan is complete, Coder agent is working */
  Coding = 'coding',
  /** Code is complete, Reviewer agent is working */
  Reviewing = 'reviewing',
  /** All agents completed successfully */
  Completed = 'completed',
  /** Task failed at some stage */
  Failed = 'failed',
}

/**
 * Result of a review by the Reviewer agent.
 */
export enum ReviewStatus {
  /** Implementation meets all acceptance criteria */
  Passed = 'passed',
  /** Implementation has critical issues */
  Failed = 'failed',
  /** Implementation needs revisions before approval */
  NeedsRevision = 'needs_revision',
}

/**
 * Types of file changes made by the Coder agent.
 */
export enum ChangeType {
  /** Creating a new file */
  Create = 'create',
  /** Modifying an existing file */
  Edit = 'edit',
  /** Deleting a file */
  Delete = 'delete',
}

/**
 * Tool permissions available to each agent type.
 * Maps agent types to their allowed Claude SDK tools.
 */
export interface AgentToolPermissions {
  /** Read file contents */
  Read: boolean;
  /** Pattern-based file search */
  Glob: boolean;
  /** Content search in files */
  Grep: boolean;
  /** Write new files */
  Write: boolean;
  /** Edit existing files */
  Edit: boolean;
  /** Execute shell commands */
  Bash: boolean;
  /** Fetch web content */
  WebFetch: boolean;
  /** Web search */
  WebSearch: boolean;
}

/**
 * Tool permissions configuration for each agent type.
 * Planner: Read-only tools for codebase analysis
 * Coder: Read + Write + Bash for implementation
 * Reviewer: Read-only tools for validation
 */
export const AGENT_TOOL_PERMISSIONS: Record<AgentType, AgentToolPermissions> = {
  [AgentType.Planner]: {
    Read: true,
    Glob: true,
    Grep: true,
    Write: false,
    Edit: false,
    Bash: false,
    WebFetch: true,
    WebSearch: true,
  },
  [AgentType.Coder]: {
    Read: true,
    Glob: true,
    Grep: true,
    Write: true,
    Edit: true,
    Bash: true,
    WebFetch: true,
    WebSearch: true,
  },
  [AgentType.Reviewer]: {
    Read: true,
    Glob: true,
    Grep: true,
    Write: false,
    Edit: false,
    Bash: false,
    WebFetch: false,
    WebSearch: false,
  },
} as const;

/**
 * Configuration for creating an agent session.
 */
export interface AgentConfig {
  /** Type of agent to create */
  agentType: AgentType;
  /** Task description or context */
  taskDescription: string;
  /** Working directory for file operations */
  workingDirectory: string;
  /** Optional Convex task ID for state tracking */
  taskId?: string;
  /** Optional model override */
  model?: string;
}

/**
 * Result returned after an agent completes execution.
 */
export interface AgentResult {
  /** Agent that produced this result */
  agentType: AgentType;
  /** Whether the agent succeeded */
  success: boolean;
  /** Primary result content (plan, code changes, or review) */
  content: string;
  /** Error message if execution failed */
  error?: string;
  /** Timestamp when agent completed */
  completedAt: Date;
  /** Additional metadata specific to agent type */
  metadata?: AgentResultMetadata;
}

/**
 * Additional metadata specific to each agent type's result.
 */
export interface AgentResultMetadata {
  /** Planner-specific: structured plan with steps */
  plan?: {
    steps: Array<{
      description: string;
      files: string[];
      estimatedComplexity: 'low' | 'medium' | 'high';
    }>;
  };
  /** Coder-specific: files that were modified */
  codeChanges?: Array<{
    filePath: string;
    changeType: ChangeType;
    summary: string;
  }>;
  /** Reviewer-specific: review criteria results */
  review?: {
    status: ReviewStatus;
    criteriaMet: boolean;
    feedback: string;
    issues: Array<{
      severity: 'error' | 'warning' | 'info';
      file?: string;
      message: string;
    }>;
  };
}

/**
 * Base interface for agent session information.
 * Used for tracking agent execution in Convex.
 */
export interface AgentSession {
  /** Unique identifier for the session */
  id: string;
  /** Type of agent executing */
  agentType: AgentType;
  /** Associated task ID */
  taskId: string;
  /** Current execution status */
  status: AgentSessionStatus;
  /** When execution started */
  startedAt: Date;
  /** When execution completed (if finished) */
  completedAt?: Date;
  /** Result content (if completed) */
  result?: string;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Context passed between agents in the workflow.
 * Each agent receives context from previous agents.
 */
export interface AgentContext {
  /** Task being worked on */
  task: {
    description: string;
    id: string;
  };
  /** Plan from Planner agent (available to Coder and Reviewer) */
  plan?: {
    content: string;
    createdAt: Date;
  };
  /** Code changes from Coder agent (available to Reviewer) */
  codeChanges?: Array<{
    filePath: string;
    changeType: ChangeType;
    summary: string;
  }>;
  /** Previous agent sessions for context */
  previousSessions: AgentSession[];
}

/**
 * Options for agent execution.
 */
export interface AgentExecutionOptions {
  /** Whether to execute in dry-run mode (no actual changes) */
  dryRun?: boolean;
  /** Maximum time to wait for agent completion (ms) */
  timeout?: number;
  /** Optional callback for progress updates */
  onProgress?: (update: AgentProgressUpdate) => void;
}

/**
 * Progress update during agent execution.
 */
export interface AgentProgressUpdate {
  /** Agent sending the update */
  agentType: AgentType;
  /** Current activity description */
  activity: string;
  /** Timestamp of the update */
  timestamp: Date;
}

/**
 * Error thrown when agent execution fails.
 */
export class AgentExecutionError extends Error {
  constructor(
    public agentType: AgentType,
    message: string,
    public originalError?: unknown
  ) {
    super(`[${AgentType[agentType]}] ${message}`);
    this.name = 'AgentExecutionError';
  }
}

/**
 * Error thrown when agent workflow coordination fails.
 */
export class WorkflowError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'WorkflowError';
  }
}
