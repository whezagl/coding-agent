# Testing Patterns

**Analysis Date:** 2026-01-16

## Test Framework

**Runner:**
- Vitest 2.1.8
- Config: vitest.integration.config.ts (integration), vitest.e2e.config.ts (E2E)

**Assertion Library:**
- Vitest built-in expect
- Matchers: toBe, toEqual, toThrow, toMatchObject, toHaveLength, etc.

**Run Commands:**
```bash
npm test                              # Run all tests (not configured, uses vitest default)
npm run test:integration              # Integration tests
npm run test:e2e                      # E2E tests
npm run test:coverage                 # Coverage report
```

## Test File Organization

**Location:**
- Co-located with source: src/**/__tests__/**/*.test.ts
- Integration tests: src/__tests__/integration/
- E2E tests: src/__tests__/e2e/

**Naming:**
- *.test.ts for all tests
- Integration tests: {feature}.test.ts (full-workflow.test.ts, error-recovery.test.ts)
- E2E tests: {scenario}.test.ts (simple-task.test.ts, resume.test.ts)

**Structure:**
```
src/
├── __tests__/
│   ├── integration/
│   │   ├── full-workflow.test.ts
│   │   ├── error-recovery.test.ts
│   │   └── state-persistence.test.ts
│   └── e2e/
│       ├── simple-task.test.ts
│       ├── resume.test.ts
│       └── plan-only.test.ts
├── agents/
│   └── __tests__/
│       ├── planner.test.ts
│       └── coder.test.ts
├── core/
│   └── __tests__/
│       └── coordination.test.ts
└── convex/
    └── __tests__/
        └── tasks.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('FeatureName', () => {
  beforeEach(() => {
    // Setup: vi.clearAllMocks(), mock env vars
  });

  it('should handle success case', () => {
    // arrange
    // act
    // assert
  });

  it('should handle error case', async () => {
    // test code
  });
});
```

**Patterns:**
- Use beforeEach for setup, vi.clearAllMocks() in afterEach
- Explicit describe blocks grouping related tests
- Async tests use async/await

## Mocking

**Framework:**
- Vitest built-in mocking (vi)

**Patterns:**
```typescript
// Mock module
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn()
}));

// Mock in test
const mockQuery = vi.mocked(query);
mockQuery.mockResolvedValue({ content: 'test' });
```

**What to Mock:**
- Claude SDK (@anthropic-ai/claude-agent-sdk)
- Convex client (convex)
- Environment variables (process.env)
- File system operations

**What NOT to Mock:**
- Internal utility functions
- Type definitions

## Fixtures and Factories

**Test Data:**
```typescript
// Factory functions in test files
function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: 'test-id',
    description: 'Test task',
    status: 'pending',
    createdAt: Date.now(),
    retryCount: 0,
    ...overrides
  };
}
```

**Location:**
- Factory functions: defined inline in test files
- No shared fixtures directory

## Coverage

**Requirements:**
- No enforced coverage target
- Coverage tracked for awareness

**Configuration:**
- Vitest coverage via v8 provider
- Excludes: node_modules/, dist/, test files, __tests__/, convex/_generated/

**View Coverage:**
```bash
npm run test:coverage
# Output: coverage/ directory
```

## Test Types

**Unit Tests:**
- Location: src/agents/__tests__/, src/core/__tests__/, src/convex/__tests__/
- Scope: Individual components in isolation
- Mock all external dependencies

**Integration Tests:**
- Location: src/__tests__/integration/
- Scope: Complete multi-agent workflows
- Mock external services (Convex, Claude API)

**E2E Tests:**
- Location: src/__tests__/e2e/
- Scope: Full CLI execution with real tasks
- Timeout: 60 seconds (for API calls)
- Requires: Real Convex backend or mocked responses

## Common Patterns

**Async Testing:**
```typescript
it('should handle async operation', async () => {
  const result = await asyncFunction();
  expect(result).toBe('expected');
});
```

**Error Testing:**
```typescript
it('should throw on invalid input', () => {
  expect(() => parse(null)).toThrow('Cannot parse null');
});

// Async error
it('should reject on failure', async () => {
  await expect(readConfig('invalid')).rejects.toThrow('ENOENT');
});
```

**Mock Convex Operations:**
```typescript
it('mocks Convex queries', async () => {
  vi.mocked(convexClient.query).mockResolvedValue(mockData);
  // test code
  expect(convexClient.query).toHaveBeenCalledWith(expectedArgs);
});
```

---

*Testing analysis: 2026-01-16*
*Update when test patterns change*
