#!/usr/bin/env node

/**
 * CLI Entry Point for Multi-Agent Framework
 *
 * Usage:
 *   node cli.js "Your goal description"
 *   node cli.js --resume
 *   node cli.js --status
 *   node cli.js --no-ui "goal"  (disable terminal UI)
 */

import { Orchestrator, PHASES } from './orchestrator.js';
import agentCore, { EventTypes } from './agent-core.js';
import agentExecutor from './agent-executor.js';
import { TerminalUI } from './terminal-ui.js';

const args = process.argv.slice(2);
const useUI = !args.includes('--no-ui');

/**
 * Set up UI event handlers for both execute and resume flows
 */
function setupUIEventHandlers(ui, orchestrator) {
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
      const plannerAgent = agentCore.getAgent('planner');
      if (plannerAgent) {
        ui.updateTasks(plannerAgent.tasks);
      }
    }
  });

  // Wire up agentExecutor events for real-time output
  agentExecutor.on('stdout', ({ agentName, chunk }) => {
    ui.updateAgentPanel(agentName, chunk);
  });

  // Show busy spinner when agents are executing
  agentExecutor.on('start', () => {
    ui.setBusy(true);
  });

  agentExecutor.on('complete', () => {
    ui.setBusy(false);
  });

  agentExecutor.on('error', () => {
    ui.setBusy(false);
  });

  agentExecutor.on('stderr', ({ agentName, chunk }) => {
    ui.addEvent(agentName, `stderr: ${chunk.trim()}`);
  });

  agentExecutor.on('retry', ({ agentName, attempt, maxRetries, delay }) => {
    ui.addEvent(agentName, `Retry ${attempt}/${maxRetries} (${Math.round(delay)}ms)`);
  });

  agentExecutor.on('fallback', ({ agentName, model }) => {
    ui.addEvent(agentName, `Fallback to model: ${model}`);
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

async function main() {
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
        ui.updateTasks(state.agents.planner.tasks);
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
    console.log('Usage: node cli.js "Your goal description"');
    console.log('       node cli.js --resume');
    console.log('       node cli.js --status');
    console.log('       node cli.js --no-ui "goal"');
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

main().catch(console.error);
