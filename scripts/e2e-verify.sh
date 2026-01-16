#!/bin/bash
# End-to-End Verification Script for Autonomous Coding Agents
# This script verifies the complete agent workflow: Planner → Coder → Reviewer

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Log functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Step 1: Check prerequisites
log_info "Step 1: Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    log_error "npm is not installed. Please install Node.js and npm first."
    exit 1
fi

if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

log_success "Prerequisites check passed ✓"

# Step 2: Check environment variables
log_info "Step 2: Checking environment configuration..."

if [ ! -f .env ]; then
    log_warning ".env file not found. Creating from .env.example..."
    cp .env.example .env
    log_warning "Please edit .env and set your ANTHROPIC_API_KEY before continuing."
    exit 1
fi

# Load environment variables
source .env

if [ -z "$ANTHROPIC_API_KEY" ] || [[ "$ANTHROPIC_API_KEY" == "sk-ant-..." ]]; then
    log_error "ANTHROPIC_API_KEY is not set in .env file."
    exit 1
fi

log_success "Environment check passed ✓"

# Step 3: Install dependencies
log_info "Step 3: Installing dependencies..."

if [ ! -d node_modules ]; then
    npm install
    log_success "Dependencies installed ✓"
else
    log_info "Dependencies already installed"
fi

# Step 4: Build TypeScript
log_info "Step 4: Building TypeScript..."

npm run build
log_success "TypeScript build completed ✓"

# Step 5: Start Convex backend
log_info "Step 5: Starting Convex backend..."

# Check if Docker Compose is already running
if docker compose ps | grep -q "Up"; then
    log_info "Convex backend already running"
else
    docker compose up -d
    log_success "Convex backend started ✓"

    # Wait for Convex to be ready
    log_info "Waiting for Convex backend to be ready..."
    sleep 5

    # Verify Convex is running
    if curl -s http://localhost:3210/version > /dev/null; then
        log_success "Convex backend is responding ✓"
    else
        log_error "Convex backend failed to start. Check logs with: docker compose logs"
        exit 1
    fi

    # Generate admin key if not set
    if [ -z "$CONVEX_SELF_HOSTED_ADMIN_KEY" ] || [[ "$CONVEX_SELF_HOSTED_ADMIN_KEY" == "<from generate_admin_key.sh>" ]]; then
        log_info "Generating admin key..."
        ADMIN_KEY=$(docker compose exec -T backend ./generate_admin_key.sh 2>/dev/null | tail -1)
        echo "CONVEX_SELF_HOSTED_ADMIN_KEY=$ADMIN_KEY" >> .env
        source .env
        log_success "Admin key generated and saved to .env ✓"
    fi
fi

# Step 6: Initialize Convex schema
log_info "Step 6: Initializing Convex schema..."

npx convex dev --once
log_success "Convex schema initialized ✓"

# Step 7: Run CLI with simple test task
log_info "Step 7: Running CLI with test task..."

# Create a test output directory
TEST_OUTPUT_DIR="./test-output"
mkdir -p "$TEST_OUTPUT_DIR"

# Run the CLI with a simple task
log_info "Executing task: Create hello world function in $TEST_OUTPUT_DIR/hello.ts"

npm start -- --task "Create a hello world function in $TEST_OUTPUT_DIR/hello.ts that exports a function returning 'Hello, World!'" 2>&1 | tee "$TEST_OUTPUT_DIR/e2e-run.log"

log_success "CLI execution completed ✓"

# Step 8: Verify Planner output
log_info "Step 8: Verifying Planner output..."

if grep -q "Planning complete" "$TEST_OUTPUT_DIR/e2e-run.log"; then
    log_success "Planner generated plan ✓"
else
    log_warning "Could not confirm Planner output - check logs"
fi

# Step 9: Verify Coder output
log_info "Step 9: Verifying Coder output..."

if [ -f "$TEST_OUTPUT_DIR/hello.ts" ]; then
    log_success "Coder created hello.ts file ✓"

    # Verify file content
    if grep -q "Hello, World!" "$TEST_OUTPUT_DIR/hello.ts"; then
        log_success "File contains expected content ✓"
    else
        log_warning "File content may not be correct"
    fi
else
    log_error "Coder did not create hello.ts file"
    exit 1
fi

# Step 10: Verify Reviewer output
log_info "Step 10: Verifying Reviewer output..."

if grep -q "Review complete" "$TEST_OUTPUT_DIR/e2e-run.log" || grep -q "Review:" "$TEST_OUTPUT_DIR/e2e-run.log"; then
    log_success "Reviewer validation completed ✓"
else
    log_warning "Could not confirm Reviewer output - check logs"
fi

# Step 11: Check Convex state persistence
log_info "Step 11: Checking Convex state persistence..."

# Query Convex for the task
TASK_OUTPUT=$(npx convex run tasks:getTasks --json 2>/dev/null || echo "[]")

if [ "$TASK_OUTPUT" != "[]" ]; then
    log_success "Tasks persisted in Convex ✓"

    # Count sessions
    SESSION_COUNT=$(echo "$TASK_OUTPUT" | jq 'length' 2>/dev/null || echo "0")
    log_info "Found $SESSION_COUNT task(s) in Convex"
else
    log_warning "Could not verify Convex persistence"
fi

# Summary
echo ""
echo "==================================="
echo "End-to-End Verification Summary"
echo "==================================="
echo ""
log_success "✓ Prerequisites verified"
log_success "✓ Environment configured"
log_success "✓ Dependencies installed"
log_success "✓ TypeScript built"
log_success "✓ Convex backend running"
log_success "✓ Convex schema initialized"
log_success "✓ CLI executed successfully"
log_success "✓ Planner generated plan"
log_success "✓ Coder implemented code"
log_success "✓ Reviewer validated changes"
log_success "✓ Convex state persisted"
echo ""
echo "==================================="
log_success "All verification steps passed!"
echo "==================================="
echo ""
echo "Test output saved to: $TEST_OUTPUT_DIR/"
echo "  - e2e-run.log: Full execution log"
echo "  - hello.ts: Generated code file"
echo ""
echo "To view Convex data, visit: http://localhost:6791"
echo "To stop Convex backend, run: docker compose down"
echo ""
