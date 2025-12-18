#!/usr/bin/env node

/**
 * CLI entry point for Claude Autonomous Runner (Max Subscription Version)
 * Uses Claude Code CLI - no API key required, uses your Max subscription
 *
 * Usage: claude-auto [options] "Your goal here"
 */

import { AutonomousRunnerCLI } from './autonomous-runner-cli.js';
import { RetryableAutonomousRunner } from './retryable-runner.js';
import { parseArgs } from 'util';
import { InkDashboard } from './ui/ink-dashboard.js';
import { colors, style, icons } from './ui/terminal.js';

const VERSION = '1.0.0';

const HELP_TEXT = `
${colors.cyan}${style.bold}◆ CLAUDE AUTONOMOUS RUNNER${style.reset} v${VERSION}
${colors.gray}Run Claude in continuous autonomous mode using your Claude Max subscription.${style.reset}

${colors.white}${style.bold}USAGE:${style.reset}
  ${colors.cyan}claude-auto${style.reset} [options] "Your primary goal"
  ${colors.cyan}claude-auto${style.reset} --goal "Primary goal" --sub-goal "Sub goal 1" --sub-goal "Sub goal 2"

${colors.white}${style.bold}OPTIONS:${style.reset}
  ${colors.green}-g, --goal${style.reset} <text>        Primary goal (can also be passed as positional argument)
  ${colors.green}-s, --sub-goal${style.reset} <text>    Sub-goal (can be specified multiple times)
  ${colors.green}-t, --time-limit${style.reset} <time>  Time limit (e.g., "30m", "2h", "24h") [default: 2h]
  ${colors.green}-d, --directory${style.reset} <path>   Working directory [default: current directory]
  ${colors.green}-c, --context${style.reset} <text>     Additional context for the task
  ${colors.green}-v, --verbose${style.reset}            Enable verbose logging (shows Claude's full output)
  ${colors.green}-q, --quiet${style.reset}              Minimal output (only errors and final report)
  ${colors.green}-j, --json${style.reset}               Output progress as JSON
  ${colors.green}-r, --retry${style.reset}              Enable retry loop (continues until HIGH confidence)
  ${colors.green}--max-retries${style.reset} <n>        Maximum retry attempts [default: 100]
  ${colors.green}-h, --help${style.reset}               Show this help message
  ${colors.green}--version${style.reset}                Show version number
  ${colors.green}--docker${style.reset}                 Run inside the claude docker container

${colors.white}${style.bold}EXAMPLES:${style.reset}
  ${colors.gray}# Simple single goal${style.reset}
  ${colors.cyan}claude-auto${style.reset} "Implement a REST API for user management"

  ${colors.gray}# Multiple sub-goals with time limit${style.reset}
  ${colors.cyan}claude-auto${style.reset} -g "Build a todo app" \\
    -s "Create the data model" \\
    -s "Implement CRUD endpoints" \\
    -s "Add authentication" \\
    -t 4h

  ${colors.gray}# With additional context${style.reset}
  ${colors.cyan}claude-auto${style.reset} "Fix the failing tests" -c "Focus on the auth module tests" -t 1h

  ${colors.gray}# Run in docker container (mounts current dir and ~/.claude for auth)${style.reset}
  ${colors.cyan}claude-auto${style.reset} --docker "Build a REST API"

  ${colors.gray}# Retry until HIGH confidence achieved (up to 5 attempts)${style.reset}
  ${colors.cyan}claude-auto${style.reset} -r --max-retries 5 -t 4h "Build and test a REST API"

${colors.white}${style.bold}REQUIREMENTS:${style.reset}
  ${icons.arrow} Claude Code CLI must be installed and authenticated
  ${icons.arrow} Run 'claude' once to authenticate if needed
  ${icons.arrow} Your Max subscription will be used for API calls

${colors.white}${style.bold}BEHAVIOR:${style.reset}
  ${icons.brain} Claude works autonomously toward the goal
  ${icons.chart} Progress is tracked and reported periodically
  ${icons.target} Auto-correction activates if Claude drifts off-topic
  ${icons.clock} Execution stops when goal achieved or time expires
`;

// Simple log for non-dashboard modes
function log(message, type = 'reset') {
  const typeColors = {
    reset: style.reset,
    red: colors.red,
    green: colors.green,
    yellow: colors.yellow,
    cyan: colors.cyan,
    dim: colors.gray,
  };
  console.log(`${typeColors[type] || style.reset}${message}${style.reset}`);
}

