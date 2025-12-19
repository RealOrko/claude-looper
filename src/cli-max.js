#!/usr/bin/env node

/**
 * CLI entry point for Claude Autonomous Runner (Max Subscription Version)
 * Uses Claude Code CLI - no API key required, uses your Max subscription
 *
 * Usage: claude-auto [options] "Your goal here"
 */

import { AutonomousRunnerCLI } from './autonomous-runner-cli.js';
import { RetryableAutonomousRunner } from './retryable-runner.js';
import { StatePersistence } from './state-persistence.js';
import { InkDashboard } from './ui/ink-dashboard.js';
import { colors, style, icons } from './ui/terminal.js';
import { AgentWebSocketServer } from './ui/websocket-server.js';
import {
  VERSION,
  generateHelpText,
  parseCliArgs,
  validateArgs,
  getOutputMode,
  parseTimeLimit,
} from './argument-parser.js';
import {
  log,
  getHandlers,
  verboseHandlers,
  jsonHandlers,
  quietHandlers,
} from './output-handlers.js';

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
    // Use host network for better connectivity
    '--network=host',
    // Mount current directory as workspace
    '-v', `${cwd}:/home/claude/workspace`,
    // Mount ~/.claude for credentials (read-write since Claude Code writes debug logs)
    '-v', `${claudeConfigDir}:/home/claude/.claude`,
    // Mount ~/.ssh for git SSH authentication (read-only)
    '-v', `${sshDir}:/home/claude/.ssh:ro`,
    // Mount /tmp for temporary files (read-write)
    '-v', '/tmp:/tmp',
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
  log(`${colors.gray}  Mounting: /tmp -> /tmp${style.reset}`);
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

/**
 * List available sessions for resuming
 */
async function listSessions(stateDir, workingDirectory) {
  const persistence = new StatePersistence({
    persistenceDir: stateDir,
    workingDirectory: workingDirectory,
  });
  await persistence.initialize();

  const sessions = await persistence.listSessions();

  if (sessions.length === 0) {
    log(`${icons.info} No sessions found.`, 'cyan');
    log('Start a new session with: claude-auto "Your goal here"', 'dim');
    return;
  }

  log(`\n${colors.cyan}${style.bold}Available Sessions${style.reset}\n`);
  log(`${'─'.repeat(80)}`);

  for (const session of sessions) {
    const hasIncompleteSteps = session.totalSteps > 0 && session.completedSteps < session.totalSteps;
    const isPrematurelyCompleted = session.status === 'completed' && hasIncompleteSteps;

    const statusIcon = session.status === 'failed' ? colors.red + icons.error :
                       isPrematurelyCompleted ? colors.yellow + icons.warning :
                       session.status === 'completed' ? colors.green + icons.success :
                       colors.yellow + icons.warning;
    const statusText = isPrematurelyCompleted ? 'INCOMPLETE' : session.status.toUpperCase();

    const progress = session.totalSteps > 0
      ? `${session.completedSteps}/${session.totalSteps} steps`
      : 'No plan';

    const age = formatAge(Date.now() - session.updatedAt);
    const canResume = session.status !== 'failed' && (session.status !== 'completed' || isPrematurelyCompleted);

    log(`${statusIcon} ${style.bold}${session.id}${style.reset}`);
    log(`   ${colors.gray}Goal:${style.reset} ${truncate(session.goal, 60)}`);
    log(`   ${colors.gray}Status:${style.reset} ${statusText}  ${colors.gray}Progress:${style.reset} ${progress}  ${colors.gray}Updated:${style.reset} ${age} ago`);
    if (canResume) {
      log(`   ${colors.cyan}→ Resume: claude-auto --resume ${session.id}${style.reset}`);
    }
    log('');
  }
}

/**
 * Interactive session selector using readline
 */
