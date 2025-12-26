/**
 * Agent Core Integration Tests
 *
 * These tests verify the core functionality of the multi-agent framework
 * without requiring actual Claude Code CLI execution.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import agentCore, { EventTypes, ChangeTypes } from './agent-core.js';
import fs from 'fs';
import path from 'path';

describe('AgentCore - Core Functionality', () => {
  beforeEach(() => {
    // Reset state before each test
    agentCore.reset();
  });

  afterEach(() => {
    // Clean up any test state files
    const stateDir = agentCore.getStateDir();
    if (fs.existsSync(stateDir)) {
      const statePath = agentCore.getStatePath();
      if (fs.existsSync(statePath)) {
        fs.unlinkSync(statePath);
      }
    }
  });

  describe('Agent Registration', () => {
    it('should register an agent with default options', () => {
      const agent = agentCore.registerAgent('test-agent');

      assert.strictEqual(agent.name, 'test-agent');
      assert.strictEqual(agent.model, 'sonnet');
      assert.deepStrictEqual(agent.state, {});
      assert.deepStrictEqual(agent.subscribesTo, []);
      assert.deepStrictEqual(agent.tools, []);
    });

    it('should register an agent with custom options', () => {
      const agent = agentCore.registerAgent('custom-agent', {
        model: 'opus',
        state: { custom: 'state' },
        subscribesTo: ['other-agent'],
        tools: [{ name: 'customTool' }]
      });

      assert.strictEqual(agent.model, 'opus');
      assert.deepStrictEqual(agent.state, { custom: 'state' });
      assert.deepStrictEqual(agent.subscribesTo, ['other-agent']);
      assert.strictEqual(agent.tools.length, 1);
    });

    it('should throw error when registering duplicate agent', () => {
      agentCore.registerAgent('duplicate-agent');

      assert.throws(() => {
        agentCore.registerAgent('duplicate-agent');
      }, /already registered/);
    });

    it('should emit event on agent registration', async () => {
      const eventPromise = new Promise((resolve) => {
        agentCore.once(EventTypes.AGENT_REGISTERED, (event) => {
          resolve(event);
        });
      });

      agentCore.registerAgent('event-test-agent');

      const event = await eventPromise;
      assert.strictEqual(event.source, 'event-test-agent');
      assert.strictEqual(event.changeType, ChangeTypes.ADDED);
    });
  });

  describe('State Management', () => {
    it('should get and update agent state', () => {
      agentCore.registerAgent('state-agent', {
        state: { count: 0 }
      });

      const initialState = agentCore.getAgentState('state-agent');
      assert.strictEqual(initialState.count, 0);

      const newState = agentCore.updateAgentState('state-agent', { count: 5 });
      assert.strictEqual(newState.count, 5);

      const finalState = agentCore.getAgentState('state-agent');
      assert.strictEqual(finalState.count, 5);
    });

    it('should emit event on state change', async () => {
      agentCore.registerAgent('state-event-agent', { state: { value: 1 } });

      const eventPromise = new Promise((resolve) => {
        agentCore.once(EventTypes.STATE_CHANGED, (event) => {
          resolve(event);
        });
      });

      agentCore.updateAgentState('state-event-agent', { value: 2 });

      const event = await eventPromise;
      assert.strictEqual(event.source, 'state-event-agent');
      assert.strictEqual(event.object.oldState.value, 1);
      assert.strictEqual(event.object.newState.value, 2);
    });

    it('should throw error for non-existent agent', () => {
      assert.throws(() => {
        agentCore.updateAgentState('non-existent', {});
      }, /not found/);
    });
  });

  describe('Goal Management', () => {
    it('should set a goal for an agent', () => {
      agentCore.registerAgent('goal-agent');

      const goal = agentCore.setGoal('goal-agent', {
        description: 'Test goal',
        metadata: { priority: 'high' }
      });

      assert.ok(goal.id.startsWith('goal-'));
      assert.strictEqual(goal.description, 'Test goal');
      assert.strictEqual(goal.status, 'active');
      assert.strictEqual(goal.metadata.priority, 'high');
    });

    it('should update goal status', () => {
      agentCore.registerAgent('goal-update-agent');
      const goal = agentCore.setGoal('goal-update-agent', 'Initial goal');

      const updated = agentCore.updateGoal('goal-update-agent', goal.id, {
        status: 'completed'
      });

      assert.strictEqual(updated.status, 'completed');
    });

    it('should emit goal completion event', async () => {
      agentCore.registerAgent('goal-complete-agent');
      const goal = agentCore.setGoal('goal-complete-agent', 'Goal to complete');

      const eventPromise = new Promise((resolve) => {
        agentCore.once(EventTypes.GOAL_COMPLETED, (event) => {
          resolve(event);
        });
      });

      agentCore.updateGoal('goal-complete-agent', goal.id, { status: 'completed' });

      const event = await eventPromise;
      assert.strictEqual(event.object.id, goal.id);
    });
  });

  describe('Task Management', () => {
    it('should add a task for an agent', () => {
      agentCore.registerAgent('task-agent');

      const task = agentCore.addTask('task-agent', {
        description: 'Test task',
        maxAttempts: 5,
        metadata: { complexity: 'medium' }
      });

      assert.ok(task.id.startsWith('task-'));
      assert.strictEqual(task.description, 'Test task');
      assert.strictEqual(task.status, 'pending');
      assert.strictEqual(task.attempts, 0);
      assert.strictEqual(task.maxAttempts, 5);
    });

    it('should update task status and increment attempts', () => {
      agentCore.registerAgent('task-update-agent');
      const task = agentCore.addTask('task-update-agent', 'Task to update');

      agentCore.updateTask('task-update-agent', task.id, { status: 'in_progress' });
      const agent = agentCore.getAgent('task-update-agent');
      const updatedTask = agent.tasks.find(t => t.id === task.id);

      assert.strictEqual(updatedTask.status, 'in_progress');
      assert.strictEqual(updatedTask.attempts, 1);
    });

    it('should add subtasks', () => {
      agentCore.registerAgent('subtask-agent');
      const parent = agentCore.addTask('subtask-agent', 'Parent task');
      const subtask = agentCore.addSubtask('subtask-agent', parent.id, {
        description: 'Child task'
      });

      assert.strictEqual(subtask.parentTaskId, parent.id);

      const agent = agentCore.getAgent('subtask-agent');
      const parentTask = agent.tasks.find(t => t.id === parent.id);
      assert.ok(parentTask.subtasks.includes(subtask.id));
    });

    it('should emit task events', async () => {
      agentCore.registerAgent('task-event-agent');

      const eventPromise = new Promise((resolve) => {
        agentCore.once(EventTypes.TASK_ADDED, (event) => {
          resolve(event);
        });
      });

      agentCore.addTask('task-event-agent', 'Event test task');

      const event = await eventPromise;
      assert.strictEqual(event.source, 'task-event-agent');
      assert.strictEqual(event.changeType, ChangeTypes.ADDED);
    });
  });

  describe('Memory Management', () => {
    it('should add memory entries', () => {
      agentCore.registerAgent('memory-agent');

      const entry = agentCore.addMemory('memory-agent', {
        content: 'Test memory',
        type: 'observation',
        metadata: { source: 'test' }
      });

      assert.ok(entry.id.startsWith('mem-'));
      assert.strictEqual(entry.content, 'Test memory');
      assert.strictEqual(entry.type, 'observation');
    });

    it('should limit memory to 100 entries', () => {
      agentCore.registerAgent('memory-limit-agent');

      // Add 110 entries
      for (let i = 0; i < 110; i++) {
        agentCore.addMemory('memory-limit-agent', `Memory ${i}`);
      }

      const agent = agentCore.getAgent('memory-limit-agent');
      assert.strictEqual(agent.memory.length, 100);
    });
  });

  describe('Output Recording', () => {
    it('should record agent outputs', () => {
      agentCore.registerAgent('output-agent');

      const output = agentCore.recordOutput('output-agent', {
        content: 'Test output',
        type: 'response',
        toolCalls: [{ name: 'testTool' }]
      });

      assert.ok(output.id.startsWith('out-'));
      assert.strictEqual(output.content, 'Test output');
      assert.strictEqual(output.type, 'response');
      assert.strictEqual(output.toolCalls.length, 1);
    });
  });

  describe('Interaction Logging', () => {
    it('should log interactions between agents', () => {
      agentCore.registerAgent('from-agent');
      agentCore.registerAgent('to-agent');

      const interaction = agentCore.logInteraction('from-agent', 'to-agent', {
        type: 'message',
        content: 'Hello'
      });

      assert.ok(interaction.id.startsWith('int-'));
      assert.strictEqual(interaction.from, 'from-agent');
      assert.strictEqual(interaction.to, 'to-agent');

      const fromAgent = agentCore.getAgent('from-agent');
      const toAgent = agentCore.getAgent('to-agent');

      assert.ok(fromAgent.interactions.some(i => i.id === interaction.id));
      assert.ok(toAgent.interactions.some(i => i.id === interaction.id));
    });
  });

  describe('Workflow Management', () => {
    it('should start and complete workflows', () => {
      const workflow = agentCore.startWorkflow('test-workflow', 'Test goal');

      assert.strictEqual(workflow.active, true);
      assert.strictEqual(workflow.name, 'test-workflow');
      assert.strictEqual(workflow.goal, 'Test goal');

      const completed = agentCore.completeWorkflow('completed', { success: true });

      assert.strictEqual(completed.active, false);
      assert.strictEqual(completed.status, 'completed');
    });
  });

  describe('Event Subscriptions', () => {
    it('should subscribe to specific agent events', async () => {
      agentCore.registerAgent('subscriber');
      agentCore.registerAgent('publisher');

      const eventPromise = new Promise((resolve) => {
        const unsubscribe = agentCore.subscribeToAgents('subscriber', ['publisher'], (event) => {
          if (event.type === EventTypes.STATE_CHANGED && event.source === 'publisher') {
            unsubscribe();
            resolve(event);
          }
        });
      });

      agentCore.updateAgentState('publisher', { value: 'changed' });

      const event = await eventPromise;
      assert.strictEqual(event.source, 'publisher');
      assert.strictEqual(event.type, EventTypes.STATE_CHANGED);
    });
  });

  describe('Snapshotting', () => {
    it('should save and load state', () => {
      agentCore.registerAgent('snapshot-agent', {
        state: { data: 'important' }
      });

      const savedState = agentCore.snapshot();
      assert.ok(savedState.timestamp);
      assert.ok(savedState.agents['snapshot-agent']);

      // Reset and reload
      agentCore.reset();
      const loadedState = agentCore.loadSnapshot();

      assert.ok(loadedState);
      assert.strictEqual(agentCore.getAgentState('snapshot-agent').data, 'important');
    });

    it('should check if resume is possible', () => {
      // No state file initially
      agentCore.reset();

      // Before saving, can't resume
      const stateDir = agentCore.getStateDir();
      const statePath = agentCore.getStatePath();
      if (fs.existsSync(statePath)) {
        fs.unlinkSync(statePath);
      }

      assert.strictEqual(agentCore.canResume(), false);

      // After starting workflow and saving
      agentCore.registerAgent('resume-agent');
      agentCore.startWorkflow('resume-test', 'Test');
      agentCore.snapshot();

      assert.strictEqual(agentCore.canResume(), true);
    });
  });

  describe('Summary and Stats', () => {
    it('should provide accurate summary', () => {
      agentCore.registerAgent('summary-agent', { model: 'opus' });
      agentCore.addTask('summary-agent', { description: 'Task 1', status: 'pending' });
      agentCore.addTask('summary-agent', { description: 'Task 2', status: 'pending' });
      agentCore.setGoal('summary-agent', 'Test goal');

      const summary = agentCore.getSummary();

      assert.strictEqual(summary.agentCount, 1);
      assert.strictEqual(summary.agents[0].name, 'summary-agent');
      assert.strictEqual(summary.agents[0].taskCount, 2);
      assert.strictEqual(summary.agents[0].pendingTasks, 2);
      assert.strictEqual(summary.agents[0].goalCount, 1);
    });
  });
});

describe('Event Log', () => {
  beforeEach(() => {
    agentCore.reset();
  });

  it('should maintain event log', () => {
    agentCore.registerAgent('log-agent');
    agentCore.updateAgentState('log-agent', { value: 1 });
    agentCore.addTask('log-agent', 'Test task');

    const log = agentCore.getEventLog();

    assert.ok(log.length >= 3);
    assert.ok(log.some(e => e.type === EventTypes.AGENT_REGISTERED));
    assert.ok(log.some(e => e.type === EventTypes.STATE_CHANGED));
    assert.ok(log.some(e => e.type === EventTypes.TASK_ADDED));
  });

  it('should limit event log size', () => {
    agentCore.registerAgent('log-limit-agent');

    // Generate many events
    for (let i = 0; i < 600; i++) {
      agentCore.updateAgentState('log-limit-agent', { count: i });
    }

    const log = agentCore.getEventLog(1000);
    assert.ok(log.length <= 500);
  });
});
