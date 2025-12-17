#!/usr/bin/env node

/**
 * CLI entry point for Claude Autonomous Runner (Max Subscription Version)
 * Uses Claude Code CLI - no API key required, uses your Max subscription
 *
 * Usage: claude-auto-max [options] "Your goal here"
 */

import { AutonomousRunnerCLI } from './autonomous-runner-cli.js';
import { parseArgs } from 'util';

const VERSION = '1.0.0';

const HELP_TEXT = `
Claude Autonomous Runner v${VERSION} (Max Subscription Edition)
Run Claude in continuous autonomous mode using your Claude Max subscription.

This version uses Claude Code CLI as a subprocess - no API key needed!

USAGE:
  claude-auto-max [options] "Your primary goal"
  claude-auto-max --goal "Primary goal" --sub-goal "Sub goal 1" --sub-goal "Sub goal 2"

OPTIONS:
  -g, --goal <text>        Primary goal (can also be passed as positional argument)
  -s, --sub-goal <text>    Sub-goal (can be specified multiple times)
  -t, --time-limit <time>  Time limit (e.g., "30m", "2h", "24h") [default: 2h]
  -d, --directory <path>   Working directory [default: current directory]
  -c, --context <text>     Additional context for the task
  -v, --verbose            Enable verbose logging (shows Claude's full output)
  -q, --quiet              Minimal output (only errors and final report)
  -j, --json               Output progress as JSON
  -h, --help               Show this help message
  --version                Show version number

EXAMPLES:
  # Simple single goal
  claude-auto-max "Implement a REST API for user management"

  # Multiple sub-goals with time limit
  claude-auto-max -g "Build a todo app" \\
    -s "Create the data model" \\
    -s "Implement CRUD endpoints" \\
    -s "Add authentication" \\
    -t 4h

  # With additional context
  claude-auto-max "Fix the failing tests" -c "Focus on the auth module tests" -t 1h

  # Verbose mode to see all Claude output
  claude-auto-max -v "Refactor the codebase"

REQUIREMENTS:
  - Claude Code CLI must be installed and authenticated
  - Run 'claude' once to authenticate if needed
  - Your Max subscription will be used for API calls

BEHAVIOR:
  - Claude works autonomously toward the goal
  - Progress is tracked and reported periodically
  - Auto-correction activates if Claude drifts off-topic
  - Execution stops when goal achieved or time expires
`;

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  brightRed: '\x1b[1;31m',
  brightYellow: '\x1b[1;33m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function createProgressBar(percent, width) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

function logProgress(data, options) {
  if (options.quiet) return;

  if (options.json) {
    console.log(JSON.stringify({ type: 'progress', ...data }));
    return;
  }

  switch (data.type) {
    case 'initialized':
      log('\n╔════════════════════════════════════════════════════════════════╗', 'cyan');
      log('║     CLAUDE AUTONOMOUS RUNNER (Max Subscription Edition)        ║', 'cyan');
      log('╚════════════════════════════════════════════════════════════════╝', 'cyan');
      log(`\n${colors.bright}Goal:${colors.reset} ${data.goal}`, 'reset');
      if (data.subGoals.length > 0) {
        log(`${colors.bright}Sub-goals:${colors.reset}`, 'reset');
        data.subGoals.forEach((g, i) => log(`  ${i + 1}. ${g}`, 'dim'));
      }
      log(`${colors.bright}Time Limit:${colors.reset} ${data.timeLimit}`, 'reset');
      log(`${colors.dim}Using Claude Code CLI (Max subscription)${colors.reset}\n`, 'reset');
      break;

    case 'started':
      log('▶ Starting autonomous execution...', 'green');
      log(`  Time available: ${data.time.remaining}\n`, 'dim');
      break;

    case 'iteration_complete':
      if (options.verbose) {
        log(`\n─────────────────── Iteration ${data.iteration} ───────────────────`, 'blue');
        log(`Progress: ${data.progress.overallProgress}%`, 'cyan');
        log(`Time: ${data.time.elapsed} elapsed, ${data.time.remaining} remaining`, 'dim');
        log(`Session: ${data.sessionId || 'N/A'}`, 'dim');
      } else {
        const progressBar = createProgressBar(data.progress.overallProgress, 30);
        process.stdout.write(
          `\r${colors.cyan}${progressBar}${colors.reset} ` +
          `${data.progress.overallProgress}% | ` +
          `Iteration ${data.iteration} | ` +
          `${data.time.remaining} remaining   `
        );
      }
      break;

    case 'verification_started':
      // Clear progress line
      if (!options.verbose) {
        process.stdout.write('\r' + ' '.repeat(80) + '\r');
      }
      log('\n🔍 Verifying completion claim...', 'cyan');
      break;
  }
}

