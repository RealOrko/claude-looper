#!/usr/bin/env node

/**
 * CLI entry point for Claude Autonomous Runner (Max Subscription Version)
 * Uses Claude Code CLI - no API key required, uses your Max subscription
 *
 * Usage: claude-auto [options] "Your goal here"
 */

import { AutonomousRunnerCLI } from './autonomous-runner-cli.js';
import { parseArgs } from 'util';
import { Dashboard } from './ui/dashboard.js';
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
  ${colors.green}-h, --help${style.reset}               Show this help message
  ${colors.green}--version${style.reset}                Show version number

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
    log(`${icons.error} Error: Claude Code CLI not found.`, 'red');
    log('Please install it: npm install -g @anthropic-ai/claude-code', 'dim');
    log('Then authenticate: claude', 'dim');
    process.exit(1);
  }

  // Determine primary goal
  const primaryGoal = values.goal || positionals[0];
  if (!primaryGoal) {
    log(`${icons.error} Error: No goal specified.`, 'red');
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
    dashboard = new Dashboard({ verbose: values.verbose });

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

  // Create runner
  const runner = new AutonomousRunnerCLI({
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
