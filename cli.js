#!/usr/bin/env node

/**
 * CLI Entry Point for Multi-Agent Framework
 *
 * Usage:
 *   claude-looper "Your goal description"
 *   claude-looper --resume
 *   claude-looper --status
 *   claude-looper --no-ui "goal"  (disable terminal UI)
 *   claude-looper --docker "goal" (run inside Docker container)
 */

// Check for --docker flag early before other imports
const rawArgs = process.argv.slice(2);
if (rawArgs.includes('--docker')) {
  runInDocker(rawArgs.filter(a => a !== '--docker')).then(code => process.exit(code));
} else {
  // Only import heavy modules if not running in docker mode
  startMain();
}

/**
 * Run the CLI inside a Docker container
 */
async function runInDocker(args) {
  const { spawn } = await import('child_process');
  const { homedir } = await import('os');
  const path = await import('path');
  const fs = await import('fs');

  const cwd = process.cwd();
  const home = homedir();
  const claudeConfigDir = path.join(home, '.claude');
  const sshDir = path.join(home, '.ssh');

  // ANSI color codes
  const cyan = '\x1b[36m';
  const gray = '\x1b[90m';
  const reset = '\x1b[0m';

  // Build docker run command
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
    // Set working directory
    '-w', '/home/claude/workspace',
  ];

  // Optionally mount ~/.ssh if it exists (read-only)
  if (fs.existsSync(sshDir)) {
    dockerArgs.push('-v', `${sshDir}:/home/claude/.ssh:ro`);
  }

  // Mount /tmp for temporary files
  dockerArgs.push('-v', '/tmp:/tmp');

  // Add the image name
  dockerArgs.push('claude');

  // Run claude-looper with the passed arguments
  dockerArgs.push('claude-looper', ...args);

  console.log(`${cyan}→ Running in docker container...${reset}`);
  console.log(`${gray}  Mounting: ${cwd} -> /home/claude/workspace${reset}`);
  console.log(`${gray}  Mounting: ${claudeConfigDir} -> /home/claude/.claude${reset}`);
  if (fs.existsSync(sshDir)) {
    console.log(`${gray}  Mounting: ${sshDir} -> /home/claude/.ssh (read-only)${reset}`);
  }
  console.log(`${gray}  Mounting: /tmp -> /tmp${reset}`);
  console.log('');

  const proc = spawn('docker', dockerArgs, {
    stdio: 'inherit',
  });

  return new Promise((resolve) => {
    proc.on('close', (code) => {
      resolve(code ?? 0);
    });
    proc.on('error', (err) => {
      console.error(`Failed to start docker: ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Start the main CLI (non-docker mode)
 */
async function startMain() {
  const { Orchestrator, PHASES } = await import('./orchestrator.js');
  const agentCoreModule = await import('./agent-core.js');
  const agentCore = agentCoreModule.default;
  const { EventTypes } = agentCoreModule;
  const agentExecutorModule = await import('./agent-executor.js');
  const agentExecutor = agentExecutorModule.default;
  const { TerminalUI } = await import('./terminal-ui.js');

  const args = process.argv.slice(2);
  const useUI = !args.includes('--no-ui');

  /**
   * Set up UI event handlers for both execute and resume flows
   */
  function setupUIEventHandlers(ui, orchestrator) {
    // Helper to update tasks with current/next indicators
    const updateTasksWithState = () => {
      const plannerAgent = agentCore.getAgent('planner');
      if (plannerAgent) {
        // Get execution state from planner if available
        const planner = orchestrator.agents?.planner;
        const execState = planner?.getTaskExecutionState?.() || {};
        ui.updateTasks(plannerAgent.tasks, {
          currentTaskId: execState.currentTaskId,
          nextTaskId: execState.nextTaskId
        });
      }
    };

    // Wire up agentCore events
    agentCore.on('*', (event) => {
      ui.addEventFromCore(event);

      // Update phase on workflow events
      if (event.type === EventTypes.WORKFLOW_STARTED) {
        ui.setPhase('planning');
      }

      // Update tasks when planner tasks change
      if (event.source === 'planner' &&
          (event.type === EventTypes.TASK_ADDED ||
           event.type === EventTypes.TASK_UPDATED ||
           event.type === EventTypes.TASK_COMPLETED ||
           event.type === EventTypes.TASK_FAILED)) {
        updateTasksWithState();
      }
    });

    // Wire up agentExecutor callbacks for real-time output
    agentExecutor.setCallbacks({
      onStdout: ({ agentName, chunk }) => {
        ui.updateAgentPanel(agentName, chunk);
      },
      onStart: ({ agentName, prompt }) => {
        ui.setBusy(true);
        // Display the prompt being sent to the agent
        if (prompt) {
          ui.showAgentPrompt(agentName, prompt);
        }
      },
      onComplete: () => {
        ui.setBusy(false);
      },
      onError: () => {
        ui.setBusy(false);
      },
      onStderr: ({ agentName, chunk }) => {
        ui.addEvent(agentName, `stderr: ${chunk.trim()}`);
      },
      onRetry: ({ agentName, attempt, maxRetries, delay }) => {
        ui.addEvent(agentName, `Retry ${attempt}/${maxRetries} (${Math.round(delay)}ms)`);
      },
      onFallback: ({ agentName, model }) => {
        ui.addEvent(agentName, `Fallback to model: ${model}`);
      }
    });

    // Handle graceful shutdown with state preservation
    const cleanup = (signal) => {
      // Save state before exiting
      try {
        orchestrator.abort();
        agentCore.snapshot();
      } catch (e) {
        // Ignore errors during cleanup
      }
      // Clear executor callbacks
      agentExecutor.clearCallbacks();
      if (ui) {
        ui.shutdown();
      }
      if (signal) {
        console.log(`\nWorkflow interrupted. Run with --resume to continue.`);
        process.exit(130); // 128 + SIGINT(2)
      }
    };

    process.on('SIGINT', () => cleanup('SIGINT'));
    process.on('SIGTERM', () => cleanup('SIGTERM'));
    process.on('uncaughtException', (err) => {
      cleanup();
      console.error('Uncaught exception:', err);
      process.exit(1);
    });

    // Set up phase monitoring
    const phaseCheck = setInterval(() => {
      if (orchestrator.currentPhase && ui) {
        ui.setPhase(orchestrator.currentPhase);
      }
    }, 100);

    // Return cleanup function
    return () => {
      clearInterval(phaseCheck);
      cleanup();
    };
  }

  // Enable silent mode when UI is active to prevent console output interfering
  const orchestrator = new Orchestrator({ silent: useUI });
  let ui = null;
  let cleanupUI = null;

  // Handle --status flag (no UI, quick exit)
  if (args.includes('--status')) {
    if (agentCore.canResume()) {
      const resumeInfo = agentCore.getResumeInfo();
      console.log('Saved Workflow State:');
      console.log(`  Goal: ${resumeInfo.goal}`);
      console.log(`  Status: ${resumeInfo.status}`);
      console.log(`  Tasks: ${resumeInfo.tasks.completed}/${resumeInfo.tasks.total} completed`);
      if (resumeInfo.tasks.failed > 0) {
        console.log(`  Failed: ${resumeInfo.tasks.failed} tasks`);
      }
      if (resumeInfo.tasks.pending > 0) {
        console.log(`  Pending: ${resumeInfo.tasks.pending} tasks`);
      }
      console.log(`\nRun with --resume to continue this workflow.`);
    } else {
      console.log('No saved workflow state.');
    }
    return;
  }

  // Handle --resume flag
  if (args.includes('--resume')) {
    if (!agentCore.canResume()) {
      console.log('No saved state to resume from.');
      process.exit(1);
    }

    const resumeInfo = agentCore.getResumeInfo();

    if (!useUI) {
      console.log('Resuming workflow...');
      console.log(`  Goal: ${resumeInfo.goal}`);
      console.log(`  Previous status: ${resumeInfo.status}`);
      console.log(`  Tasks: ${resumeInfo.tasks.completed}/${resumeInfo.tasks.total} completed, ${resumeInfo.tasks.failed} failed`);
      console.log('---');
    }

    // Initialize UI if enabled
    if (useUI) {
      ui = new TerminalUI();
      await ui.init();
      cleanupUI = setupUIEventHandlers(ui, orchestrator);

      // Show initial tasks from saved state
      const state = agentCore.loadSnapshot();
      if (state?.agents?.planner?.tasks) {
        // Find current and next tasks from saved state
        const tasks = state.agents.planner.tasks;
        const currentTask = tasks.find(t => t.status === 'in_progress');
        const pendingTasks = tasks.filter(t => t.status === 'pending');
        const nextTask = pendingTasks[0]; // First pending task
        ui.updateTasks(tasks, {
          currentTaskId: currentTask?.id,
          nextTaskId: nextTask?.id
        });
      }
      ui.setPhase('execution');
    }

    try {
      const result = await orchestrator.resumeExecution();

      if (cleanupUI) cleanupUI();
      if (ui) ui.shutdown();

      console.log('---');
      console.log(`Workflow ${result.success ? 'COMPLETED' : 'FAILED'} (resumed)`);
      console.log(`Duration: ${Math.round(result.duration / 1000)}s`);
      console.log(`Status: ${result.status}`);

      if (result.summary) {
        console.log('\nAgent Summary:');
        for (const agent of result.summary.agents) {
          console.log(`  ${agent.name}: ${agent.completedTasks}/${agent.taskCount} tasks`);
        }
      }

      process.exit(result.success ? 0 : 1);
    } catch (error) {
      if (cleanupUI) cleanupUI();
      if (ui) ui.shutdown();
      console.error(`Resume failed: ${error.message}`);
      console.log('State saved. You can try resuming again with --resume');
      process.exit(1);
    }
  }

  // Get goal from arguments (filter out flags)
  const goal = args.filter(a => !a.startsWith('--')).join(' ');

  if (!goal) {
    console.log('Usage: claude-looper "Your goal description"');
    console.log('       claude-looper --resume');
    console.log('       claude-looper --status');
    console.log('       claude-looper --no-ui "goal"');
    console.log('       claude-looper --docker "goal"');
    process.exit(1);
  }

  // Initialize UI if enabled
  if (useUI) {
    ui = new TerminalUI();
    await ui.init();
    cleanupUI = setupUIEventHandlers(ui, orchestrator);
  } else {
    console.log(`Starting workflow for goal: ${goal}`);
    console.log('---');
  }

  try {
    const result = await orchestrator.execute(goal);

    // Cleanup UI before showing results
    if (cleanupUI) cleanupUI();
    if (ui) ui.shutdown();

    console.log('---');
    console.log(`Workflow ${result.success ? 'COMPLETED' : 'FAILED'}`);
    console.log(`Duration: ${Math.round(result.duration / 1000)}s`);
    console.log(`Status: ${result.status}`);

    if (result.summary) {
      console.log('\nAgent Summary:');
      for (const agent of result.summary.agents) {
        console.log(`  ${agent.name}: ${agent.completedTasks}/${agent.taskCount} tasks`);
      }
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    if (cleanupUI) cleanupUI();
    if (ui) ui.shutdown();
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
