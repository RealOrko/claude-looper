#!/usr/bin/env node

/**
 * CLI Entry Point for Multi-Agent Framework
 *
 * Usage:
 *   node cli.js "Your goal description"
 *   node cli.js --resume
 *   node cli.js --status
 */

import { Orchestrator } from './orchestrator.js';
import agentCore from './agent-core.js';

const args = process.argv.slice(2);

async function main() {
  const orchestrator = new Orchestrator();

  // Handle --resume flag
  if (args.includes('--resume')) {
    if (agentCore.canResume()) {
      console.log('Resuming from saved state...');
      const state = agentCore.resume();
      console.log(`Workflow: ${state.workflow.name}`);
      console.log(`Goal: ${state.workflow.goal}`);
      // Resume would continue execution here
      return;
    } else {
      console.log('No saved state to resume from.');
      process.exit(1);
    }
  }

  // Handle --status flag
  if (args.includes('--status')) {
    if (agentCore.canResume()) {
      const state = agentCore.loadSnapshot();
      console.log('Current State:');
      console.log(JSON.stringify(agentCore.getSummary(), null, 2));
    } else {
      console.log('No active workflow.');
    }
    return;
  }

  // Get goal from arguments
  const goal = args.filter(a => !a.startsWith('--')).join(' ');

  if (!goal) {
    console.log('Usage: node cli.js "Your goal description"');
    console.log('       node cli.js --resume');
    console.log('       node cli.js --status');
    process.exit(1);
  }

  console.log(`Starting workflow for goal: ${goal}`);
  console.log('---');

  try {
    const result = await orchestrator.execute(goal);

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
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