function logMessage(data, options) {
  if (options.quiet) return;

  if (options.json) {
    console.log(JSON.stringify({ type: 'message', iteration: data.iteration }));
    return;
  }

  if (options.verbose) {
    log(`\n${colors.bright}Claude [Iteration ${data.iteration}]:${colors.reset}`, 'reset');
    // Show first 1000 chars in verbose mode
    const content = data.content || '';
    log(content.substring(0, 1000) + (content.length > 1000 ? '\n...(truncated)' : ''), 'reset');
  }
}

function logError(data, options) {
  if (options.json) {
    console.log(JSON.stringify({ type: 'error', ...data }));
    return;
  }

  // Clear progress line if not verbose
  if (!options.verbose && !options.quiet) {
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
  }

  log(`\n❌ Error: ${data.error}`, 'red');
  if (data.retry) {
    log(`   Retrying (attempt ${data.retry})...`, 'dim');
  }
}

function logSupervision(data, options) {
  if (options.quiet) return;

  if (options.json) {
    console.log(JSON.stringify({ type: 'supervision', ...data }));
    return;
  }

  const action = data.assessment?.action;
  const score = data.assessment?.score;
  const issues = data.consecutiveIssues || 0;

  // Only show supervision alerts for non-CONTINUE actions
  if (action === 'CONTINUE') return;

  // Clear progress line
  if (!options.verbose) {
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
  }

  // Color based on severity
  let color = 'yellow';
  let icon = '⚠️';
  if (action === 'REFOCUS') {
    color = 'brightYellow';
    icon = '🚨';
  }

  log(`\n${icon}  SUPERVISION ALERT: ${action} (Score: ${score}/100)`, color);
  log(`    Issue: ${data.assessment?.reason || 'Work not aligned with goal'}`, 'dim');
  log(`    Consecutive issues: ${issues}/5`, 'dim');
  if (data.escalated) {
    log(`    [Escalated from ${data.assessment?.originalAction}]`, 'dim');
  }
  console.log(''); // Empty line after alert
}

function logEscalation(data, options) {
  if (options.json) {
    console.log(JSON.stringify({ type: 'escalation', ...data }));
    return;
  }

  // Clear progress line
  if (!options.verbose && !options.quiet) {
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
  }

  if (data.type === 'critical') {
    log('\n╔════════════════════════════════════════════════════════════════╗', 'brightYellow');
    log('║              ⚠️  CRITICAL ESCALATION - FINAL WARNING            ║', 'brightYellow');
    log('╚════════════════════════════════════════════════════════════════╝', 'brightYellow');
    log(`  Consecutive issues: ${data.consecutiveIssues}/5 (ABORT threshold)`, 'yellow');
    log(`  Current score: ${data.score}/100`, 'yellow');
    log(`  ${data.message}`, 'dim');
    log('', 'reset');
  } else if (data.type === 'abort') {
    log('\n╔════════════════════════════════════════════════════════════════╗', 'brightRed');
    log('║              🛑  SESSION ABORTED - DRIFT LIMIT EXCEEDED         ║', 'brightRed');
    log('╚════════════════════════════════════════════════════════════════╝', 'brightRed');
    log(`  Consecutive issues: ${data.consecutiveIssues}/5`, 'red');
    log(`  Final score: ${data.score}/100`, 'red');
    log(`  ${data.message}`, 'dim');
    log('', 'reset');
  } else if (data.type === 'verification_limit') {
    log('\n╔════════════════════════════════════════════════════════════════╗', 'brightYellow');
    log('║          ⚠️  MAX FALSE COMPLETION CLAIMS REACHED                ║', 'brightYellow');
    log('╚════════════════════════════════════════════════════════════════╝', 'brightYellow');
    log(`  False claims: ${data.failures}`, 'yellow');
    log(`  ${data.message}`, 'dim');
    log('', 'reset');
  }
}

