#!/usr/bin/env node
/**
 * CLI Entry Point for Coding Agent
 *
 * This is the main entry point for the coding agent CLI. It parses command-line
 * arguments, initializes agents, and orchestrates the three-agent workflow
 * (Planner → Coder → Reviewer) with Convex state management.
 *
 * Usage:
 *   npm start -- --task "Implement user authentication"
 *   npm start -- --task "Fix bug" --plan-only
 *   npm start -- --continue
 *   npm start -- --help
 *
 * @module cli/index
 */

import { orchestrateAgents, resumeOrchestration } from '../core/coordination';
import { PlannerAgent } from '../agents/planner';
import { CoderAgent } from '../agents/coder';
import { ReviewerAgent } from '../agents/reviewer';
import { AgentType } from '../agents/types';
import { getConvexClient, closeConvexClient } from '../core/convexClient';
import { config } from 'dotenv';
import { join } from 'path';

/**
 * Load environment variables from .env file.
 */
function loadEnv(): void {
  // Try to load .env from current directory and parent directories
  const envPaths = [
    join(process.cwd(), '.env'),
    join(process.cwd(), '../../.env'),
  ];

  for (const envPath of envPaths) {
    try {
      config({ path: envPath });
      break;
    } catch {
      // Continue to next path
    }
  }
}

/**
 * CLI command-line options.
 */
interface CliOptions {
  /** Task description to process */
  task?: string;
  /** Only run planner, don't execute */
  planOnly: boolean;
  /** Skip review step */
  skipReview: boolean;
  /** Resume from last incomplete task */
  resume: boolean;
  /** Show help message */
  help: boolean;
}

/**
 * Parse command-line arguments into CLI options.
 *
 * @param args - Command-line arguments (excluding node and script path)
 * @returns Parsed CLI options
 */
function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    planOnly: false,
    skipReview: false,
    resume: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;

      case '--task':
      case '-t':
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          options.task = args[++i];
        } else {
          console.error('Error: --task requires a value');
          process.exit(1);
        }
        break;

      case '--plan-only':
        options.planOnly = true;
        break;

      case '--skip-review':
        options.skipReview = true;
        break;

      case '--continue':
        options.resume = true;
        break;

      default:
        // If we encounter a non-flag argument without --task, treat it as the task
        if (!arg.startsWith('-') && !options.task) {
          options.task = arg;
        } else {
          console.error(`Error: Unknown argument: ${arg}`);
          process.exit(1);
        }
    }
  }

  return options;
}

/**
 * Display help message with usage information.
 */
function showHelp(): void {
  const help = `
Coding Agent - Autonomous coding agents using Claude SDK

USAGE:
  npm start -- [OPTIONS]
  npm start -- --task "<description>"
  npm start -- --continue

OPTIONS:
  -t, --task <text>       Task description to process (required unless --continue)
  --plan-only             Only run planner, don't execute implementation
  --skip-review           Skip review step
  --continue              Resume from last incomplete task
  -h, --help              Show this help message

EXAMPLES:
  # Run full workflow with a task
  npm start -- --task "Implement user authentication"

  # Only create a plan without executing
  npm start -- --task "Add logging" --plan-only

  # Run task without review step
  npm start -- --task "Fix typo" --skip-review

  # Resume from last incomplete task
  npm start -- --continue

ENVIRONMENT VARIABLES:
  ANTHROPIC_API_KEY          Claude API key (required)
  CONVEX_SELF_HOSTED_URL     Convex backend URL (required)
  CONVEX_SELF_HOSTED_ADMIN_KEY  Convex admin key (required)

For more information, see README.md
`;

  console.log(help);
}

/**
 * Validate required environment variables.
 *
 * @throws Error if required environment variables are missing
 */
function validateEnvironment(): void {
  const required = ['ANTHROPIC_API_KEY', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('Error: Missing required environment variables:');
    missing.forEach(key => console.error(`  - ${key}`));
    console.error('\nSet these in your .env file or environment.');
    process.exit(1);
  }
}

/**
 * Validate CLI options.
 *
 * @param options - Parsed CLI options
 * @throws Error if options are invalid
 */
function validateOptions(options: CliOptions): void {
  if (options.help) {
    return;
  }

  if (!options.resume && !options.task) {
    console.error('Error: --task is required (or use --continue to resume)');
    console.error('Run --help for usage information');
    process.exit(1);
  }

  if (options.resume && options.task) {
    console.error('Error: Cannot use both --task and --continue');
    process.exit(1);
  }
}

/**
 * Display a formatted header for the CLI.
 */
function displayHeader(): void {
  console.log('\n' + '='.repeat(60));
  console.log('  Coding Agent - Autonomous Coding with Claude SDK');
  console.log('='.repeat(60) + '\n');
}

