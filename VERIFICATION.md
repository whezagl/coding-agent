# End-to-End Verification Guide

This document provides detailed steps for verifying the autonomous coding agent workflow.

## Prerequisites

Before running verification, ensure you have:

1. **Docker and Docker Compose** installed and running
   ```bash
   docker --version
   docker compose version
   ```

2. **Node.js 18+ and npm 10+** installed
   ```bash
   node --version
   npm --version
   ```

3. **Anthropic API Key** from https://console.anthropic.com/

4. **Git** for version control
   ```bash
   git --version
   ```

## Quick Verification

Run the automated verification script:

```bash
chmod +x scripts/e2e-verify.sh
./scripts/e2e-verify.sh
```

## Manual Verification Steps

### Step 1: Environment Setup

1. **Create .env file** from the example:
   ```bash
   cp .env.example .env
   ```

2. **Edit .env** and set your API key:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
   CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
   CONVEX_CLOUD_ORIGIN=http://127.0.0.1:3210
   CONVEX_SITE_ORIGIN=http://127.0.0.1:3211
   ```

### Step 2: Install Dependencies

```bash
npm install
```

Expected output: All packages installed successfully without errors.

### Step 3: Build TypeScript

```bash
npm run build
```

Expected output: Compiled JavaScript files in `dist/` directory.

### Step 4: Start Convex Backend

```bash
docker compose up -d
```

Verify Convex is running:
```bash
curl http://localhost:3210/version
```

Expected output: Convex version information.

### Step 5: Generate Admin Key

```bash
docker compose exec backend ./generate_admin_key.sh
```

Add the generated key to your `.env` file:
```
CONVEX_SELF_HOSTED_ADMIN_KEY=<generated-key>
```

### Step 6: Initialize Convex Schema

```bash
npx convex dev --once
```

Expected output: Schema deployed successfully to Convex.

### Step 7: Run CLI Test

Test the full workflow with a simple task:

```bash
npm start -- --task "Create a hello world function in test/hello.ts that exports a function returning 'Hello, World!'"
```

Expected output:
- CLI header with task description
- Progress updates for each agent
- Final result summary

### Step 8: Verify Planner Output

Check that the Planner agent:
- Analyzed the task
- Generated a plan with implementation steps
- Stored the plan in Convex

Verification:
```bash
npx convex run plans:getPlansForTask --string taskId=<task-id>
```

### Step 9: Verify Coder Output

Check that the Coder agent:
- Implemented the code
- Created the expected file: `test/hello.ts`
- Tracked changes in Convex

Verification:
```bash
cat test/hello.ts
```

Expected content:
```typescript
// Exported function returning "Hello, World!"
export function hello() {
  return "Hello, World!";
}
```

### Step 10: Verify Reviewer Output

Check that the Reviewer agent:
- Validated the implementation
- Checked acceptance criteria
- Stored review in Convex

Verification:
```bash
npx convex run reviews:getReviewsForTask --string taskId=<task-id>
```

### Step 11: Verify Convex State Persistence

Check that all agent sessions are persisted:

```bash
# View all tasks
npx convex run tasks:getTasks

# View agent sessions for a task
npx convex run agentSessions:getAgentSessionsByTask --string taskId=<task-id>
```

Expected:
- Task with status "completed"
- 3 agent sessions (Planner, Coder, Reviewer)
- Each session has status "completed"

### Step 12: Test Error Recovery

Test the resume capability:

1. **Create a task that will fail** (use an invalid task):
   ```bash
   npm start -- --task "Create a file in /root/protected.txt"
   ```

2. **Verify error is stored** in Convex

3. **Fix and resume**:
   ```bash
   npm start -- --task "Create a file in test/allowed.txt" --continue
   ```

Expected: System resumes from the last incomplete state.

## Verification Checklist

- [ ] Environment variables configured in `.env`
- [ ] Dependencies installed (`npm install`)
- [ ] TypeScript builds without errors (`npm run build`)
- [ ] Convex backend running (`docker compose up -d`)
- [ ] Convex schema deployed (`npx convex dev --once`)
- [ ] CLI executes without errors
- [ ] Planner generates and stores plan
- [ ] Coder implements code changes
- [ ] Reviewer validates implementation
- [ ] All agent sessions persisted in Convex
- [ ] Error recovery works with `--continue` flag

## Troubleshooting

### Convex Backend Won't Start

Check Docker logs:
```bash
docker compose logs
```

Common issues:
- Port 3210 or 3211 already in use
- Insufficient Docker resources

### Convex Connection Failed

Verify backend is accessible:
```bash
curl http://localhost:3210/version
```

Check `.env` configuration matches running ports.

### Missing Dependencies

Remove `node_modules` and reinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```

### Agent Fails Mid-Execution

Check agent session logs in Convex:
```bash
npx convex run agentSessions:getAgentSessionsByTask --string taskId=<task-id>
```

Resume from failure:
```bash
npm start -- --continue
```

## Expected Test Results

### Successful Run Output

```
╔════════════════════════════════════════════════════════════════╗
║         Autonomous Coding Agent - Task Execution               ║
╚════════════════════════════════════════════════════════════════╝

Task: Create a hello world function...
Mode: Full execution (Plan → Code → Review)

[1/3] Planning...
  ✓ Plan created with 3 steps

[2/3] Coding...
  ✓ Created test/hello.ts
  ✓ Implemented hello() function

[3/3] Reviewing...
  ✓ Code validation passed
  ✓ All acceptance criteria met

╔════════════════════════════════════════════════════════════════╗
║                    Execution Complete                          ║
╠════════════════════════════════════════════════════════════════╣
║  Status: ✓ Success                                             ║
║  Duration: 45s                                                 ║
║  Files modified: 1                                             ║
║  Review: PASSED                                                ║
╚════════════════════════════════════════════════════════════════╝
```

## Additional Tests

### Test Plan-Only Mode

```bash
npm start -- --task "Add user authentication" --plan-only
```

Expected: Only Planner runs, no code changes made.

### Test Skip-Review Mode

```bash
npm start -- --task "Fix typo in README" --skip-review
```

Expected: Planner and Coder run, Reviewer is skipped.

### Test Resume Capability

1. Start a task
2. Interrupt it (Ctrl+C)
3. Resume with `--continue`

Expected: Workflow continues from interrupted point.

## Cleanup

Stop Convex backend after testing:
```bash
docker compose down
```

Remove test data:
```bash
rm -rf test/
```

## Next Steps

After successful verification:
1. Review the generated code and plans
2. Check Convex dashboard at http://localhost:6791
3. Run additional test tasks to validate edge cases
4. Deploy to production environment