// JSON output handlers
function jsonProgress(data) {
  console.log(JSON.stringify({ type: 'progress', ...data }));
}

function jsonMessage(data) {
  console.log(JSON.stringify({ type: 'message', iteration: data.iteration }));
}

function jsonError(data) {
  console.log(JSON.stringify({ type: 'error', ...data }));
}

function jsonSupervision(data) {
  console.log(JSON.stringify({ type: 'supervision', ...data }));
}

function jsonEscalation(data) {
  console.log(JSON.stringify({ type: 'escalation', ...data }));
}

function jsonVerification(data) {
  console.log(JSON.stringify({ type: 'verification', ...data }));
}

function jsonComplete(report) {
  console.log(JSON.stringify({ type: 'complete', ...report }));
}

// Quiet mode handlers
function quietError(data) {
  console.error(`Error: ${data.error}`);
}

function quietComplete(report) {
  console.log(`Status: ${report.status}`);
  console.log(`Progress: ${report.goal?.progress || 0}%`);
  console.log(`Iterations: ${report.session?.iterations || 0}`);
  if (report.abortReason) {
    console.log(`Abort Reason: ${report.abortReason}`);
  }
}

// Verbose/debug mode handlers (no dashboard, plain text logs)
function verboseProgress(data) {
  console.log(`\n[PROGRESS] ${data.type || 'update'}`);
  if (data.type === 'planning') {
    console.log(`  ${data.message || 'Creating execution plan...'}`);
  } else if (data.type === 'plan_created') {
    console.log(`  Plan created with ${data.plan?.steps?.length || 0} steps`);
    if (data.plan?.steps) {
      data.plan.steps.forEach(s => console.log(`    ${s.number}. ${s.description} [${s.complexity}]`));
    }
  } else if (data.type === 'step_verification_pending') {
    console.log(`  ⋯ Verifying step ${data.step?.number}...`);
  } else if (data.type === 'step_verification_started') {
    console.log(`  ⋯ Step verification in progress...`);
  } else if (data.type === 'step_complete') {
    const verified = data.verification ? ' (verified)' : '';
    console.log(`  ✓ Step ${data.step?.number} complete${verified}: ${data.step?.description}`);
  } else if (data.type === 'step_rejected') {
    console.log(`  ✗ Step ${data.step?.number} rejected: ${data.reason}`);
  } else if (data.type === 'step_blocked_replanning') {
    console.log(`  ⚠ Step ${data.step?.number} blocked, creating sub-plan...`);
  } else if (data.type === 'subplan_creating') {
    console.log(`  ⋯ Creating alternative approach...`);
  } else if (data.type === 'subplan_created') {
    console.log(`  ✓ Sub-plan created with ${data.subPlan?.steps?.length || 0} sub-steps`);
    if (data.subPlan?.steps) {
      data.subPlan.steps.forEach(s => console.log(`      ${s.number}. ${s.description}`));
    }
  } else if (data.type === 'subplan_failed') {
    console.log(`  ✗ Sub-plan failed: ${data.reason}`);
  } else if (data.type === 'step_failed') {
    console.log(`  ✗ Step ${data.step?.number} failed: ${data.reason}`);
  } else if (data.type === 'step_blocked') {
    console.log(`  ✗ Step ${data.step?.number} blocked: ${data.reason}`);
  } else if (data.type === 'plan_review_started') {
    console.log(`  ⋯ Reviewing execution plan...`);
  } else if (data.type === 'plan_review_complete') {
    const status = data.review?.approved ? '✓ approved' : '⚠ flagged';
    console.log(`  ${status}`);
  } else if (data.type === 'plan_review_warning') {
    if (data.issues?.length > 0) {
      console.log(`  ⚠ Plan issues: ${data.issues.join(', ')}`);
    }
    if (data.missingSteps?.length > 0) {
      console.log(`  ⚠ Missing steps: ${data.missingSteps.join(', ')}`);
    }
    if (data.suggestions?.length > 0) {
      console.log(`  💡 Suggestions: ${data.suggestions.join(', ')}`);
    }
  } else if (data.type === 'final_verification_started') {
    console.log(`  ⋯ Running final verification...`);
  } else if (data.type === 'goal_verification_complete') {
    const r = data.result;
    const icon = r?.achieved ? '✓' : '✗';
    console.log(`  ${icon} Goal verified: ${r?.achieved ? 'Yes' : 'No'} (${r?.confidence || 'unknown'} confidence)`);
    if (r?.gaps) console.log(`    Gaps: ${r.gaps}`);
    console.log(`    Recommendation: ${r?.recommendation || 'unknown'}`);
  } else if (data.type === 'smoke_tests_complete') {
    const r = data.result;
    const icon = r?.passed ? '✓' : '✗';
    console.log(`  ${icon} Smoke tests: ${r?.summary || (r?.passed ? 'Passed' : 'Failed')}`);
    if (r?.tests?.length > 0) {
      r.tests.forEach(t => {
        const tIcon = t.passed ? '✓' : '✗';
        console.log(`      ${tIcon} ${t.name}`);
      });
    }
  } else if (data.type === 'final_verification_passed') {
    console.log(`  ✓ FINAL VERIFICATION PASSED`);
  } else if (data.type === 'final_verification_failed') {
    console.log(`  ✗ FINAL VERIFICATION FAILED: ${data.reason || 'see report'}`);
  } else if (data.type === 'retry_loop_started') {
    console.log(`\n[RETRY MODE] Max attempts: ${data.maxAttempts}, Time limit: ${Math.round(data.overallTimeLimit / 60000)}m`);
  } else if (data.type === 'attempt_starting') {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[ATTEMPT ${data.attemptNumber}/${data.maxAttempts}] Starting...`);
    console.log(`  Time remaining: ${Math.round(data.timeRemaining / 60000)}m`);
    console.log(`  Time budget for attempt: ${Math.round(data.timeLimitForAttempt / 60000)}m`);
    if (data.hasFailureContext) {
      console.log(`  Building on previous attempt(s)`);
    }
  } else if (data.type === 'attempt_completed') {
    const icon = data.confidence === 'HIGH' ? '✓' : data.passed ? '◐' : '✗';
    console.log(`\n[ATTEMPT ${data.attemptNumber}] ${icon} Completed`);
    console.log(`  Status: ${data.status}, Confidence: ${data.confidence}`);
    console.log(`  Steps: ${data.completedSteps} completed, ${data.failedSteps} failed`);
    console.log(`  Duration: ${Math.round(data.duration / 1000)}s`);
    if (data.willRetry) {
      console.log(`  → Will retry (confidence not HIGH)`);
    }
  } else if (data.type === 'retry_loop_completed') {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[RETRY LOOP COMPLETE]`);
    console.log(`  Total attempts: ${data.totalAttempts}`);
    console.log(`  Final confidence: ${data.finalConfidence}`);
    console.log(`  Success: ${data.overallSuccess ? 'Yes' : 'No'}`);
    console.log(`  Total duration: ${Math.round(data.totalDuration / 1000)}s`);
  } else if (data.type === 'time_exhausted') {
    console.log(`\n[TIME EXHAUSTED] No time for more attempts`);
    console.log(`  Completed ${data.totalAttempts} attempt(s)`);
  } else {
    if (data.iteration) console.log(`  Iteration: ${data.iteration}`);
    if (data.planProgress) console.log(`  Plan: ${data.planProgress.current}/${data.planProgress.total} steps`);
    if (data.progress) console.log(`  Progress: ${JSON.stringify(data.progress)}`);
    if (data.sessionId) console.log(`  Session: ${data.sessionId}`);
  }
}