/**
 * Display agent execution progress.
 *
 * @param agentType - Type of agent executing
 * @param activity - Activity description
 */
function displayProgress(agentType: AgentType, activity: string): void {
  const timestamp = new Date().toLocaleTimeString();
  const agentName = agentType.charAt(0).toUpperCase() + agentType.slice(1);
  console.log(`[${timestamp}] ${agentName}: ${activity}`);
}

/**
 * Display the final result of orchestration.
 *
 * @param result - Orchestration result
 */
function displayResult(result: { taskId: string; status: string; agentResults: Array<{ agentType: string; success: boolean; content: string }>; error?: string }): void {
  console.log('\n' + '='.repeat(60));
  console.log('  Execution Complete');
  console.log('='.repeat(60));
  console.log(`\nTask ID: ${result.taskId}`);
  console.log(`Status: ${result.status}\n`);

  console.log('Agent Results:');
  for (const agentResult of result.agentResults) {
    const status = agentResult.success ? '✓' : '✗';
    const agentName = agentResult.agentType.charAt(0).toUpperCase() + agentResult.agentType.slice(1);
    console.log(`  ${status} ${agentName}: ${agentResult.success ? 'Success' : 'Failed'}`);

    if (!agentResult.success && agentResult.content) {
      console.log(`    Error: ${agentResult.content}`);
    }
  }

  // Display overall error if present
  if (result.error) {
    console.log('\n' + '-'.repeat(60));
    console.log(`Error: ${result.error}`);
    console.log('You can resume from this state using: npm start -- --continue');
    console.log('-'.repeat(60));
  }

  console.log('');
}

/**
 * Display task information when resuming.
 *
 * @param task - Task information from Convex
 */
function displayResumeInfo(task: { description: string; status: string; error?: string } | null): void {
  if (!task) {
    console.log('No incomplete task found to resume.');
    return;
  }

  console.log(`Resuming task: ${task.description}`);
  console.log(`Current status: ${task.status}`);

  if (task.error) {
    console.log(`Previous error: ${task.error}`);
    console.log('Clearing error and retrying...\n');
  } else {
    console.log('Continuing from where we left off...\n');
  }
}

/**
 * Main CLI execution function.
 */
async function main(): Promise<void> {
  // Load environment variables
  loadEnv();

  // Parse command-line arguments
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Show help if requested
  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Validate options
  validateOptions(options);

  // Validate environment
  validateEnvironment();

  // Display header
  displayHeader();

  try {
    // Initialize Convex client
    const convex = getConvexClient();

    // Get working directory
    const workingDirectory = process.cwd();

    // Create agent instances
    const agents = {
      planner: new PlannerAgent({
        agentType: AgentType.Planner,
        taskDescription: options.task ?? '',
        workingDirectory,
      }),
      coder: new CoderAgent({
        agentType: AgentType.Coder,
        taskDescription: options.task ?? '',
        workingDirectory,
      }),
      reviewer: new ReviewerAgent({
        agentType: AgentType.Reviewer,
        taskDescription: options.task ?? '',
        workingDirectory,
      }),
    };

    // Execution options with progress callback
    const executionOptions = {
      onProgress: (update: { agentType: AgentType; activity: string }) => {
        displayProgress(update.agentType, update.activity);
      },
    };

    let result;

    if (options.resume) {
      // Get task info before resuming
      const task = await convex.query<{
        _id: string;
        description: string;
        status: string;
        error?: string;
      } | null>('tasks/getLatestIncompleteTask');

      // Display resume information
      displayResumeInfo(task);

      if (!task) {
        console.error('No incomplete task found to resume.');
        console.error('All tasks are completed or no tasks exist yet.');
        console.error('To start a new task, use: npm start -- --task "<description>"');
        process.exit(1);
      }

      // Resume from last incomplete task
      result = await resumeOrchestration({
        convex,
        workingDirectory,
        agents,
        executionOptions,
        skipReview: options.skipReview,
      });
    } else {
      // Start new task
      console.log(`Starting task: ${options.task}\n`);
      result = await orchestrateAgents(options.task!, {
        convex,
        workingDirectory,
        agents,
        executionOptions,
        planOnly: options.planOnly,
        skipReview: options.skipReview,
      });
    }

    // Display result
    displayResult(result);

    // Exit with appropriate code
    process.exit(result.status === 'failed' ? 1 : 0);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('\n' + '='.repeat(60));
    console.error('  ERROR');
    console.error('='.repeat(60));
    console.error(`\n${errorMessage}\n`);

    if (error instanceof Error && error.stack) {
      console.error('Stack trace:');
      console.error(error.stack);
    }

    console.error('\nTip: You can resume from this state using: npm start -- --continue\n');

    process.exit(1);
  } finally {
    // Close Convex client
    closeConvexClient();
  }
}

// Execute main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
