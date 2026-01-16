# Coding Agent

Autonomous coding agents using the Claude Agent SDK in TypeScript/Node.js, with self-hosted Convex for persistence and state management.

## Overview

This is a learning POC (Proof of Concept) that implements a sequential three-agent workflow for autonomous coding tasks:

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Planner    │───▶│    Coder     │───▶│  Reviewer    │
│   Agent      │    │    Agent     │    │    Agent     │
└──────────────┘    └──────────────┘    └──────────────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            ▼
                    ┌──────────────┐
                    │   Convex     │
                    │   State      │
                    └──────────────┘
```

### Agent Workflow

1. **Planner Agent** - Analyzes your task and creates a structured implementation plan
2. **Coder Agent** - Executes the plan by reading, creating, and modifying files
3. **Reviewer Agent** - Validates the implementation against acceptance criteria

All agent interactions are persisted to Convex for observability and resume capability.

## Features

- **Multi-Agent Coordination**: Sequential execution of specialized agents with context passing
- **State Persistence**: All tasks, agent sessions, and results stored in Convex
- **Error Recovery**: Resume from failed tasks using `--continue` flag
- **CLI Interface**: Simple command-line interface for running agent workflows
- **TypeScript**: Full type safety with strict mode enabled
- **Self-Hosted Backend**: Convex runs locally via Docker Compose

## Prerequisites

- **Node.js** 18+ or higher (required by Claude SDK)
- **npm** 10+ or higher
- **Docker** and **Docker Compose** for Convex backend
- **Anthropic API Key** - Get one at [https://console.anthropic.com/](https://console.anthropic.com/)

## Installation

1. **Clone the repository:**
   ```bash
   cd /Users/wharsojo/dev/coding-agent
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your API key:
   ```bash
   # Claude API
   ANTHROPIC_API_KEY=sk-ant-...

   # Convex Self-Hosted Configuration
   CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
   CONVEX_SELF_HOSTED_ADMIN_KEY=<generate after starting Convex>
   CONVEX_CLOUD_ORIGIN=http://127.0.0.1:3210
   CONVEX_SITE_ORIGIN=http://127.0.0.1:3211

   # Optional
   NODE_ENV=development
   LOG_LEVEL=info
   ```

## Starting the Backend

### 1. Start Convex with Docker Compose

```bash
docker compose up -d
```

This starts:
- **Convex Backend** on `http://localhost:3210`
- **Convex Dashboard** on `http://localhost:6791`
- **Convex Site Proxy** on `http://localhost:3211`

### 2. Verify Convex is running

```bash
curl http://localhost:3210/version
```

Expected: `200 OK` with version information

### 3. Generate admin key for dashboard access

```bash
docker compose exec backend ./generate_admin_key.sh
```

Copy the generated admin key to your `.env` file:
```
CONVEX_SELF_HOSTED_ADMIN_KEY=<generated-key>
```

### 4. Initialize Convex (first time only)

```bash
npx convex dev
```

This deploys your schema and generates TypeScript types.

## Usage

### Basic Usage

Run a task through the full agent workflow:

```bash
npm start -- --task "Implement user authentication"
```

### CLI Options

| Option | Short | Description |
|--------|-------|-------------|
| `--task <description>` | `-t` | Task description to process |
| `--plan-only` | | Only run Planner, don't execute code |
| `--skip-review` | | Skip Reviewer agent |
| `--continue` | | Resume from last incomplete task |
| `--help` | `-h` | Show usage information |

### Examples

**Plan only (see what the agent would do):**
```bash
npm start -- --task "Add logging" --plan-only
```

**Skip review for quick iterations:**
```bash
npm start -- --task "Fix typo in README" --skip-review
```

**Resume after failure:**
```bash
npm start -- --continue
```

### Watching Progress

The CLI displays real-time progress as each agent executes:

```
╔════════════════════════════════════════════════════════════╗
║           Coding Agent - Autonomous Development           ║
╚════════════════════════════════════════════════════════════╝

Task: Implement user authentication

[Planner] Analyzing codebase and creating plan...
[Planner] ✓ Plan created with 5 steps

[Coder] Implementing changes...
  [Coder] Creating src/auth/login.ts
  [Coder] Modifying src/index.ts
[Coder] ✓ Code changes complete

[Reviewer] Validating implementation...
[Reviewer] ✓ Review passed

═════════════════════════════════════════════════════════════
✓ Task completed successfully
═════════════════════════════════════════════════════════════
```

