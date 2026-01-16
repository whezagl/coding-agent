# Technology Stack

**Analysis Date:** 2026-01-16

## Languages

**Primary:**
- TypeScript 5.9 - All application code

**Secondary:**
- JavaScript - Build scripts, config files

## Runtime

**Environment:**
- Node.js 18.x (engines field: >=18.0.0)
- ES Modules (type: "module" in package.json)

**Package Manager:**
- npm 10.x+ (engines field: >=10.0.0)
- Lockfile: Not detected (should add package-lock.json)

## Frameworks

**Core:**
- @anthropic-ai/claude-agent-sdk ^1.0.0 - AI agent execution framework
- convex ^1.17.2 - Backend-as-a-service for state management

**Testing:**
- vitest ^2.1.8 - Unit and integration tests
- tsx ^4.19.2 - TypeScript execution for development

**Build/Dev:**
- TypeScript ~5.9.0 - Compilation to JavaScript
- ESLint ^9.17.0 - Code linting
- Prettier ^3.4.2 - Code formatting

## Key Dependencies

**Critical:**
- @anthropic-ai/claude-agent-sdk - Core AI agent framework with Claude API integration
- convex - State persistence and database backend
- dotenv - Environment variable management

**Infrastructure:**
- Node.js built-ins - fs, path, child_process for file operations

## Configuration

**Environment:**
- .env files for environment variables
- Key configs: ANTHROPIC_API_KEY, CONVEX_DEPLOYMENT, CONVEX_SELF_HOSTED_ADMIN_KEY

**Build:**
- tsconfig.json - TypeScript compiler options with path aliases (@/*, @agents/*, @core/*, @cli/*, @prompts/*)
- vitest.integration.config.ts - Integration test configuration
- vitest.e2e.config.ts - E2E test configuration

## Platform Requirements

**Development:**
- Any platform with Node.js 18+
- Docker required for Convex backend (docker-compose.yml)

**Production:**
- CLI tool installed via npm
- Requires self-hosted Convex backend or Convex cloud deployment

---

*Stack analysis: 2026-01-16*
*Update after major dependency changes*
