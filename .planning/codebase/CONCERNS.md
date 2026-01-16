# Codebase Concerns

**Analysis Date:** 2026-01-16

## Tech Debt

**Unimplemented Convex mutations:**
- Issue: TODO comments in `src/core/coordination.ts` (lines 182, 245, 303) for missing Convex functions
- Why: Functions (plans/store, codeChanges/record, reviews/store) not yet implemented in Convex
- Impact: Plan, code changes, and review data not being persisted to database
- Fix approach: Implement missing Convex mutations in `convex/plans.ts`, `convex/codeChanges.ts`, `convex/reviews.ts`

**Large coordination file:**
- Issue: `src/core/coordination.ts` is 650 lines
- Why: Complex workflow orchestration in single file
- Impact: Difficult to navigate and maintain
- Fix approach: Extract smaller modules (workflow-manager.ts, state-manager.ts, agent-executor.ts)

**No package-lock.json:**
- Issue: No lockfile for npm dependencies
- Why: Not checked into repository
- Impact: Inconsistent dependency versions across environments
- Fix approach: Run `npm install` to generate package-lock.json and commit it

## Known Bugs

**Not detected** - No known bugs identified during analysis

## Security Considerations

**Test API keys in code:**
- Risk: Hardcoded test API keys (`sk-ant-test-key`) in multiple test files
- Files: `src/__tests__/integration/full-workflow.test.ts`, `state-persistence.test.ts`, `error-recovery.test.ts`
- Current mitigation: Test-only keys, not production
- Recommendations: Use environment variables for test keys, or mock at higher level

**Environment variable validation:**
- Risk: CLI validates required env vars but doesn't validate optional ones
- File: `src/cli/index.ts`
- Current mitigation: Fails fast on missing required vars
- Recommendations: Add validation for optional vars with warnings

## Performance Bottlenecks

**Sequential agent execution:**
- Problem: Agents run sequentially (Planner → Coder → Reviewer)
- File: `src/core/coordination.ts`
- Measurement: Full workflow takes 30-60 seconds
- Cause: Each agent requires separate Claude API call
- Improvement path: Consider parallel execution for independent operations (if any)

**N+1 query pattern in tests:**
- Problem: Tests repeatedly call `getAgentSessionsByTask` for same task
- Files: Multiple integration test files
- Measurement: Not quantified, but pattern visible
- Cause: Fetching sessions multiple times in same test
- Improvement path: Cache query results or fetch once and reuse

## Fragile Areas

**Coordination workflow:**
- File: `src/core/coordination.ts` (650 lines)
- Why fragile: Complex orchestration logic with error handling and state management
- Common failures: Unimplemented Convex mutations cause silent failures
- Safe modification: Add tests before refactoring, implement missing mutations first
- Test coverage: Integration tests cover basic workflow, but missing edge cases

**Agent error handling:**
- File: `src/agents/base.ts`, `src/core/coordination.ts`
- Why fragile: Error handling relies on proper state persistence
- Common failures: If Convex mutations fail, errors not properly persisted
- Safe modification: Add comprehensive error logging, test failure scenarios
- Test coverage: Limited test coverage for error scenarios

## Scaling Limits

**Convex free tier:**
- Current capacity: Dependent on Convex free tier limits
- Limit: Unknown (depends on Convex pricing)
- Symptoms at limit: Database write failures
- Scaling path: Upgrade to paid Convex tier or self-hosted scaling

**Sequential workflow execution:**
- Current capacity: One task at a time
- Limit: No parallel task execution
- Symptoms at limit: Tasks queue sequentially
- Scaling path: Implement parallel task execution with queue management

## Dependencies at Risk

**@anthropic-ai/claude-agent-sdk:**
- Risk: Exact version pinning (^1.0.0) may miss patch updates
- Impact: Bug fixes not automatically applied
- Migration plan: Allow patch updates (^1.0.x) or use ~ for minor updates

**convex:**
- Risk: Version ^1.17.2 may be outdated
- Impact: Missing features or bug fixes
- Migration plan: Check for newer versions, test compatibility

## Missing Critical Features

**Convex mutations:**
- Problem: plans, codeChanges, and reviews mutations not implemented
- Current workaround: Data not persisted, only tasks and agentSessions work
- Blocks: Full workflow traceability and debugging
- Implementation complexity: Low (straightforward Convex mutations)

**Lockfile:**
- Problem: No package-lock.json
- Current workaround: Inconsistent dependency versions
- Blocks: Reproducible builds
- Implementation complexity: Trivial (run `npm install`)

## Test Coverage Gaps

**Base agent class:**
- What's not tested: `src/agents/base.ts` has no unit tests
- Risk: Base agent behavior changes could break all agents
- Priority: High
- Difficulty to test: Requires mocking Claude SDK

**Core client factory:**
- What's not tested: `src/core/client.ts` has no unit tests
- Risk: Client configuration issues could affect all agents
- Priority: High
- Difficulty to test: Requires understanding Claude SDK internals

**Convex modules:**
- What's not tested: `convex/plans.ts`, `convex/codeChanges.ts`, `convex/reviews.ts`, `convex/agentSessions.ts`
- Risk: Database operations not verified
- Priority: Medium (functions not yet implemented for some)
- Difficulty to test: Requires Convex test setup

**CLI error scenarios:**
- What's not tested: Limited coverage of CLI error handling
- Risk: Poor error messages for edge cases
- Priority: Low
- Difficulty to test: Requires CLI test harness

---

*Concerns audit: 2026-01-16*
*Update as issues are fixed or new ones discovered*