async function selectSession(sessions, persistencePath) {
  const { createInterface } = await import('readline');

  if (sessions.length === 0) {
    log(`${icons.warning} No sessions found.`, 'yellow');
    if (persistencePath) {
      log(`Looked in: ${persistencePath}`, 'dim');
    }
    log('Start a new session with: claude-auto "Your goal here"', 'dim');
    return null;
  }

  // A session is resumable if:
  // 1. It's not completed or failed (active/interrupted), OR
  // 2. It's marked "completed" but has incomplete steps (premature completion)
  const resumableSessions = sessions.filter(s => {
    const isActiveSession = s.status !== 'completed' && s.status !== 'failed';
    const hasIncompleteSteps = s.totalSteps > 0 && s.completedSteps < s.totalSteps;
    const isPrematurelyCompleted = s.status === 'completed' && hasIncompleteSteps;
    return isActiveSession || isPrematurelyCompleted;
  });

  if (resumableSessions.length === 0) {
    log(`${icons.warning} No resumable sessions found.`, 'yellow');
    log(`Found ${sessions.length} session(s), but all are fully completed or failed.`, 'dim');
    log('Start a new session with: claude-auto "Your goal here"', 'dim');
    return null;
  }

  log(`\n${colors.cyan}${style.bold}Select a session to resume${style.reset}\n`);
  log(`${'─'.repeat(80)}`);

  resumableSessions.forEach((session, index) => {
    const hasIncompleteSteps = session.totalSteps > 0 && session.completedSteps < session.totalSteps;
    const isPrematurelyCompleted = session.status === 'completed' && hasIncompleteSteps;

    const statusIcon = isPrematurelyCompleted
      ? colors.yellow + icons.warning + ' (incomplete)'
      : colors.yellow + icons.warning;
    const progress = session.totalSteps > 0
      ? `${session.completedSteps}/${session.totalSteps} steps`
      : 'No plan';
    const age = formatAge(Date.now() - session.updatedAt);

    log(`  ${colors.cyan}${style.bold}[${index + 1}]${style.reset} ${session.id} ${statusIcon}${style.reset}`);
    log(`      ${colors.gray}Goal:${style.reset} ${truncate(session.goal, 55)}`);
    log(`      ${colors.gray}Progress:${style.reset} ${progress}  ${colors.gray}Updated:${style.reset} ${age} ago`);
    log('');
  });

  log(`  ${colors.gray}[q] Cancel${style.reset}`);
  log(`${'─'.repeat(80)}\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${colors.cyan}Enter selection (1-${resumableSessions.length}): ${style.reset}`, (answer) => {
      rl.close();

      const trimmed = answer.trim().toLowerCase();
      if (trimmed === 'q' || trimmed === '') {
        log('Cancelled.', 'dim');
        resolve(null);
        return;
      }

      const index = parseInt(trimmed, 10) - 1;
      if (isNaN(index) || index < 0 || index >= resumableSessions.length) {
        log(`${icons.error} Invalid selection.`, 'red');
        resolve(null);
        return;
      }

      resolve(resumableSessions[index]);
    });
  });
}

/**
 * Handle --resume flag - find session and return info
 */
async function handleResume(sessionId, stateDir, workingDirectory) {
  const persistence = new StatePersistence({
    persistenceDir: stateDir,
    workingDirectory: workingDirectory,
  });
  await persistence.initialize();

  const sessions = await persistence.listSessions();

  // If sessionId is '__SELECT__', show interactive picker
  if (sessionId === '__SELECT__') {
    const selected = await selectSession(sessions, persistence.persistencePath);
    if (!selected) {
      return null;
    }

    const progress = selected.totalSteps > 0
      ? `${selected.completedSteps}/${selected.totalSteps} steps`
      : 'No plan';

    log(`\n${icons.success} Resuming session: ${selected.id}`, 'green');
    log(`   ${colors.gray}Goal:${style.reset} ${truncate(selected.goal, 60)}`);
    log(`   ${colors.gray}Progress:${style.reset} ${progress}`);
    log('');

    return {
      sessionId: selected.id,
      goal: selected.goal,
    };
  }

  // Find the session by ID
  const session = sessions.find(s => s.id === sessionId);
  if (!session) {
    log(`${icons.error} Session not found: ${sessionId}`, 'red');
    log('Run --resume without an ID to select from available sessions.', 'dim');
    return null;
  }

  // Check if session can be resumed
  const hasIncompleteSteps = session.totalSteps > 0 && session.completedSteps < session.totalSteps;
  const isPrematurelyCompleted = session.status === 'completed' && hasIncompleteSteps;

  if (session.status === 'completed' && !isPrematurelyCompleted) {
    log(`${icons.warning} Session fully completed: ${sessionId}`, 'yellow');
    log('Start a new session with: claude-auto "Your goal here"', 'dim');
    return null;
  }

  if (session.status === 'failed') {
    log(`${icons.warning} Session failed: ${sessionId}`, 'yellow');
    log('Start a new session with: claude-auto "Your goal here"', 'dim');
    return null;
  }

  if (isPrematurelyCompleted) {
    log(`${icons.info} Session marked completed but has incomplete steps (${session.completedSteps}/${session.totalSteps})`, 'cyan');
  }

  const progress = session.totalSteps > 0
    ? `${session.completedSteps}/${session.totalSteps} steps`
    : 'No plan';

  log(`${icons.success} Resuming session: ${sessionId}`, 'green');
  log(`   ${colors.gray}Goal:${style.reset} ${truncate(session.goal, 60)}`);
  log(`   ${colors.gray}Progress:${style.reset} ${progress}`);
  log('');

  return {
    sessionId: session.id,
    goal: session.goal,
  };
}

