# Coding Conventions

**Analysis Date:** 2026-01-16

## Naming Patterns

**Files:**
- camelCase.ts for TypeScript modules (coordination.ts, client.ts, convexClient.ts)
- kebab-case.config.ts for config files (vitest.integration.config.ts)
- *.test.ts for test files (co-located with source)
- *.md for documentation and prompts

**Functions:**
- camelCase for all functions (parseArgs, validateEnvironment, executeAgent)
- No special prefix for async functions
- handleEventName for event handlers (not commonly used)

**Variables:**
- camelCase for variables (taskId, agentType, taskDescription)
- UPPER_SNAKE_CASE for constants (AGENT_TOOL_PERMISSIONS, DEFAULT_MODEL)
- No underscore prefix (no private marker in TS)

**Types:**
- PascalCase for interfaces, no I prefix (AgentConfig, AgentResult, ClientConfig)
- PascalCase for type aliases (AgentType, TaskStatus, ReviewStatus)
- PascalCase for enum names, camelCase for values (AgentType.Planner, TaskStatus.Pending)

## Code Style

**Formatting:**
- Prettier with prettier.config.js
- 2-space indentation
- Single quotes for strings
- Semicolons required (inferred from ESLint config)
- Line endings: LF (newLine: "lf" in tsconfig.json)

**Linting:**
- ESLint with eslint.config.js
- Extends TypeScript ESLint recommended rules
- Run: npm run lint

## Import Organization

**Order:**
1. External packages (built-in Node.js modules)
2. Internal dependencies (@anthropic-ai/claude-agent-sdk, convex)
3. Relative imports (./types, ./base)
4. Type imports (import type {})

**Grouping:**
- No explicit blank line groups observed
- Relative imports use ./ for same directory, ../ for parent

**Path Aliases:**
- @/ → src/*
- @agents/ → src/agents/*
- @core/ → src/core/*
- @cli/ → src/cli/*
- @prompts/ → src/prompts/*

## Error Handling

**Patterns:**
- Custom error classes extend Error (AgentExecutionError, WorkflowError)
- Throw errors, catch at coordination/boundary layer
- Errors stored in Convex for resume capability
- Async functions use try/catch, no .catch() chains

**Error Types:**
- Throw on invalid input, missing dependencies, agent failures
- Error messages include context (agent type, task ID)
- Errors logged to console.error with prefixes ([Planner], [Coder], [Reviewer])

## Logging

**Framework:**
- console.log for normal output
- console.error for errors
- console.warn for warnings

**Patterns:**
- Agent-prefixed logging: `[AgentType] message`
- CLI uses formatted output with separators (=, -)
- Structured progress updates during workflow execution
- No structured logging framework

## Comments

**When to Comment:**
- JSDoc blocks for all public interfaces and classes
- Architecture pattern descriptions in file headers
- Inline comments for complex logic or workarounds
- Avoid obvious comments

**JSDoc/TSDoc:**
- Required for public APIs and classes
- Format: /** */ with @param, @returns tags where applicable
- Example: src/agents/types.ts has comprehensive JSDoc for all types

**TODO Comments:**
- Format: // TODO: description
- Found in: src/core/coordination.ts (3 TODOs for unimplemented Convex mutations)

## Function Design

**Size:**
- Some large files (>400 lines): src/core/coordination.ts (650 lines), src/agents/coder.ts (493 lines)
- Target: Keep under 200 lines where possible

**Parameters:**
- Destructure objects in parameter list: function create({ id, name }: CreateParams)
- Use options objects for multiple parameters

**Return Values:**
- Explicit return statements
- Return early for guard clauses
- Agent results follow AgentResult interface pattern

## Module Design

**Exports:**
- Named exports preferred
- Default exports not commonly used
- Type exports: export type { AgentConfig, AgentResult }

**Barrel Files:**
- Not commonly used (imports reference specific files)
- Types centralized in src/agents/types.ts

---

*Convention analysis: 2026-01-16*
*Update when patterns change*
