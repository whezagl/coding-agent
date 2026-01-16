# External Integrations

**Analysis Date:** 2026-01-16

## APIs & External Services

**AI/ML:**
- Anthropic Claude API - AI agent execution
  - SDK/Client: @anthropic-ai/claude-agent-sdk v1.0.0
  - Auth: ANTHROPIC_API_KEY env var
  - Models used: claude-sonnet-4-5-20250929 (default), with configurable thinking budgets per agent type

## Data Storage

**Databases:**
- Convex (self-hosted) - Primary state backend
  - Connection: via CONVEX_DEPLOYMENT env var or Docker Compose
  - Client: convex npm package v1.17.2
  - Migrations: Applied via convex CLI (npx convex dev)

**File Storage:**
- Not applicable (state stored in Convex)

**Caching:**
- Not detected

## Authentication & Identity

**Auth Provider:**
- Convex admin authentication - Self-hosted backend
  - Implementation: CONVEX_SELF_HOSTED_ADMIN_KEY env var
  - Token storage: Managed by Convex backend
  - Session management: Handled by Convex authentication

**OAuth Integrations:**
- None

## Monitoring & Observability

**Error Tracking:**
- None (uses console.error for error output)

**Analytics:**
- None

**Logs:**
- Console-based logging (console.log, console.error, console.warn)
- No structured logging service

## CI/CD & Deployment

**Hosting:**
- Not applicable (CLI tool runs locally)

**CI Pipeline:**
- Not detected

## Environment Configuration

**Development:**
- Required env vars: ANTHROPIC_API_KEY, CONVEX_DEPLOYMENT, CONVEX_SELF_HOSTED_ADMIN_KEY
- Secrets location: .env file (gitignored)
- Mock/stub services: Test API keys used in tests (sk-ant-test-key)

**Staging:**
- Not applicable

**Production:**
- Secrets management: User's local environment via .env file
- No production deployment (CLI tool)

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None (agents make direct API calls to Anthropic)

---

*Integration audit: 2026-01-16*
*Update when adding/removing external services*
