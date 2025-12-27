/**
 * Planner Agent Tests
 *
 * Comprehensive test suite for the PlannerAgent class covering:
 * - Constructor and initialization
 * - Plan creation and parsing
 * - Task management (mark complete/failed)
 * - Re-planning logic
 * - Complexity calculation
 * - Plan status tracking
 * - State management
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import agentCore from './agent-core.js';
import { PlannerAgent, TASK_STATUS, COMPLEXITY_WEIGHTS, MAX_ATTEMPTS_BEFORE_REPLAN } from './agent-planner.js';

// Mock agent executor
const mockAgentExecutor = {
  executeWithTemplate: async () => ({
    structuredOutput: {
      toolCall: {
        name: 'planComplete',
        arguments: {
          tasks: [
            { description: 'Task 1', complexity: 'simple', dependencies: [], verificationCriteria: ['Test 1'] },
            { description: 'Task 2', complexity: 'medium', dependencies: [0], verificationCriteria: ['Test 2'] }
          ],
          totalEstimatedComplexity: 3,
          risks: ['Risk 1'],
          assumptions: ['Assumption 1']
        }
      }
    },
    response: 'Plan created'
  })
};

describe('PlannerAgent - Constants', () => {
  it('should export TASK_STATUS constants', () => {
    assert.strictEqual(TASK_STATUS.PENDING, 'pending');
    assert.strictEqual(TASK_STATUS.IN_PROGRESS, 'in_progress');
    assert.strictEqual(TASK_STATUS.COMPLETED, 'completed');
    assert.strictEqual(TASK_STATUS.FAILED, 'failed');
    assert.strictEqual(TASK_STATUS.BLOCKED, 'blocked');
  });

  it('should export COMPLEXITY_WEIGHTS constants', () => {
    assert.strictEqual(COMPLEXITY_WEIGHTS.simple, 1);
    assert.strictEqual(COMPLEXITY_WEIGHTS.medium, 2);
    assert.strictEqual(COMPLEXITY_WEIGHTS.complex, 3);
  });

  it('should export MAX_ATTEMPTS_BEFORE_REPLAN', () => {
    assert.strictEqual(MAX_ATTEMPTS_BEFORE_REPLAN, 3);
  });
});

describe('PlannerAgent - Constructor and Initialization', () => {
  beforeEach(() => {
    agentCore.reset();
  });

  it('should create instance with default options', () => {
    const planner = new PlannerAgent();

    assert.strictEqual(planner.name, 'planner');
    assert.strictEqual(planner.model, 'sonnet');
    assert.strictEqual(planner.fallbackModel, 'haiku');
    assert.strictEqual(planner.currentPlan, null);
  });

  it('should create instance with custom options', () => {
    const planner = new PlannerAgent({
      model: 'opus',
      fallbackModel: 'sonnet',
      allowExisting: true
    });

    assert.strictEqual(planner.model, 'opus');
    assert.strictEqual(planner.fallbackModel, 'sonnet');
  });

  it('should register agent with agent core', () => {
    const planner = new PlannerAgent();

    const agent = agentCore.getAgent('planner');
    assert.ok(agent);
    assert.strictEqual(agent.name, 'planner');
    assert.strictEqual(agent.model, 'sonnet');
  });

  it('should initialize agent state correctly', () => {
    const planner = new PlannerAgent();

    assert.strictEqual(planner.agent.state.plansCreated, 0);
    assert.strictEqual(planner.agent.state.replansPerformed, 0);
    assert.strictEqual(planner.agent.state.tasksTracked, 0);
    assert.strictEqual(planner.agent.state.successRate, 0);
  });

  it('should set up subscriptions to other agents', () => {
    const planner = new PlannerAgent({
      subscribesTo: ['supervisor', 'coder', 'tester']
    });

    assert.deepStrictEqual(planner.agent.subscribesTo, ['supervisor', 'coder', 'tester']);
  });

  it('should allow re-registration with allowExisting option', () => {
    new PlannerAgent();

    // Should not throw
    assert.doesNotThrow(() => {
      new PlannerAgent({ allowExisting: true });
    });
  });
});

describe('PlannerAgent - Plan Result Parsing', () => {
  let planner;

  beforeEach(() => {
    agentCore.reset();
    planner = new PlannerAgent();
  });

  it('should parse plan from structuredOutput.toolCall.arguments', () => {
    const result = {
      structuredOutput: {
        toolCall: {
          name: 'planComplete',
          arguments: {
            tasks: [{ description: 'Test task', complexity: 'simple' }],
            totalEstimatedComplexity: 1,
            risks: ['Risk 1'],
            assumptions: []
          }
        }
      }
    };

    const parsed = planner._parsePlanResult(result);

    assert.strictEqual(parsed.tasks.length, 1);
    assert.strictEqual(parsed.tasks[0].description, 'Test task');
    assert.strictEqual(parsed.totalEstimatedComplexity, 1);
  });

  it('should parse plan from toolCalls array', () => {
    const result = {
      toolCalls: [
        {
          name: 'planComplete',
          arguments: {
            tasks: [{ description: 'From toolCalls', complexity: 'medium' }]
          }
        }
      ]
    };

    const parsed = planner._parsePlanResult(result);

    assert.strictEqual(parsed.tasks[0].description, 'From toolCalls');
  });

  it('should fallback to text parsing when structured output unavailable', () => {
    const result = {
      response: '1. First task\n2. Second task | simple\n3. Third task | complex'
    };

    const parsed = planner._parsePlanResult(result);

    assert.ok(parsed.tasks.length >= 1);
  });
});

describe('PlannerAgent - Text Plan Parsing', () => {
  let planner;

  beforeEach(() => {
    agentCore.reset();
    planner = new PlannerAgent();
  });

  it('should parse numbered list from text', () => {
    const response = '1. Set up project\n2. Write tests\n3. Implement feature';

    const parsed = planner._parseTextPlan(response);

    assert.strictEqual(parsed.tasks.length, 3);
    assert.strictEqual(parsed.tasks[0].description, 'Set up project');
    assert.strictEqual(parsed.tasks[1].description, 'Write tests');
  });

  it('should extract complexity from text', () => {
    const response = '1. Simple task | simple\n2. Complex task | complex';

    const parsed = planner._parseTextPlan(response);

    assert.strictEqual(parsed.tasks[0].complexity, 'simple');
    assert.strictEqual(parsed.tasks[1].complexity, 'complex');
  });

  it('should default to medium complexity when not specified', () => {
    const response = '1. Task without complexity';

    const parsed = planner._parseTextPlan(response);

    assert.strictEqual(parsed.tasks[0].complexity, 'medium');
  });

  it('should return fallback task when no list found', () => {
    const response = 'No numbered list here';

    const parsed = planner._parseTextPlan(response);

    assert.strictEqual(parsed.tasks.length, 1);
    assert.strictEqual(parsed.tasks[0].description, 'Execute goal');
    assert.strictEqual(parsed.tasks[0].complexity, 'complex');
  });

  it('should limit tasks to 15', () => {
    let response = '';
    for (let i = 1; i <= 20; i++) {
      response += `${i}. Task ${i}\n`;
    }

    const parsed = planner._parseTextPlan(response);

    assert.strictEqual(parsed.tasks.length, 15);
  });
});

describe('PlannerAgent - Replan Result Parsing', () => {
  let planner;

  beforeEach(() => {
    agentCore.reset();
    planner = new PlannerAgent();
  });

  it('should parse replan from structuredOutput', () => {
    const result = {
      structuredOutput: {
        toolCall: {
          name: 'replanComplete',
          arguments: {
            analysis: 'Task failed due to missing dependencies',
            subtasks: [
              { description: 'Install dependencies', complexity: 'simple' }
            ],
            blockerResolution: 'Run npm install'
          }
        }
      }
    };

    const parsed = planner._parseReplanResult(result);

    assert.strictEqual(parsed.analysis, 'Task failed due to missing dependencies');
    assert.strictEqual(parsed.subtasks.length, 1);
    assert.strictEqual(parsed.blockerResolution, 'Run npm install');
  });

  it('should parse replan from toolCalls array', () => {
    const result = {
      toolCalls: [
        {
          name: 'replanComplete',
          arguments: {
            analysis: 'From toolCalls',
            subtasks: [],
            blockerResolution: 'None'
          }
        }
      ]
    };

    const parsed = planner._parseReplanResult(result);

    assert.strictEqual(parsed.analysis, 'From toolCalls');
  });

  it('should return default values when parsing fails', () => {
    const result = { response: 'Unparseable response' };

    const parsed = planner._parseReplanResult(result);

    assert.strictEqual(parsed.analysis, 'Unable to parse replan response');
    assert.deepStrictEqual(parsed.subtasks, []);
    assert.strictEqual(parsed.blockerResolution, 'Unknown');
  });
});

describe('PlannerAgent - Complexity Calculation', () => {
  let planner;

  beforeEach(() => {
    agentCore.reset();
    planner = new PlannerAgent();
  });

  it('should calculate complexity from tasks', () => {
    const tasks = [
      { complexity: 'simple' },   // 1
      { complexity: 'medium' },   // 2
      { complexity: 'complex' }   // 3
    ];

    const complexity = planner._calculateComplexity(tasks);

    assert.strictEqual(complexity, 6);
  });

  it('should default to medium weight for unknown complexity', () => {
    const tasks = [
      { complexity: 'unknown' }
    ];

    const complexity = planner._calculateComplexity(tasks);

    assert.strictEqual(complexity, 2);
  });

  it('should return 0 for null/undefined tasks', () => {
    assert.strictEqual(planner._calculateComplexity(null), 0);
    assert.strictEqual(planner._calculateComplexity(undefined), 0);
  });

  it('should return 0 for empty tasks array', () => {
    assert.strictEqual(planner._calculateComplexity([]), 0);
  });
});

describe('PlannerAgent - Task Status Methods', () => {
  let planner;

  beforeEach(() => {
    agentCore.reset();
    planner = new PlannerAgent();
  });

  it('should mark task as complete', () => {
    // Add a task first
    const task = agentCore.addTask('planner', {
      description: 'Test task',
      status: TASK_STATUS.IN_PROGRESS
    });

    const result = planner.markTaskComplete(task.id, { note: 'Done' });

    assert.strictEqual(result.status, TASK_STATUS.COMPLETED);
  });

  it('should mark task as failed without replan needed', () => {
    const task = agentCore.addTask('planner', {
      description: 'Test task',
      status: TASK_STATUS.IN_PROGRESS
    });

    const result = planner.markTaskFailed(task.id, 'Error occurred');

    assert.strictEqual(result.task.status, TASK_STATUS.FAILED);
    assert.strictEqual(result.needsReplan, false);
  });

  it('should indicate replan needed after max attempts', () => {
    const task = agentCore.addTask('planner', {
      description: 'Test task',
      status: TASK_STATUS.IN_PROGRESS
    });

    // Simulate multiple attempts by updating task directly
    const agent = agentCore.getAgent('planner');
    const taskToUpdate = agent.tasks.find(t => t.id === task.id);
    taskToUpdate.attempts = MAX_ATTEMPTS_BEFORE_REPLAN;

    const result = planner.markTaskFailed(task.id, 'Persistent error');

    assert.strictEqual(result.needsReplan, true);
  });
});

describe('PlannerAgent - Current and Next Task', () => {
  let planner;

  beforeEach(() => {
    agentCore.reset();
    planner = new PlannerAgent();
  });

  it('should return null for current task when no plan exists', () => {
    assert.strictEqual(planner.getCurrentTask(), null);
  });

  it('should return null for next task when no plan exists', () => {
    assert.strictEqual(planner.getNextTask(), null);
  });

  it('should get current in-progress task', () => {
    // Set up a mock plan
    const goal = agentCore.setGoal('planner', 'Test goal');
    const task = agentCore.addTask('planner', {
      description: 'Current task',
      parentGoalId: goal.id,
      status: TASK_STATUS.PENDING
    });

    // Update to in_progress
    agentCore.updateTask('planner', task.id, { status: TASK_STATUS.IN_PROGRESS });

    // Set current plan
    planner.currentPlan = { goalId: goal.id, tasks: [task] };

    const current = planner.getCurrentTask();

    assert.ok(current);
    assert.strictEqual(current.id, task.id);
  });

  it('should get next pending task in order', () => {
    const goal = agentCore.setGoal('planner', 'Test goal');

    const task1 = agentCore.addTask('planner', {
      description: 'First task',
      parentGoalId: goal.id,
      status: TASK_STATUS.PENDING
    });

    const task2 = agentCore.addTask('planner', {
      description: 'Second task',
      parentGoalId: goal.id,
      status: TASK_STATUS.PENDING
    });

    planner.currentPlan = { goalId: goal.id, tasks: [task1, task2] };

    const next = planner.getNextTask();

    // First pending task in order should be returned
    assert.ok(next);
    assert.strictEqual(next.id, task1.id);
  });
});

describe('PlannerAgent - Task Execution State', () => {
  let planner;

  beforeEach(() => {
    agentCore.reset();
    planner = new PlannerAgent();
  });

  it('should return execution state with current and next task IDs', () => {
    const goal = agentCore.setGoal('planner', 'Test goal');

    const task1 = agentCore.addTask('planner', {
      description: 'Current',
      parentGoalId: goal.id
    });
    // Tasks start as pending, need to update to in_progress
    agentCore.updateTask('planner', task1.id, { status: TASK_STATUS.IN_PROGRESS });

    const task2 = agentCore.addTask('planner', {
      description: 'Next',
      parentGoalId: goal.id
    });

    planner.currentPlan = { goalId: goal.id, tasks: [task1, task2] };

    const state = planner.getTaskExecutionState();

    assert.strictEqual(state.currentTaskId, task1.id);
    assert.strictEqual(state.nextTaskId, task2.id);
  });

  it('should return null IDs when no tasks available', () => {
    const state = planner.getTaskExecutionState();

    assert.strictEqual(state.currentTaskId, null);
    assert.strictEqual(state.nextTaskId, null);
  });
});

describe('PlannerAgent - Plan Status', () => {
  let planner;

  beforeEach(() => {
    agentCore.reset();
    planner = new PlannerAgent();
  });

  it('should return no active plan when currentPlan is null', () => {
    const status = planner.getPlanStatus();

    assert.strictEqual(status.hasActivePlan, false);
  });

  it('should return comprehensive plan status', () => {
    const goal = agentCore.setGoal('planner', 'Test goal');

    // Add tasks with various statuses
    agentCore.addTask('planner', { description: 'Pending 1', parentGoalId: goal.id, status: TASK_STATUS.PENDING });
    agentCore.addTask('planner', { description: 'Pending 2', parentGoalId: goal.id, status: TASK_STATUS.PENDING });
    const inProgressTask = agentCore.addTask('planner', { description: 'In Progress', parentGoalId: goal.id, status: TASK_STATUS.PENDING });
    agentCore.updateTask('planner', inProgressTask.id, { status: TASK_STATUS.IN_PROGRESS });

    const completedTask = agentCore.addTask('planner', { description: 'Completed', parentGoalId: goal.id, status: TASK_STATUS.PENDING });
    agentCore.updateTask('planner', completedTask.id, { status: TASK_STATUS.COMPLETED });

    planner.currentPlan = { goalId: goal.id, goal: 'Test goal', tasks: [] };

    const status = planner.getPlanStatus();

    assert.strictEqual(status.hasActivePlan, true);
    assert.strictEqual(status.goal, 'Test goal');
    assert.strictEqual(status.totalTasks, 4);
    assert.strictEqual(status.pending, 2);
    assert.strictEqual(status.inProgress, 1);
    assert.strictEqual(status.completed, 1);
    assert.strictEqual(status.failed, 0);
    assert.strictEqual(status.blocked, 0);
    assert.strictEqual(status.percentComplete, 25);
  });

  it('should handle zero tasks without division by zero', () => {
    const goal = agentCore.setGoal('planner', 'Empty goal');
    planner.currentPlan = { goalId: goal.id, goal: 'Empty goal', tasks: [] };

    const status = planner.getPlanStatus();

    assert.strictEqual(status.percentComplete, 0);
  });
});

describe('PlannerAgent - Success Rate Calculation', () => {
  let planner;

  beforeEach(() => {
    agentCore.reset();
    planner = new PlannerAgent();
  });

  it('should update success rate when tasks complete', () => {
    // Add and complete a task
    const task = agentCore.addTask('planner', { description: 'Task 1' });
    agentCore.updateTask('planner', task.id, { status: TASK_STATUS.COMPLETED });

    planner._updateSuccessRate();

    assert.strictEqual(planner.agent.state.successRate, 100);
  });

  it('should calculate mixed success rate', () => {
    // Add completed and failed tasks
    const task1 = agentCore.addTask('planner', { description: 'Success' });
    agentCore.updateTask('planner', task1.id, { status: TASK_STATUS.COMPLETED });

    const task2 = agentCore.addTask('planner', { description: 'Failed' });
    agentCore.updateTask('planner', task2.id, { status: TASK_STATUS.FAILED });

    planner._updateSuccessRate();

    assert.strictEqual(planner.agent.state.successRate, 50);
  });

  it('should not update when no completed or failed tasks', () => {
    agentCore.addTask('planner', { description: 'Pending only' });

    planner._updateSuccessRate();

    assert.strictEqual(planner.agent.state.successRate, 0);
  });
});

describe('PlannerAgent - Statistics', () => {
  let planner;

  beforeEach(() => {
    agentCore.reset();
    planner = new PlannerAgent();
  });

  it('should return agent statistics', () => {
    const stats = planner.getStats();

    assert.strictEqual(stats.name, 'planner');
    assert.strictEqual(stats.plansCreated, 0);
    assert.strictEqual(stats.replansPerformed, 0);
    assert.strictEqual(stats.tasksTracked, 0);
    assert.strictEqual(stats.successRate, 0);
    assert.ok(stats.currentPlan);
  });
});

describe('PlannerAgent - Task Update Handler', () => {
  let planner;

  beforeEach(() => {
    agentCore.reset();
    planner = new PlannerAgent();
  });

  it('should handle task update events', () => {
    const event = {
      type: 'task:completed',
      object: { id: 'task-123', description: 'Test task', status: 'completed' }
    };

    // Should not throw
    assert.doesNotThrow(() => {
      planner._handleTaskUpdate(event);
    });

    // Check memory was added
    const memories = planner.agent.memory;
    assert.ok(memories.some(m => m.content.includes('Task update')));
  });

  it('should handle task update with missing object gracefully', () => {
    const event = {
      type: 'task:completed',
      object: null
    };

    assert.doesNotThrow(() => {
      planner._handleTaskUpdate(event);
    });
  });
});
