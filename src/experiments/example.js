/**
 * Example: Using the Multi-Agent Framework
 *
 * This example demonstrates how to use the framework programmatically
 * for custom workflows and agent interactions.
 */

import agentCore, { EventTypes } from './agent-core.js';
import { PlannerAgent } from './agent-planner.js';
import { CoderAgent } from './agent-coder.js';
import { TesterAgent } from './agent-tester.js';
import { SupervisorAgent, VERIFICATION_TYPES } from './agent-supervisor.js';

/**
 * Example 1: Basic Agent Registration and State Management
 */
async function basicExample() {
  console.log('=== Basic Agent Registration ===\n');

  // Reset for clean state
  agentCore.reset();

  // Register a custom agent
  const customAgent = agentCore.registerAgent('my-agent', {
    model: 'sonnet',
    state: { counter: 0 },
    subscribesTo: ['planner'],
    tools: [{ name: 'myCustomTool', params: [] }]
  });

  console.log('Registered agent:', customAgent.name);
  console.log('Model:', customAgent.model);

  // Update state
  agentCore.updateAgentState('my-agent', { counter: 1 });
  console.log('Updated state:', agentCore.getAgentState('my-agent'));

  // Add a goal
  const goal = agentCore.setGoal('my-agent', {
    description: 'Complete the example',
    metadata: { priority: 'high' }
  });
  console.log('Set goal:', goal.description);

  // Add a task
  const task = agentCore.addTask('my-agent', {
    description: 'First task',
    parentGoalId: goal.id,
    metadata: { complexity: 'simple' }
  });
  console.log('Added task:', task.description);

  // Add memory
  agentCore.addMemory('my-agent', {
    content: 'Important observation',
    type: 'observation'
  });

  console.log('\nSummary:', agentCore.getSummary());
}

/**
 * Example 2: Event Subscriptions
 */
async function eventExample() {
  console.log('\n=== Event Subscriptions ===\n');

  agentCore.reset();

  // Register agents
  agentCore.registerAgent('publisher');
  agentCore.registerAgent('subscriber');

  // Set up event listener
  const events = [];
  agentCore.subscribeToAgents('subscriber', ['publisher'], (event) => {
    events.push(event);
    console.log(`Event received: ${event.type} from ${event.source}`);
  });

  // Trigger events
  agentCore.updateAgentState('publisher', { status: 'working' });
  agentCore.addTask('publisher', 'Do something');
  agentCore.addMemory('publisher', 'Remember this');

  console.log(`\nTotal events captured: ${events.length}`);
}

/**
 * Example 3: Snapshotting and Resume
 */
async function snapshotExample() {
  console.log('\n=== Snapshotting ===\n');

  agentCore.reset();

  // Set up some state
  agentCore.registerAgent('snapshot-demo', { state: { data: 'important' } });
  agentCore.startWorkflow('demo-workflow', 'Demo goal');
  agentCore.addTask('snapshot-demo', 'Task to preserve');

  // Save snapshot
  const saved = agentCore.snapshot();
  console.log('Snapshot saved at:', new Date(saved.timestamp).toISOString());

  // Check if resume is possible
  console.log('Can resume:', agentCore.canResume());

  // Reset and resume
  agentCore.reset();
  console.log('After reset, agents:', Object.keys(agentCore.agents));

  const loaded = agentCore.resume();
  console.log('After resume, agents:', Object.keys(agentCore.agents));
  console.log('Preserved state:', agentCore.getAgentState('snapshot-demo'));
}

/**
 * Example 4: Using the Pre-built Agents
 */
async function agentWrapperExample() {
  console.log('\n=== Pre-built Agents ===\n');

  agentCore.reset();

  // Initialize agents
  const planner = new PlannerAgent({ model: 'sonnet' });
  const coder = new CoderAgent({ model: 'opus' });
  const tester = new TesterAgent({ model: 'opus' });
  const supervisor = new SupervisorAgent({ model: 'opus' });

  console.log('Initialized agents:');
  console.log('- Planner:', planner.name, '(model:', planner.model + ')');
  console.log('- Coder:', coder.name, '(model:', coder.model + ')');
  console.log('- Tester:', tester.name, '(model:', tester.model + ')');
  console.log('- Supervisor:', supervisor.name, '(model:', supervisor.model + ')');

  // Get stats
  console.log('\nPlanner stats:', planner.getStats());
  console.log('Coder stats:', coder.getStats());
  console.log('Tester stats:', tester.getStats());
  console.log('Supervisor stats:', supervisor.getStats());
}

/**
 * Example 5: Workflow Configuration
 */
async function configurationExample() {
  console.log('\n=== Workflow Configuration ===\n');

  agentCore.reset();

  // Load configuration
  const config = agentCore.loadConfiguration();

  if (config) {
    const workflow = config['default-workflow'];
    console.log('Workflow name:', workflow.name);
    console.log('Agents configured:', Object.keys(workflow.agents));
    console.log('Execution phases:', workflow.execution.phases);
    console.log('Time limit:', workflow.execution.timeLimit / 1000 / 60, 'minutes');
  } else {
    console.log('No configuration file found. Creating default...');

    // Save default config
    agentCore.saveConfiguration({
      'default-workflow': {
        name: 'Custom Workflow',
        agents: {
          planner: { model: 'sonnet' },
          coder: { model: 'opus' }
        }
      }
    });

    console.log('Configuration saved.');
  }
}

/**
 * Example 6: Inter-Agent Communication
 */
async function communicationExample() {
  console.log('\n=== Inter-Agent Communication ===\n');

  agentCore.reset();

  // Register agents
  agentCore.registerAgent('sender');
  agentCore.registerAgent('receiver');

  // Log an interaction
  const interaction = agentCore.logInteraction('sender', 'receiver', {
    type: 'request',
    content: { action: 'verify', data: { task: 'implementation' } },
    toolCalls: [{ name: 'verificationComplete', arguments: { approved: true } }]
  });

  console.log('Interaction logged:', interaction.id);
  console.log('From:', interaction.from, 'To:', interaction.to);
  console.log('Content:', JSON.stringify(interaction.content, null, 2));

  // Check both agents have the interaction
  const sender = agentCore.getAgent('sender');
  const receiver = agentCore.getAgent('receiver');

  console.log('\nSender interactions:', sender.interactions.length);
  console.log('Receiver interactions:', receiver.interactions.length);
}

/**
 * Run all examples
 */
async function runExamples() {
  try {
    await basicExample();
    await eventExample();
    await snapshotExample();
    await agentWrapperExample();
    await configurationExample();
    await communicationExample();

    console.log('\n=== All Examples Complete ===\n');
  } catch (error) {
    console.error('Example error:', error);
  }
}

// Run if executed directly
runExamples();