function verboseMessage(data) {
  console.log(`\n[CLAUDE OUTPUT - Iteration ${data.iteration}]`);
  console.log('─'.repeat(60));
  console.log(data.content || '(no content)');
  console.log('─'.repeat(60));
}

function verboseError(data) {
  console.error(`\n[ERROR] ${data.error}`);
  if (data.retry) console.error(`  Retry attempt: ${data.retry}`);
}

function verboseSupervision(data) {
  const a = data.assessment || {};
  console.log(`\n[SUPERVISION] Action: ${a.action || 'unknown'}, Score: ${a.score || 'N/A'}`);
  if (a.reason) console.log(`  Reason: ${a.reason}`);
  if (data.consecutiveIssues) console.log(`  Consecutive issues: ${data.consecutiveIssues}`);
}

function verboseEscalation(data) {
  console.log(`\n[ESCALATION] Type: ${data.type}`);
  if (data.message) console.log(`  Message: ${data.message}`);
}

function verboseVerification(data) {
  console.log(`\n[VERIFICATION] Passed: ${data.passed}`);
  if (data.layers) console.log(`  Layers: ${JSON.stringify(data.layers, null, 2)}`);
}

function verboseComplete(report) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[COMPLETE] Status: ${report.status}`);
  console.log(`  Progress: ${report.goal?.progress || 0}%`);
  console.log(`  Iterations: ${report.session?.iterations || 0}`);
  console.log(`  Time: ${report.time?.elapsed || 'N/A'}`);

  if (report.plan) {
    console.log(`  Plan: ${report.plan.completed}/${report.plan.totalSteps} steps completed`);
    if (report.plan.failed > 0) {
      console.log(`  Failed Steps: ${report.plan.failed}`);
      // Show failed step details
      for (const step of report.plan.steps || []) {
        if (step.status === 'failed' && step.failReason) {
          console.log(`    ✗ Step ${step.number}: ${step.failReason}`);
        }
      }
    }
  }

  // Show final verification results
  if (report.finalVerification) {
    const fv = report.finalVerification;
    console.log(`\n  Final Verification:`);
    const goalIcon = fv.goalAchieved ? '✓' : '✗';
    console.log(`    ${goalIcon} Goal Achieved: ${fv.goalAchieved ? 'Yes' : 'No'}`);
    console.log(`      Confidence: ${fv.confidence || 'Unknown'}`);
    console.log(`      Recommendation: ${fv.recommendation || 'Unknown'}`);
    if (fv.gaps) {
      console.log(`    ⚠ Gaps: ${fv.gaps}`);
    }
    const smokeIcon = fv.smokeTestsPassed ? '✓' : '✗';
    console.log(`    ${smokeIcon} Smoke Tests: ${fv.smokeTestsSummary || (fv.smokeTestsPassed ? 'Passed' : 'Failed')}`);
    const overallIcon = fv.overallPassed ? '✓' : '✗';
    console.log(`    ${overallIcon} Overall: ${fv.overallPassed ? 'PASSED' : 'FAILED'}`);
  }

  if (report.abortReason) console.log(`  Abort Reason: ${report.abortReason}`);
  console.log('═'.repeat(60));
}

async function checkClaudeCodeInstalled() {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    await execAsync('claude --version');
    return true;
  } catch (e) {
    return false;
  }
}

async function checkDockerImageExists() {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    await execAsync('docker image inspect claude');
    return true;
  } catch (e) {
    return false;
  }
}

async function runInDocker(args) {
  const { spawn } = await import('child_process');
  const { homedir } = await import('os');
  const path = await import('path');

  const cwd = process.cwd();
  const home = homedir();
  const claudeConfigDir = path.join(home, '.claude');

  // Build docker run command
  const sshDir = path.join(home, '.ssh');
  const dockerArgs = [
    'run',
    '--rm',
    '-it',
    // Mount current directory as workspace
    '-v', `${cwd}:/home/claude/workspace`,
    // Mount ~/.claude for credentials (read-write since Claude Code writes debug logs)
    '-v', `${claudeConfigDir}:/home/claude/.claude`,
    // Mount ~/.ssh for git SSH authentication (read-only)
    '-v', `${sshDir}:/home/claude/.ssh:ro`,
    // Set working directory
    '-w', '/home/claude/workspace',
    // Use the claude image
    'claude',
    // Run claude-auto with the passed arguments
    'claude-auto',
    ...args,
  ];

  log(`${icons.arrow} Running in docker container...`, 'cyan');
  log(`${colors.gray}  Mounting: ${cwd} -> /home/claude/workspace${style.reset}`);
  log(`${colors.gray}  Mounting: ${claudeConfigDir} -> /home/claude/.claude${style.reset}`);
  log(`${colors.gray}  Mounting: ${sshDir} -> /home/claude/.ssh (read-only)${style.reset}`);
  log('');

  const proc = spawn('docker', dockerArgs, {
    stdio: 'inherit',
  });

  return new Promise((resolve) => {
    proc.on('close', (code) => {
      resolve(code);
    });
  });
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      goal: { type: 'string', short: 'g' },
      'sub-goal': { type: 'string', short: 's', multiple: true },
      'time-limit': { type: 'string', short: 't', default: '2h' },
      directory: { type: 'string', short: 'd', default: process.cwd() },
      context: { type: 'string', short: 'c' },
      verbose: { type: 'boolean', short: 'v', default: false },
      quiet: { type: 'boolean', short: 'q', default: false },
      json: { type: 'boolean', short: 'j', default: false },
      retry: { type: 'boolean', short: 'r', default: false },
      'max-retries': { type: 'string', default: '100' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', default: false },
      docker: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (values.version) {
    console.log(VERSION);
    process.exit(0);
  }

  // Handle docker mode
  if (values.docker) {
    const hasDockerImage = await checkDockerImageExists();
    if (!hasDockerImage) {
      log(`${icons.error} Error: Docker image 'claude' not found.`, 'red');
      log('Build it first: npm run docker:build', 'dim');
      process.exit(1);
    }

    // Filter out --docker from args and pass the rest to docker
    const dockerArgs = process.argv.slice(2).filter(arg => arg !== '--docker');
    const exitCode = await runInDocker(dockerArgs);
    process.exit(exitCode);
  }

  // Check for Claude Code CLI
  const hasClaudeCode = await checkClaudeCodeInstalled();
  if (!hasClaudeCode) {
    log(`${icons.error} Error: Claude Code CLI not found.`, 'red');
    log('Please install it: npm install -g @anthropic-ai/claude-code', 'dim');
    log('Then authenticate: claude', 'dim');
    process.exit(1);
  }

  // Determine primary goal
  const primaryGoal = values.goal || positionals[0];
  if (!primaryGoal) {
    log(`${icons.error} Missing required argument: goal`, 'red');
    log('Usage: claude-auto "Your goal here"', 'dim');
    log('Run with --help for more options.', 'dim');
    process.exit(1);
  }

  // Create dashboard or use simple handlers based on mode
  let dashboard = null;
  let handlers = {};

  if (values.json) {
    // JSON mode - structured output
    handlers = {
      onProgress: jsonProgress,
      onMessage: jsonMessage,
      onError: jsonError,
      onSupervision: jsonSupervision,
      onEscalation: jsonEscalation,
      onVerification: jsonVerification,
      onComplete: jsonComplete,
    };
  } else if (values.quiet && values.verbose) {
    // Verbose debug mode - plain text logs, no dashboard
    console.log('[DEBUG MODE] Verbose logging enabled without dashboard\n');
    handlers = {
      onProgress: verboseProgress,
      onMessage: verboseMessage,
      onError: verboseError,
      onSupervision: verboseSupervision,
      onEscalation: verboseEscalation,
      onVerification: verboseVerification,
      onComplete: verboseComplete,
    };
  } else if (values.quiet) {
    // Quiet mode - minimal output
    handlers = {
      onProgress: () => {},
      onMessage: () => {},
      onError: quietError,
      onSupervision: () => {},
      onEscalation: () => {},
      onVerification: () => {},
      onComplete: quietComplete,
    };
  } else {
    // Dashboard mode - fancy UI
    dashboard = new InkDashboard({ verbose: values.verbose });

    handlers = {
      onProgress: (data) => {
        if (data.type === 'initialized') {
          dashboard.init(data);
        } else {
          dashboard.updateProgress(data);
        }
      },
      onMessage: (data) => dashboard.showMessage(data),
      onError: (data) => dashboard.showError(data),
      onSupervision: (data) => dashboard.updateSupervision(data),
      onEscalation: (data) => dashboard.showEscalation(data),
      onVerification: (data) => dashboard.showVerification(data),
      onComplete: (report) => dashboard.showReport(report),
    };
  }

  // Create runner (use RetryableAutonomousRunner if --retry flag is set)
  const runner = values.retry
    ? new RetryableAutonomousRunner({
        workingDirectory: values.directory,
        verbose: values.verbose,
        timeLimit: values['time-limit'],
        maxAttempts: parseInt(values['max-retries'], 10) || 100,
        config: {
          verbose: values.verbose,
        },
        ...handlers,
      })
    : new AutonomousRunnerCLI({
        workingDirectory: values.directory,
        verbose: values.verbose,
        config: {
          verbose: values.verbose,
        },
        ...handlers,
      });

  // Handle graceful shutdown
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (dashboard) {
      dashboard.cleanup();
      dashboard.log('\nReceived shutdown signal. Stopping gracefully...', 'warning');
    } else if (!values.json) {
      log('\nReceived shutdown signal. Stopping gracefully...', 'yellow');
    }

    runner.stop();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await runner.initialize({
      primaryGoal,
      subGoals: values['sub-goal'] || [],
      timeLimit: values['time-limit'],
      workingDirectory: values.directory,
      initialContext: values.context || '',
    });

    const report = await runner.run();

    if (dashboard) {
      dashboard.cleanup();
    }

    process.exit(report.status === 'completed' ? 0 : 1);

  } catch (error) {
    if (dashboard) {
      dashboard.cleanup();
    }

    if (values.json) {
      console.log(JSON.stringify({ type: 'fatal_error', error: error.message }));
    } else {
      log(`\n${icons.error} Fatal error: ${error.message}`, 'red');
      if (values.verbose) {
        console.error(error.stack);
      }
    }
    process.exit(1);
  }
}

main();
