#!/bin/bash
# Lightweight verification script for agent workflow
# This script verifies the code structure without requiring Docker/Node execution

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
TOTAL=0
PASSED=0
FAILED=0

# Test function
test_check() {
    local name="$1"
    local command="$2"

    TOTAL=$((TOTAL + 1))
    echo -n "[$TOTAL] Testing: $name... "

    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PASSED${NC}"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

echo "========================================"
echo "Agent Workflow Verification"
echo "========================================"
echo ""

# File Structure Tests
echo "File Structure:"
echo "---------------"

test_check "Project root exists" "[ -f package.json ]"
test_check "TypeScript config exists" "[ -f tsconfig.json ]"
test_check "Docker Compose config exists" "[ -f docker-compose.yml ]"
test_check "Environment example exists" "[ -f .env.example ]"
test_check "README exists" "[ -f README.md ]"

echo ""
echo "Source Code Structure:"
echo "---------------------"

test_check "src/agents directory exists" "[ -d src/agents ]"
test_check "src/core directory exists" "[ -d src/core ]"
test_check "src/cli directory exists" "[ -d src/cli ]"
test_check "src/prompts directory exists" "[ -d src/prompts ]"
test_check "convex directory exists" "[ -d convex ]"

echo ""
echo "Agent Implementation Files:"
echo "--------------------------"

test_check "types.ts exists" "[ -f src/agents/types.ts ]"
test_check "base.ts exists" "[ -f src/agents/base.ts ]"
test_check "planner.ts exists" "[ -f src/agents/planner.ts ]"
test_check "coder.ts exists" "[ -f src/agents/coder.ts ]"
test_check "reviewer.ts exists" "[ -f src/agents/reviewer.ts ]"

echo ""
echo "Core Files:"
echo "----------"

test_check "client.ts exists" "[ -f src/core/client.ts ]"
test_check "coordination.ts exists" "[ -f src/core/coordination.ts ]"
test_check "convexClient.ts exists" "[ -f src/core/convexClient.ts ]"

echo ""
echo "CLI Files:"
echo "---------"

test_check "CLI index exists" "[ -f src/cli/index.ts ]"

echo ""
echo "Prompt Files:"
echo "------------"

test_check "Planner prompt exists" "[ -f src/prompts/planner.md ]"
test_check "Coder prompt exists" "[ -f src/prompts/coder.md ]"
test_check "Reviewer prompt exists" "[ -f src/prompts/reviewer.md ]"

echo ""
echo "Convex Schema Files:"
echo "-------------------"

test_check "Convex schema exists" "[ -f convex/schema.ts ]"
test_check "Convex tasks exists" "[ -f convex/tasks.ts ]"
test_check "Convex agentSessions exists" "[ -f convex/agentSessions.ts ]"
test_check "Convex plans exists" "[ -f convex/plans.ts ]"
test_check "Convex codeChanges exists" "[ -f convex/codeChanges.ts ]"
test_check "Convex reviews exists" "[ -f convex/reviews.ts ]"

echo ""
echo "Code Content Verification:"
echo "-------------------------"

# Check for key exports and patterns
test_check "types.ts exports AgentType" "grep -q 'export enum AgentType' src/agents/types.ts"
test_check "types.ts exports tool permissions" "grep -q 'AGENT_TOOL_PERMISSIONS' src/agents/types.ts"
test_check "base.ts exports BaseAgent" "grep -q 'export abstract class BaseAgent' src/agents/base.ts"
test_check "planner.ts exports PlannerAgent" "grep -q 'export class PlannerAgent' src/agents/planner.ts"
test_check "coder.ts exports CoderAgent" "grep -q 'export class CoderAgent' src/agents/coder.ts"
test_check "reviewer.ts exports ReviewerAgent" "grep -q 'export class ReviewerAgent' src/agents/reviewer.ts"

echo ""
echo "Coordination Logic:"
echo "------------------"

test_check "orchestrateAgents function exists" "grep -q 'export.*orchestrateAgents' src/core/coordination.ts"
test_check "resumeOrchestration function exists" "grep -q 'export.*resumeOrchestration' src/core/coordination.ts"
test_check "executeAgent function exists" "grep -q 'function executeAgent' src/core/coordination.ts"

echo ""
echo "Convex Functions:"
echo "----------------"

# Task management
test_check "createTask mutation exists" "grep -q 'export.*createTask' convex/tasks.ts"
test_check "getTask query exists" "grep -q 'export.*getTask' convex/tasks.ts"

# Agent sessions
test_check "createAgentSession mutation exists" "grep -q 'export.*createAgentSession' convex/agentSessions.ts"
test_check "getAgentSessionsByTask query exists" "grep -q 'export.*getAgentSessionsByTask' convex/agentSessions.ts"

# Plans
test_check "store plan mutation exists" "grep -q 'export.*store' convex/plans.ts"
test_check "getPlan query exists" "grep -q 'export.*getPlan' convex/plans.ts"

# Code changes
test_check "record change mutation exists" "grep -q 'export.*record' convex/codeChanges.ts"

# Reviews
test_check "store review mutation exists" "grep -q 'export.*store' convex/reviews.ts"

echo ""
echo "CLI Configuration:"
echo "-----------------"

test_check "CLI has --task option" "grep -q \"'--task'\" src/cli/index.ts"
test_check "CLI has --plan-only option" "grep -q \"'--plan-only'\" src/cli/index.ts"
test_check "CLI has --skip-review option" "grep -q \"'--skip-review'\" src/cli/index.ts"
test_check "CLI has --continue option" "grep -q \"'--continue'\\|resume\" src/cli/index.ts"

echo ""
echo "Package Configuration:"
echo "---------------------"

test_check "Package has @anthropic-ai/claude-agent-sdk" "grep -q '@anthropic-ai/claude-agent-sdk' package.json"
test_check "Package has convex dependency" "grep -q '\"convex\"' package.json"
test_check "Package has build script" "grep -q '\"build\"' package.json"
test_check "Package has start script" "grep -q '\"start\"' package.json"

echo ""
echo "Workflow Pattern Verification:"
echo "------------------------------"

# Check that coordination follows the pattern: Planner → Coder → Reviewer
test_check "Coordination mentions Planner agent" "grep -q 'AgentType.Planner' src/core/coordination.ts"
test_check "Coordination mentions Coder agent" "grep -q 'AgentType.Coder' src/core/coordination.ts"
test_check "Coordination mentions Reviewer agent" "grep -q 'AgentType.Reviewer' src/core/coordination.ts"
test_check "Coordination passes plan to Coder" "grep -q 'plan:' src/core/coordination.ts"
test_check "Coordination passes codeChanges to Reviewer" "grep -q 'codeChanges:' src/core/coordination.ts"

echo ""
echo "Documentation:"
echo "-------------"

test_check "README contains project overview" "grep -qi 'autonomous coding' README.md"
test_check "README contains installation instructions" "grep -q 'Installation' README.md"
test_check "README contains usage examples" "grep -q 'Usage' README.md"
test_check "VERIFICATION.md exists" "[ -f VERIFICATION.md ]"

echo ""
echo "========================================"
echo "Verification Summary"
echo "========================================"
echo ""
echo -e "Total Tests: $TOTAL"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All structural checks passed!${NC}"
    echo ""
    echo "Next Steps:"
    echo "1. Run: chmod +x scripts/e2e-verify.sh"
    echo "2. Run: ./scripts/e2e-verify.sh"
    echo "   (Requires Docker, Node.js, and API key)"
    exit 0
else
    echo -e "${RED}✗ Some checks failed. Review the output above.${NC}"
    exit 1
fi