/**
 * Format a duration as human-readable age
 */
function formatAge(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * Truncate string with ellipsis
 */
function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

async function main() {
  // Parse CLI arguments using argument-parser module
  const { values, positionals } = parseCliArgs(process.argv.slice(2));

  if (values.help) {
    console.log(generateHelpText());
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

  // Handle --list-sessions
  if (values['list-sessions']) {
    await listSessions(values['state-dir'], values.directory);
    process.exit(0);
  }

  // Handle --resume
  let resumeSessionId = null;
  let resumedGoal = null;
  if (values.resume !== undefined) {
    const result = await handleResume(values.resume, values['state-dir'], values.directory);
    if (!result) {
      process.exit(1);
    }
    resumeSessionId = result.sessionId;
    resumedGoal = result.goal;
  }

  // Validate arguments
  const validation = validateArgs(values, positionals, resumedGoal);
  if (!validation.valid) {
    for (const error of validation.errors) {
      log(`${icons.error} ${error}`, 'red');
    }
    log('Usage: claude-auto "Your goal here"', 'dim');
    log('Run with --help for more options.', 'dim');
    process.exit(1);
  }
  const primaryGoal = validation.primaryGoal;

  // Create dashboard or use simple handlers based on mode
  let dashboard = null;
  let handlers = {};
  let wsServer = null;

  // Initialize WebSocket server if --ui flag is set
  if (values.ui) {
    wsServer = new AgentWebSocketServer({
      port: parseInt(values['ui-port'], 10) || 3000,
    });
    await wsServer.start();
    wsServer.startHeartbeat();
  }

  if (values.json) {
    // JSON mode - structured output
    handlers = {
      onProgress: jsonHandlers.progress,
      onMessage: jsonHandlers.message,
      onError: jsonHandlers.error,
      onSupervision: jsonHandlers.supervision,
      onEscalation: jsonHandlers.escalation,
      onVerification: jsonHandlers.verification,
      onComplete: jsonHandlers.complete,
    };
  } else if (values.quiet && values.verbose) {
    // Verbose debug mode - plain text logs, no dashboard
    console.log('[DEBUG MODE] Verbose logging enabled without dashboard\n');
    handlers = {
      onProgress: verboseHandlers.progress,
      onMessage: verboseHandlers.message,
      onError: verboseHandlers.error,
      onSupervision: verboseHandlers.supervision,
      onEscalation: verboseHandlers.escalation,
      onVerification: verboseHandlers.verification,
      onComplete: verboseHandlers.complete,
    };
  } else if (values.quiet) {
    // Quiet mode - minimal output
    handlers = {
      onProgress: quietHandlers.progress,
      onMessage: quietHandlers.message,
      onError: quietHandlers.error,
      onSupervision: quietHandlers.supervision,
      onEscalation: quietHandlers.escalation,
      onVerification: quietHandlers.verification,
      onComplete: quietHandlers.complete,
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

  // Wrap handlers with WebSocket broadcasting if UI is enabled
  if (wsServer) {
    handlers = wsServer.createHandlers(handlers);
  }

  // Create runner (use RetryableAutonomousRunner if --retry flag is set)
  const runner = values.retry
    ? new RetryableAutonomousRunner({
        workingDirectory: values.directory,
        verbose: values.verbose,
        timeLimit: values['time-limit'],
        maxAttempts: parseInt(values['max-retries'], 10) || 100,
        resumeSessionId,
        config: {
          verbose: values.verbose,
        },
        ...handlers,
      })
    : new AutonomousRunnerCLI({
        workingDirectory: values.directory,
        verbose: values.verbose,
        resumeSessionId,
        config: {
          verbose: values.verbose,
        },
        ...handlers,
      });

  // Handle graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (dashboard) {
      dashboard.cleanup();
      dashboard.log('\nReceived shutdown signal. Stopping gracefully...', 'warning');
    } else if (!values.json) {
      log('\nReceived shutdown signal. Stopping gracefully...', 'yellow');
    }

    runner.stop();

    if (wsServer) {
      wsServer.stopHeartbeat();
      await wsServer.stop();
    }
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

    if (wsServer) {
      wsServer.stopHeartbeat();
      await wsServer.stop();
    }

    process.exit(report.status === 'completed' ? 0 : 1);

  } catch (error) {
    if (dashboard) {
      dashboard.cleanup();
    }

    if (wsServer) {
      wsServer.stopHeartbeat();
      await wsServer.stop();
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
