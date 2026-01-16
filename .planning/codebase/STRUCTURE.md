# Codebase Structure

**Analysis Date:** 2026-01-16

## Directory Layout

```
coding-agent/
├── src/                          # Source code
│   ├── __tests__/               # Integration and E2E tests
│   │   ├── integration/         # Integration test suites
│   │   └── e2e/                # End-to-end tests
│   ├── agents/                  # Agent implementations
│   │   ├── __tests__/          # Agent unit tests
│   │   ├── base.ts             # Abstract base agent
│   │   ├── types.ts            # Shared agent types
│   │   ├── planner.ts          # Planner agent
│   │   ├── coder.ts            # Coder agent
│   │   └── reviewer.ts         # Reviewer agent
│   ├── cli/                     # CLI interface
│   │   └── index.ts            # Main entry point
│   ├── core/                    # Core orchestration logic
│   │   ├── __tests__/          # Core unit tests
│   │   ├── client.ts           # Claude SDK client factory
│   │   ├── convexClient.ts     # Convex client wrapper
│   │   └── coordination.ts     # Agent workflow coordination
│   ├── convex/                  # Convex integration
│   │   ├── __tests__/          # Convex tests
│   │   └── tasks.ts            # Database functions
│   └── prompts/                 # Agent system prompts
│       ├── planner.md          # Planner system prompt
│       ├── coder.md            # Coder system prompt
│       └── reviewer.md         # Reviewer system prompt
├── convex/                      # Convex database schema
│   ├── schema.ts               # Database schema definition
│   ├── tasks.ts                # Task-related functions
│   ├── agentSessions.ts        # Session management
│   ├── plans.ts                # Plan storage
│   ├── codeChanges.ts          # Code change tracking
│   └── reviews.ts              # Review storage
├── scripts/                     # Utility scripts
├── .auto-claude/               # Auto-claude project management
├── .planning/                  # Planning documents
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── vitest.integration.config.ts # Integration test config
├── vitest.e2e.config.ts        # E2E test config
├── eslint.config.js            # ESLint configuration
├── prettier.config.js          # Prettier configuration
└── docker-compose.yml          # Convex development setup
```

## Directory Purposes

**src/__tests__/:**
- Purpose: Integration and E2E test suites
- Contains: full-workflow.test.ts, error-recovery.test.ts, state-persistence.test.ts, simple-task.test.ts, resume.test.ts, plan-only.test.ts
- Key files: Integration tests verify multi-agent workflows, E2E tests verify CLI execution
- Subdirectories: integration/ (workflow tests), e2e/ (CLI tests)

**src/agents/:**
- Purpose: Agent implementations (Planner, Coder, Reviewer)
- Contains: BaseAgent abstract class, concrete agent implementations, shared types
- Key files: base.ts (base class), types.ts (type definitions), planner.ts, coder.ts, reviewer.ts
- Subdirectories: __tests__/ (agent unit tests)

**src/cli/:**
- Purpose: CLI interface and argument parsing
- Contains: Main entry point with Commander.js-like parsing
- Key files: index.ts (CLI entry, argument parsing, progress display)
- Subdirectories: None

**src/core/:**
- Purpose: Core orchestration and client management
- Contains: Claude SDK client factory, Convex client wrapper, workflow coordination
- Key files: client.ts (SDK factory), convexClient.ts (Convex wrapper), coordination.ts (workflow orchestration)
- Subdirectories: __tests__/ (core unit tests)

**src/prompts/:**
- Purpose: System prompts for agent behavior
- Contains: Markdown prompt templates for each agent type
- Key files: planner.md, coder.md, reviewer.md
- Subdirectories: None

**convex/:**
- Purpose: Convex database schema and functions
- Contains: Schema definitions, queries, mutations for state management
- Key files: schema.ts (database schema), tasks.ts (task functions), agentSessions.ts (session tracking)
- Subdirectories: None

## Key File Locations

**Entry Points:**
- `src/cli/index.ts` - CLI entry point (compiled to dist/cli/index.js)
- `convex/schema.ts` - Convex schema entry

**Configuration:**
- `tsconfig.json` - TypeScript config with path aliases (@/*, @agents/*, @core/*, @cli/*, @prompts/*)
- `vitest.integration.config.ts` - Integration test configuration
- `vitest.e2e.config.ts` - E2E test configuration
- `.env.example` - Environment variable template

**Core Logic:**
- `src/core/coordination.ts` - Agent workflow orchestration
- `src/agents/base.ts` - Base agent class
- `src/agents/types.ts` - Type definitions
- `src/core/client.ts` - Claude SDK client factory

**Testing:**
- `src/**/__tests__/**/*.test.ts` - Test files (co-located with source)
- `src/__tests__/integration/` - Integration test suites
- `src/__tests__/e2e/` - End-to-end test suites

## Naming Conventions

**Files:**
- camelCase for modules (coordination.ts, client.ts, convexClient.ts)
- kebab-case for config files (vitest.integration.config.ts)
- UPPERCASE.md for documentation (README.md, VERIFICATION.md)
- *.test.ts for test files

**Directories:**
- kebab-case for all directories (agents, core, prompts)
- __tests__ for test directories

**Special Patterns:**
- index.ts for directory exports (src/cli/index.ts)
- types.ts for type definitions (src/agents/types.ts)
- *.md for prompt files in src/prompts/

## Where to Add New Code

**New Agent:**
- Implementation: `src/agents/{agent-name}.ts`
- Types: Add to `src/agents/types.ts` (AgentType enum, permissions)
- Prompts: `src/prompts/{agent-name}.md`
- Tests: `src/agents/__tests__/{agent-name}.test.ts`

**New Convex Function:**
- Schema: Add table to `convex/schema.ts`
- Queries/Mutations: `convex/{resource}.ts`
- Tests: `src/convex/__tests__/{resource}.test.ts`

**New CLI Command:**
- Implementation: `src/cli/index.ts` (add argument parsing)
- Documentation: Update help text in index.ts

**Utilities:**
- Shared helpers: `src/core/{utility}.ts`
- Type definitions: `src/agents/types.ts` or `src/core/types.ts` (if created)

## Special Directories

**dist/:**
- Purpose: TypeScript compilation output
- Source: Compiled from src/ by TypeScript compiler
- Committed: No (in .gitignore)

**.auto-claude/:**
- Purpose: Auto-claude project management and worktree tracking
- Source: Managed by auto-claude tool
- Committed: Yes (project state)

**.planning/:**
- Purpose: Planning documents and codebase map
- Source: Manual and tool-generated
- Committed: Yes (project documentation)

---

*Structure analysis: 2026-01-16*
*Update when directory structure changes*