function logVerification(data, options) {
  if (options.json) {
    console.log(JSON.stringify({ type: 'verification', ...data }));
    return;
  }

  // Clear progress line
  if (!options.verbose && !options.quiet) {
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
  }

  log('\n┌─────────────────────────────────────────────────────────────────┐', 'cyan');
  log('│                  COMPLETION VERIFICATION                        │', 'cyan');
  log('└─────────────────────────────────────────────────────────────────┘', 'cyan');

  // Layer 1: LLM Challenge
  const l1 = data.layers?.challenge;
  if (l1) {
    const l1Status = l1.passed ? '✓ PASSED' : '✗ FAILED';
    log(`  Layer 1 (LLM Challenge): ${l1Status}`, l1.passed ? 'green' : 'red');
    if (l1.evidence?.files?.length > 0) {
      log(`    Files claimed: ${l1.evidence.files.length}`, 'dim');
    }
  }

  // Layer 2: Artifact Inspection
  const l2 = data.layers?.artifacts;
  if (l2 && !l2.skipped) {
    const l2Status = l2.passed ? '✓ PASSED' : '✗ FAILED';
    log(`  Layer 2 (Artifacts): ${l2Status}`, l2.passed ? 'green' : 'red');
    log(`    Verified: ${l2.verified?.length || 0}, Missing: ${l2.missing?.length || 0}, Empty: ${l2.empty?.length || 0}`, 'dim');
    if (!l2.passed && l2.missing?.length > 0) {
      log(`    Missing: ${l2.missing.slice(0, 3).join(', ')}${l2.missing.length > 3 ? '...' : ''}`, 'dim');
    }
  } else if (l2?.skipped) {
    log(`  Layer 2 (Artifacts): ○ SKIPPED`, 'dim');
  }

  // Layer 3: Test Validation
  const l3 = data.layers?.validation;
  if (l3 && !l3.skipped) {
    const l3Status = l3.passed ? '✓ PASSED' : '✗ FAILED';
    log(`  Layer 3 (Validation): ${l3Status}`, l3.passed ? 'green' : 'red');
    if (l3.testsRun?.length > 0) {
      log(`    Tests run: ${l3.testsRun.length}, Failed: ${l3.testsFailed?.length || 0}`, 'dim');
    }
    if (l3.error) {
      log(`    Error: ${l3.error}`, 'red');
    }
  } else if (l3?.skipped) {
    log(`  Layer 3 (Validation): ○ SKIPPED`, 'dim');
  }

  // Final result
  if (data.passed) {
    log(`\n  ${colors.green}✓ VERIFIED - Completion accepted${colors.reset}`, 'green');
  } else {
    log(`\n  ${colors.yellow}✗ REJECTED - Continuing work${colors.reset}`, 'yellow');
    if (data.failures?.length > 0) {
      log('  Reasons:', 'dim');
      data.failures.forEach(f => log(`    - ${f}`, 'dim'));
    }
  }
  log('', 'reset');
}