## Project Structure

```
coding-agent/
├── convex/                    # Convex backend
│   ├── schema.ts             # Database schema
│   ├── tasks.ts              # Task management functions
│   ├── agentSessions.ts      # Agent session tracking
│   ├── plans.ts              # Plan storage
│   ├── codeChanges.ts        # Code change tracking
│   └── reviews.ts            # Review storage
├── src/
│   ├── agents/               # Agent implementations
│   │   ├── base.ts           # Base agent class
│   │   ├── planner.ts        # Planner agent
│   │   ├── coder.ts          # Coder agent
│   │   ├── reviewer.ts       # Reviewer agent
│   │   └── types.ts          # Shared types
│   ├── cli/                  # Command-line interface
│   │   └── index.ts          # CLI entry point
│   ├── core/                 # Core SDK and coordination
│   │   ├── client.ts         # Claude SDK client factory
│   │   ├── coordination.ts   # Agent orchestration logic
│   │   └── convexClient.ts   # Convex client singleton
│   └── prompts/              # System prompts
│       ├── planner.md        # Planner system prompt
│       ├── coder.md          # Coder system prompt
│       └── reviewer.md       # Reviewer system prompt
├── docker-compose.yml        # Convex deployment
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── .env.example              # Environment variables template
└── README.md                 # This file
```

## Architecture

### Agent Types

| Agent | Tools | Purpose |
|-------|-------|---------|
| **Planner** | Read, Glob, Grep, WebFetch, WebSearch | Analyzes codebase, creates implementation plan |
| **Coder** | Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch | Implements code changes based on plan |
| **Reviewer** | Read, Glob, Grep | Validates implementation against plan and acceptance criteria |

### Convex Data Model

- **tasks** - User tasks and execution status
- **agentSessions** - Individual agent executions with results
- **plans** - Implementation plans from Planner agent
- **codeChanges** - File modifications made by Coder agent
- **reviews** - Validation results from Reviewer agent

### Error Handling

All agent failures are captured and stored in Convex:

- Failed agents store error messages
- Task status updated to `failed`
- Resume capability with `--continue` flag
- Automatic retry logic for Convex connection issues

## Development

### Build TypeScript

```bash
npm run build
```

### Development Mode (with hot reload)

```bash
npm run dev
```

### Run Tests

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# End-to-end tests
npm run test:e2e
```

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
npm run lint
```

### Formatting

```bash
# Format code
npm run format

# Check format
npm run format:check
```

### Convex Dashboard

Access the Convex dashboard at [http://localhost:6791](http://localhost:6791) to:

- View all tasks and their status
- Inspect agent sessions and results
- Browse database tables
- Query data interactively

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled CLI |
| `npm run dev` | Development mode with hot reload |
| `npm test` | Run unit tests |
| `npm run typecheck` | Type check without compiling |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |
| `npm run convex:dev` | Start Convex dev server |
| `npm run convex:codegen` | Generate TypeScript types from schema |

## Troubleshooting

### Convex Backend Won't Start

```bash
# Check Docker logs
docker compose logs backend

# Restart Convex
docker compose restart backend
```

### "Convex connection failed" Error

1. Verify Convex is running: `curl http://localhost:3210/version`
2. Check `.env` has correct `CONVEX_SELF_HOSTED_URL`
3. Run `npx convex dev` to initialize schema

### "No module '@anthropic-ai/claude-agent-sdk'" Error

```bash
rm -rf node_modules package-lock.json
npm install
```

### Agent Fails Mid-Execution

Resume from the last state:
```bash
npm start -- --continue
```

## License

MIT

## Technical Details

### Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.9+
- **SDK**: [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- **Backend**: Convex (self-hosted)
- **Database**: SQLite (default) or Postgres
- **Deployment**: Docker Compose

### Key Patterns

- **Sequential Agent Execution**: Planner → Coder → Reviewer
- **Agent-Session Pattern**: Isolated sessions with state tracking
- **Memory-First Architecture**: All interactions stored in Convex
- **Context Passing**: Results from previous agents passed to next agents
- **Resume Capability**: Failed tasks can be resumed from last state

### Reference Implementation

Based on patterns from [Auto-Claude2](https://github.com/anthropics/auto-claude), adapted for TypeScript with reusable architectural patterns.
