# Architecture

**Analysis Date:** 2026-01-16

## Pattern Overview

**Overall:** Sequential Agent Coordination with State Backend

**Key Characteristics:**
- Three-agent workflow: Planner → Coder → Reviewer
- Each agent runs in isolated Claude SDK session
- Convex serves as the state backend for persistence and resume capability
- CLI-driven entry point with command-line argument parsing

## Layers

**CLI Layer:** (`src/cli/index.ts`)
- Purpose: Entry point, argument parsing, user interaction
- Contains: CLI argument parsing, help text, progress display
- Depends on: Coordination layer for workflow execution
- Used by: User via npm start commands

**Coordination Layer:** (`src/core/coordination.ts`)
- Purpose: Workflow orchestration, state management, agent coordination
- Contains: runAgentWorkflow(), executeAgent(), state persistence logic
- Depends on: Agent layer for execution, Convex for state
- Used by: CLI layer

**Agent Layer:** (`src/agents/`)
- Purpose: Individual agent implementations (Planner, Coder, Reviewer)
- Contains: BaseAgent, PlannerAgent, CoderAgent, ReviewerAgent
- Depends on: Core client for Claude SDK, prompts for system behavior
- Used by: Coordination layer

**Data Layer:** (`convex/`)
- Purpose: State persistence and retrieval
- Contains: Schema definitions, queries, mutations
- Depends on: Convex backend
- Used by: All layers via Convex client

**Prompt Layer:** (`src/prompts/`)
- Purpose: System prompts for each agent type
- Contains: planner.md, coder.md, reviewer.md
- Depends on: None (static markdown files)
- Used by: Agent layer

## Data Flow

**CLI Command Execution:**

1. User runs: npm start -- --task "description"
2. CLI parses args and validates environment (`src/cli/index.ts`)
3. Coordination layer creates task in Convex (`src/core/coordination.ts`)
4. Planner agent executes with read-only tools
5. Plan stored in Convex, Coder agent executes with full tools
6. Code changes stored in Convex, Reviewer agent validates
7. Review result stored, task marked complete/failed
8. CLI displays final results to user

**Resume Flow:**
1. User runs: npm start -- --continue
2. Convex queried for latest incomplete task
3. State restored, workflow continues from last agent
4. Error cleared if present, execution resumes

**State Management:**
- All state persisted in Convex (tasks, agentSessions, plans, codeChanges, reviews)
- No persistent in-memory state
- Each agent execution is independent but context is passed via Convex

## Key Abstractions

**BaseAgent:** (`src/agents/base.ts`)
- Purpose: Abstract base class providing common functionality
- Examples: PlannerAgent, CoderAgent, ReviewerAgent extend BaseAgent
- Pattern: Abstract class with execute(), tool permission management

**AgentSession:** (`src/agents/types.ts`)
- Purpose: Tracks agent execution state
- Pattern: State object stored in Convex, updated during workflow

**Tool Permissions:** (`src/agents/types.ts`)
- Purpose: Restrict agent capabilities based on role
- Examples: AGENT_TOOL_PERMISSIONS[AgentType.Planner] = read-only
- Pattern: Configuration object mapping agent types to allowed tools

**Workflow Orchestration:** (`src/core/coordination.ts`)
- Purpose: Coordinate sequential agent execution with error handling
- Pattern: State machine with resume capability

## Entry Points

**CLI Entry:** (`src/cli/index.ts`)
- Location: src/cli/index.ts
- Triggers: User runs npm start with arguments
- Responsibilities: Parse args, validate env, display progress, handle errors

**Convex Functions:** (`convex/tasks.ts`, `convex/agentSessions.ts`)
- Location: convex/*.ts files
- Triggers: Called by coordination layer
- Responsibilities: Database queries and mutations

## Error Handling

**Strategy:** Throw exceptions, catch at coordination level, persist to Convex, display to user

**Patterns:**
- Custom error classes: AgentExecutionError, WorkflowError (`src/agents/types.ts`)
- Errors stored in Convex for resume capability
- CLI displays user-friendly error messages with resume instructions
- Agent execution failures mark task as failed, don't crash process

## Cross-Cutting Concerns

**Logging:**
- Console-based logging with agent prefixes ([Planner], [Coder], [Reviewer])
- CLI displays formatted output with progress updates
- No structured logging framework

**Validation:**
- Environment variable validation in CLI
- TypeScript strict mode for type safety
- Tool permission enforcement via AGENT_TOOL_PERMISSIONS

**State Management:**
- All state persisted to Convex backend
- Resume capability via --continue flag
- Error state tracked and clearable for retries

---

*Architecture analysis: 2026-01-16*
*Update when major patterns change*