function logComplete(report, options) {
  // Clear progress line
  if (!options.verbose && !options.quiet) {
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
  }

  if (options.json) {
    console.log(JSON.stringify({ type: 'complete', ...report }));
    return;
  }

  console.log('\n');
  log('╔════════════════════════════════════════════════════════════════╗', 'green');
  log('║                     EXECUTION COMPLETE                         ║', 'green');
  log('╚════════════════════════════════════════════════════════════════╝', 'green');

  const statusColors = {
    completed: 'green',
    time_expired: 'yellow',
    stopped: 'red',
    aborted: 'brightRed',
  };

  log(`\n${colors.bright}Status:${colors.reset} ${report.status.toUpperCase()}`, statusColors[report.status] || 'reset');
  if (report.abortReason) {
    log(`${colors.bright}Abort Reason:${colors.reset} ${report.abortReason}`, 'red');
  }
  log(`${colors.bright}Progress:${colors.reset} ${report.goal.progress}%`, 'reset');
  log(`${colors.bright}Time Used:${colors.reset} ${report.time.elapsed} (${report.time.percentUsed}% of limit)`, 'reset');
  log(`${colors.bright}Iterations:${colors.reset} ${report.session.iterations}`, 'reset');
  log(`${colors.bright}Session ID:${colors.reset} ${report.session.id || 'N/A'}`, 'reset');

  // Show supervision stats
  const supervision = report.supervision;
  if (supervision) {
    log(`\n${colors.bright}Supervision Stats:${colors.reset}`, 'reset');
    log(`  Assessments: ${supervision.totalAssessments}`, 'dim');
    log(`  Corrections issued: ${supervision.totalCorrections}`, supervision.totalCorrections > 0 ? 'yellow' : 'dim');
    log(`  Average score: ${supervision.averageScore || 'N/A'}/100`, 'dim');
    log(`  Final escalation status: ${supervision.escalationStatus}`, supervision.escalationStatus !== 'OK' ? 'yellow' : 'dim');
    if (supervision.actionCounts && Object.keys(supervision.actionCounts).length > 0) {
      const counts = Object.entries(supervision.actionCounts)
        .map(([action, count]) => `${action}: ${count}`)
        .join(', ');
      log(`  Action breakdown: ${counts}`, 'dim');
    }
  }

  // Show verification stats
  const verification = report.verification;
  if (verification && verification.enabled) {
    log(`\n${colors.bright}Verification:${colors.reset}`, 'reset');
    const statusColor = verification.finalStatus === 'verified' ? 'green' : 'yellow';
    log(`  Final status: ${verification.finalStatus.toUpperCase()}`, statusColor);
    if (verification.failures > 0) {
      log(`  False claims rejected: ${verification.failures}`, 'yellow');
    }
    if (verification.stats) {
      log(`  Verification attempts: ${verification.stats.totalVerifications || 0}`, 'dim');
      log(`  Challenges issued: ${verification.stats.challengesIssued || 0}`, 'dim');
    }
  }

  if (report.goal.milestones.length > 0) {
    log(`\n${colors.bright}Completed Milestones:${colors.reset}`, 'reset');
    report.goal.milestones.forEach(m => log(`  ✓ ${m}`, 'green'));
  }

  if (report.summary && report.summary.summary) {
    log(`\n${colors.bright}Final Summary:${colors.reset}`, 'reset');
    // Show first 500 chars of summary
    const summary = report.summary.summary;
    log(summary.substring(0, 500) + (summary.length > 500 ? '...' : ''), 'dim');
  }

  log('\n');
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
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', default: false },
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

  // Check for Claude Code CLI
  const hasClaudeCode = await checkClaudeCodeInstalled();
  if (!hasClaudeCode) {
    log('Error: Claude Code CLI not found.', 'red');
    log('Please install it: npm install -g @anthropic-ai/claude-code', 'dim');
    log('Then authenticate: claude', 'dim');
    process.exit(1);
  }

  // Determine primary goal
  const primaryGoal = values.goal || positionals[0];
  if (!primaryGoal) {
    log('Error: No goal specified.', 'red');
    log('Usage: claude-auto-max "Your goal here"', 'dim');
    log('Run with --help for more options.', 'dim');
    process.exit(1);
  }

  const options = {
    verbose: values.verbose,
    quiet: values.quiet,
    json: values.json,
  };

  // Create runner
  const runner = new AutonomousRunnerCLI({
    workingDirectory: values.directory,
    verbose: values.verbose,
    config: {
      verbose: values.verbose,
    },
    onProgress: (data) => logProgress(data, options),
    onMessage: (data) => logMessage(data, options),
    onError: (data) => logError(data, options),
    onComplete: (report) => logComplete(report, options),
    onSupervision: (data) => logSupervision(data, options),
    onEscalation: (data) => logEscalation(data, options),
    onVerification: (data) => logVerification(data, options),
  });

  // Handle graceful shutdown
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('\n\nReceived shutdown signal. Stopping gracefully...', 'yellow');
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

    process.exit(report.status === 'completed' ? 0 : 1);

  } catch (error) {
    log(`\nFatal error: ${error.message}`, 'red');
    if (values.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
