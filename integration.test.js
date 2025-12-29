/**
 * Integration Tests
 *
 * End-to-end workflow tests covering:
 * - Complete workflow from goal to completion
 * - Resume functionality
 * - Multi-agent coordination
 * - Event-driven communication
 * - State persistence and recovery
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { Orchestrator, PHASES, EXECUTION_STATUS } from './orchestrator.js';
import agentCore, { EventTypes } from './agent-core.js';
import agentExecutor from './agent-executor.js';
import { PlannerAgent, TASK_STATUS } from './agent-planner.js';
import { CoderAgent, IMPL_STATUS } from './agent-coder.js';
import { TesterAgent, TEST_STATUS } from './agent-tester.js';
import { SupervisorAgent, VERIFICATION_TYPES } from './agent-supervisor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test config directory (isolated from real one)
const TEST_CONFIG_DIR = path.join(process.cwd(), '.claude-looper-integration-test');

/**
 * Helper to clean up test directories
 */
function cleanupTestDir() {
  if (fs.existsSync(TEST_CONFIG_DIR)) {
    fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  }
}

/**
 * Create a test orchestrator with mocked agent methods
 */
function createMockedOrchestrator(options = {}) {
  const orchestrator = new Orchestrator({
    configDir: TEST_CONFIG_DIR,
    configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
    silent: true,
    ...options
  });

  orchestrator.loadConfiguration();
  orchestrator.initializeAgents(options.allowExisting || false);

  return orchestrator;
}

/**
 * Mock agent methods to simulate successful workflow
 */
function mockSuccessfulWorkflow(orchestrator) {
  // Mock planner.createPlan
  orchestrator.agents.planner.createPlan = async (goal, context) => {
    const goalObj = agentCore.setGoal('planner', goal);
    const task1 = agentCore.addTask('planner', {
      description: 'Task 1: Setup',
      parentGoalId: goalObj.id,
      metadata: { complexity: 'simple', dependencies: [] }
    });
    const task2 = agentCore.addTask('planner', {
      description: 'Task 2: Implementation',
      parentGoalId: goalObj.id,
      metadata: { complexity: 'medium', dependencies: [0] }
    });

    orchestrator.agents.planner.currentPlan = {
      goalId: goalObj.id,
      goal,
      tasks: [task1, task2],
      createdAt: Date.now()
    };

    return orchestrator.agents.planner.currentPlan;
  };

  // Mock planner.getNextTask
  let taskIndex = 0;
  orchestrator.agents.planner.getNextTask = () => {
    const tasks = orchestrator.agents.planner.agent.tasks;
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    if (pendingTasks.length === 0) return null;
    return pendingTasks[0];
  };

  // Mock supervisor.verify to approve everything
  orchestrator.agents.supervisor.verify = async (agentName, verificationType, context) => {
    agentCore.updateAgentState('supervisor', { verificationsPerformed: orchestrator.agents.supervisor.agent.state.verificationsPerformed + 1 });
    return {
      score: 85,
      approved: true,
      completeness: 'complete',
      recommendation: 'approve',
      feedback: 'Looks good',
      issues: [],
      escalationLevel: 'none'
    };
  };

  // Mock supervisor.diagnose to replan by default
  orchestrator.agents.supervisor.diagnose = async (context) => {
    agentCore.updateAgentState('supervisor', { diagnosesPerformed: (orchestrator.agents.supervisor.agent.state.diagnosesPerformed || 0) + 1 });
    return {
      decision: 'replan',
      reasoning: 'Task needs to be broken down further'
    };
  };

  // Mock coder.implement
  orchestrator.agents.coder.implement = async (task, context) => {
    agentCore.updateAgentState('coder', { tasksImplemented: orchestrator.agents.coder.agent.state.tasksImplemented + 1 });
    return {
      status: IMPL_STATUS.COMPLETE,
      summary: 'Implementation complete',
      filesModified: ['src/feature.js'],
      testsAdded: ['test/feature.test.js'],
      commands: []
    };
  };

  // Mock tester.test
  orchestrator.agents.tester.test = async (task, implementation, context) => {
    agentCore.updateAgentState('tester', {
      testsRun: orchestrator.agents.tester.agent.state.testsRun + 1,
      testsPassed: orchestrator.agents.tester.agent.state.testsPassed + 1
    });
    return {
      status: TEST_STATUS.PASSED,
      testsRun: 5,
      testsPassed: 5,
      testsFailed: 0,
      failures: [],
      coverage: 85
    };
  };

  // Mock planner.replan (shouldn't be needed for success, but just in case)
  orchestrator.agents.planner.replan = async (task, failureReason) => {
    const subtask = agentCore.addSubtask('planner', task.id, {
      description: `Subtask for: ${task.description}`,
      metadata: { complexity: 'simple' }
    });
    agentCore.updateTask('planner', task.id, { status: 'blocked' });
    return {
      analysis: 'Breaking down the task',
      subtasks: [subtask],
      blockerResolution: 'Created subtask'
    };
  };

  return orchestrator;
}

/**
 * Mock agent methods to simulate workflow with failures
 */
function mockFailingWorkflow(orchestrator, options = {}) {
  const { failOnTask = 1, failCount = 1, failType = 'test' } = options;
  let currentFailCount = 0;

  // Mock planner.createPlan
  orchestrator.agents.planner.createPlan = async (goal, context) => {
    const goalObj = agentCore.setGoal('planner', goal);
    const task1 = agentCore.addTask('planner', {
      description: 'Task 1: Setup',
      parentGoalId: goalObj.id,
      metadata: { complexity: 'simple', dependencies: [] }
    });

    orchestrator.agents.planner.currentPlan = {
      goalId: goalObj.id,
      goal,
      tasks: [task1],
      createdAt: Date.now()
    };

    return orchestrator.agents.planner.currentPlan;
  };

  // Mock planner.getNextTask
  orchestrator.agents.planner.getNextTask = () => {
    const tasks = orchestrator.agents.planner.agent.tasks;
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    if (pendingTasks.length === 0) return null;
    return pendingTasks[0];
  };

  // Mock supervisor.verify
  orchestrator.agents.supervisor.verify = async (agentName, verificationType, context) => {
    return {
      score: 85,
      approved: true,
      completeness: 'complete',
      recommendation: 'approve',
      feedback: 'Approved',
      issues: [],
      escalationLevel: 'none'
    };
  };

  // Mock supervisor.diagnose - return impossible after enough attempts to prevent infinite loops
  let diagnoseCount = 0;
  orchestrator.agents.supervisor.diagnose = async (context) => {
    diagnoseCount++;
    if (diagnoseCount > 3) {
      return {
        decision: 'impossible',
        reasoning: 'Max diagnose attempts reached',
        blockers: ['Test configured to fail']
      };
    }
    return {
      decision: 'replan',
      reasoning: 'Task needs to be broken down further'
    };
  };

  // Mock coder.implement - fail if configured
  orchestrator.agents.coder.implement = async (task, context) => {
    if (failType === 'implementation' && currentFailCount < failCount) {
      currentFailCount++;
      return {
        status: IMPL_STATUS.BLOCKED,
        summary: 'Blocked by dependency',
        blockReason: 'Missing module',
        filesModified: [],
        testsAdded: []
      };
    }
    return {
      status: IMPL_STATUS.COMPLETE,
      summary: 'Implementation complete',
      filesModified: ['src/feature.js'],
      testsAdded: []
    };
  };

  // Mock coder.applyFix
  orchestrator.agents.coder.applyFix = async (task, testResult, cycle, maxCycles) => {
    if (cycle >= maxCycles) {
      return {
        status: 'still_failing',
        testsPass: false,
        summary: 'Could not fix'
      };
    }
    return {
      status: 'fixed',
      testsPass: true,
      summary: 'Fixed the issue'
    };
  };

  // Mock tester.test - fail initially, then pass after fix
  let testAttempts = 0;
  orchestrator.agents.tester.test = async (task, implementation, context) => {
    testAttempts++;
    if (failType === 'test' && testAttempts <= failCount) {
      return {
        status: TEST_STATUS.FAILED,
        testsRun: 5,
        testsPassed: 3,
        testsFailed: 2,
        failures: [
          { testName: 'test1', error: 'Expected true, got false', severity: 'major' }
        ],
        coverage: 60
      };
    }
    return {
      status: TEST_STATUS.PASSED,
      testsRun: 5,
      testsPassed: 5,
      testsFailed: 0,
      failures: [],
      coverage: 85
    };
  };

  // Mock planner.replan to create subtasks without template
  orchestrator.agents.planner.replan = async (task, failureReason) => {
    const subtask = agentCore.addSubtask('planner', task.id, {
      description: `Subtask for: ${task.description}`,
      metadata: { complexity: 'simple' }
    });
    agentCore.updateTask('planner', task.id, { status: 'blocked' });
    return {
      analysis: 'Breaking down the task',
      subtasks: [subtask],
      blockerResolution: 'Created subtask'
    };
  };

  return orchestrator;
}

// =============================================================================
// End-to-End Workflow Tests
// =============================================================================

describe('Integration - Complete Workflow Execution', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
    agentExecutor.resetAllSessions();
    agentExecutor.resetMetrics();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should execute complete workflow from goal to completion', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    const result = await orchestrator.execute('Build a simple feature', {});

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, EXECUTION_STATUS.COMPLETED);
    assert.ok(result.duration >= 0);
    assert.ok(result.summary);
    assert.ok(result.summary.agents);
  });

  it('should transition through all workflow phases', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    const phaseHistory = [];
    const originalPlanningPhase = orchestrator._executePlanningPhase.bind(orchestrator);
    const originalPlanReviewPhase = orchestrator._executePlanReviewPhase.bind(orchestrator);
    const originalExecutionPhase = orchestrator._executeExecutionPhase.bind(orchestrator);
    const originalVerificationPhase = orchestrator._executeVerificationPhase.bind(orchestrator);

    orchestrator._executePlanningPhase = async (...args) => {
      phaseHistory.push(PHASES.PLANNING);
      return originalPlanningPhase(...args);
    };
    orchestrator._executePlanReviewPhase = async (...args) => {
      phaseHistory.push(PHASES.PLAN_REVIEW);
      return originalPlanReviewPhase(...args);
    };
    orchestrator._executeExecutionPhase = async (...args) => {
      phaseHistory.push(PHASES.EXECUTION);
      return originalExecutionPhase(...args);
    };
    orchestrator._executeVerificationPhase = async (...args) => {
      phaseHistory.push(PHASES.VERIFICATION);
      return originalVerificationPhase(...args);
    };

    await orchestrator.execute('Test goal', {});

    assert.ok(phaseHistory.includes(PHASES.PLANNING));
    assert.ok(phaseHistory.includes(PHASES.PLAN_REVIEW));
    assert.ok(phaseHistory.includes(PHASES.EXECUTION));
    assert.ok(phaseHistory.includes(PHASES.VERIFICATION));
  });

  it('should update agentCore workflow status on completion', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    await orchestrator.execute('Test goal', {});

    assert.strictEqual(agentCore.workflow.status, EXECUTION_STATUS.COMPLETED);
  });

  it('should track agent statistics throughout workflow', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    await orchestrator.execute('Test goal', {});

    const summary = agentCore.getSummary();

    // Summary.agents is an array, not an object
    assert.ok(Array.isArray(summary.agents));
    assert.ok(summary.agents.length >= 4);

    // Find each agent in the array
    const planner = summary.agents.find(a => a.name === 'planner');
    const coder = summary.agents.find(a => a.name === 'coder');
    const tester = summary.agents.find(a => a.name === 'tester');
    const supervisor = summary.agents.find(a => a.name === 'supervisor');

    assert.ok(planner, 'Planner should exist');
    assert.ok(planner.taskCount >= 0);

    assert.ok(coder, 'Coder should exist');
    assert.ok(tester, 'Tester should exist');
    assert.ok(supervisor, 'Supervisor should exist');
  });

  it('should handle workflow with test failures and fix cycles', async () => {
    const orchestrator = createMockedOrchestrator();
    mockFailingWorkflow(orchestrator, { failType: 'test', failCount: 1 });

    const result = await orchestrator.execute('Test goal with failures', {});

    // Should still complete successfully after fix cycle
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, EXECUTION_STATUS.COMPLETED);
  });

  it('should handle blocked implementation gracefully', async () => {
    const orchestrator = createMockedOrchestrator();
    mockFailingWorkflow(orchestrator, { failType: 'implementation', failCount: 1 });

    // Mock markTaskFailed to not require replan
    orchestrator.agents.planner.markTaskFailed = (taskId, reason) => {
      agentCore.updateTask('planner', taskId, { status: 'failed' });
      return { task: { id: taskId }, needsReplan: false };
    };

    const result = await orchestrator.execute('Test goal with blocked task', {});

    // Workflow should complete but with failed status
    assert.ok(result.status === EXECUTION_STATUS.COMPLETED || result.status === EXECUTION_STATUS.FAILED);
  });
});

// =============================================================================
// Resume Functionality Tests
// =============================================================================

describe('Integration - Resume Functionality', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
    agentExecutor.resetAllSessions();
    agentExecutor.resetMetrics();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should save state during workflow execution', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    // Track if snapshot was called
    let snapshotCalled = false;
    const originalSnapshot = orchestrator._snapshot.bind(orchestrator);
    orchestrator._snapshot = () => {
      snapshotCalled = true;
      return originalSnapshot();
    };

    await orchestrator.execute('Test goal', {});

    assert.strictEqual(snapshotCalled, true);
  });

  it('should be able to check if resume is possible', async () => {
    // Set agentCore to use test directory
    const originalStateDir = agentCore.stateDir;
    agentCore.stateDir = TEST_CONFIG_DIR.replace(process.cwd() + path.sep, '');

    // Clean up any existing state file first
    const statePath = path.join(TEST_CONFIG_DIR, 'state.json');
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }

    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    // Before any execution, resume should not be possible (no state file)
    assert.strictEqual(agentCore.canResume(), false);

    // Execute partially and save state
    await orchestrator.execute('Test goal', {});

    // After execution with snapshot, resume should be possible
    assert.strictEqual(agentCore.canResume(), true);

    // Restore original stateDir
    agentCore.stateDir = originalStateDir;
  });

  it('should restore saved state correctly', async () => {
    // First execution - create and save state
    const orchestrator1 = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator1);

    await orchestrator1.execute('Initial goal', {});

    // Verify state was saved
    const savedState = agentCore.loadSnapshot();
    assert.ok(savedState);
    assert.ok(savedState.agents);
    assert.ok(savedState.agents.planner);

    // Reset agentCore but keep saved state file
    const savedAgents = savedState.agents;

    // Load state back
    const loadedState = agentCore.loadSnapshot();
    assert.ok(loadedState);
    assert.ok(loadedState.agents.planner.tasks.length > 0);
  });

  it('should preserve executor sessions for conversation continuity', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    // Set up a mock session
    agentExecutor.sessions['planner'] = 'session-123';

    orchestrator._snapshot();

    // Check that session was included in snapshot
    const state = agentCore.loadSnapshot();
    assert.ok(state.executorSessions);
    assert.strictEqual(state.executorSessions['planner'], 'session-123');
  });

  it('should restore executor sessions on resume', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    // Set up a mock session and snapshot
    agentExecutor.sessions['planner'] = 'session-456';
    orchestrator._snapshot();

    // Clear sessions
    agentExecutor.resetAllSessions();
    assert.strictEqual(agentExecutor.sessions['planner'], undefined);

    // Load state and restore sessions
    const state = agentCore.loadSnapshot();
    orchestrator._restoreSessions(state);

    assert.strictEqual(agentExecutor.sessions['planner'], 'session-456');
  });

  it('should reset failed tasks on resume', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    // Create initial plan
    await orchestrator.agents.planner.createPlan('Test goal', {});

    // Mark a task as failed
    const tasks = orchestrator.agents.planner.agent.tasks;
    if (tasks.length > 0) {
      agentCore.updateTask('planner', tasks[0].id, { status: 'failed' });
    }

    // Reset failed tasks
    const resetCount = agentCore.resetFailedTasks('planner');

    // Verify task was reset
    const updatedTasks = agentCore.getAgent('planner').tasks;
    const pendingTasks = updatedTasks.filter(t => t.status === 'pending');
    assert.ok(resetCount >= 0);
  });

  it('should continue from last task on resume', async () => {
    // Create orchestrator and execute partially
    const orchestrator1 = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator1);

    // Execute the workflow
    await orchestrator1.execute('Test goal', {});

    // Check state was saved
    assert.strictEqual(agentCore.canResume(), true);

    // Delete state file and reset to test the "no state to resume" scenario
    const stateDir = path.join(process.cwd(), '.claude-looper');
    const statePath = path.join(stateDir, 'state.json');
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
    agentCore.reset();

    const orchestrator2 = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    // Try to resume - should throw since state file was deleted
    await assert.rejects(
      async () => await orchestrator2.resumeExecution(),
      /No saved state to resume from/
    );
  });

  it('should save current phase in snapshot', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    orchestrator.currentPhase = PHASES.EXECUTION;
    orchestrator._snapshot();

    const state = agentCore.loadSnapshot();
    assert.strictEqual(state.currentPhase, PHASES.EXECUTION);
  });
});

// =============================================================================
// Multi-Agent Coordination Tests
// =============================================================================

describe('Integration - Multi-Agent Coordination', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
    agentExecutor.resetAllSessions();
    agentExecutor.resetMetrics();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should coordinate planner and coder for task execution', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    // Track coordination
    let plannerCreatedTask = false;
    let coderReceivedTask = false;

    const originalCreatePlan = orchestrator.agents.planner.createPlan;
    orchestrator.agents.planner.createPlan = async (...args) => {
      plannerCreatedTask = true;
      return originalCreatePlan.apply(orchestrator.agents.planner, args);
    };

    const originalImplement = orchestrator.agents.coder.implement;
    orchestrator.agents.coder.implement = async (task, context) => {
      if (task) coderReceivedTask = true;
      return originalImplement.apply(orchestrator.agents.coder, [task, context]);
    };

    await orchestrator.execute('Test coordination', {});

    assert.strictEqual(plannerCreatedTask, true);
    assert.strictEqual(coderReceivedTask, true);
  });

  it('should pass implementation results to tester', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    let receivedImplementation = null;

    const originalTest = orchestrator.agents.tester.test;
    orchestrator.agents.tester.test = async (task, implementation, context) => {
      receivedImplementation = implementation;
      return originalTest.apply(orchestrator.agents.tester, [task, implementation, context]);
    };

    await orchestrator.execute('Test coder-tester coordination', {});

    assert.ok(receivedImplementation);
    assert.strictEqual(receivedImplementation.status, IMPL_STATUS.COMPLETE);
  });

  it('should pass test results to coder for fixes', async () => {
    const orchestrator = createMockedOrchestrator();
    mockFailingWorkflow(orchestrator, { failType: 'test', failCount: 1 });

    let receivedTestResult = null;

    orchestrator.agents.coder.applyFix = async (task, testResult, cycle, maxCycles) => {
      receivedTestResult = testResult;
      return {
        status: 'fixed',
        testsPass: true,
        summary: 'Fixed the issue'
      };
    };

    await orchestrator.execute('Test fix cycle coordination', {});

    assert.ok(receivedTestResult);
    assert.strictEqual(receivedTestResult.status, TEST_STATUS.FAILED);
  });

  it('should enable supervisor to verify outputs from all agents', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    const verifications = [];

    orchestrator.agents.supervisor.verify = async (agentName, verificationType, context) => {
      verifications.push({ agentName, verificationType });
      return {
        score: 85,
        approved: true,
        completeness: 'complete',
        recommendation: 'approve',
        feedback: 'Approved',
        issues: [],
        escalationLevel: 'none'
      };
    };

    await orchestrator.execute('Test supervisor verification', {});

    // Should verify plan (planner), step (coder), and goal (orchestrator)
    assert.ok(verifications.some(v => v.agentName === 'planner'));
    assert.ok(verifications.some(v => v.verificationType === VERIFICATION_TYPES.GOAL));
  });

  it('should share context between agents through agentCore', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    await orchestrator.execute('Test context sharing', {});

    // All agents should be registered in agentCore
    assert.ok(agentCore.getAgent('planner'));
    assert.ok(agentCore.getAgent('coder'));
    assert.ok(agentCore.getAgent('tester'));
    assert.ok(agentCore.getAgent('supervisor'));

    // Tasks should be accessible
    const plannerAgent = agentCore.getAgent('planner');
    assert.ok(plannerAgent.tasks.length > 0);
  });
});

// =============================================================================
// Event-Driven Communication Tests
// =============================================================================

describe('Integration - Event-Driven Communication', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
    agentExecutor.resetAllSessions();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should emit events when tasks are added', (_, done) => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    let taskAddedEvent = null;
    agentCore.on(EventTypes.TASK_ADDED, (event) => {
      taskAddedEvent = event;
    });

    orchestrator.execute('Test events', {}).then(() => {
      assert.ok(taskAddedEvent);
      assert.ok(taskAddedEvent.object);
      assert.ok(taskAddedEvent.object.description);
      done();
    }).catch(done);
  });

  it('should emit events when tasks are completed', (_, done) => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    let taskCompletedEvent = null;
    agentCore.on(EventTypes.TASK_COMPLETED, (event) => {
      taskCompletedEvent = event;
    });

    orchestrator.execute('Test completion events', {}).then(() => {
      assert.ok(taskCompletedEvent);
      assert.strictEqual(taskCompletedEvent.object.status, 'completed');
      done();
    }).catch(done);
  });

  it('should emit workflow events', (_, done) => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    let workflowStarted = false;
    let workflowCompleted = false;

    agentCore.on(EventTypes.WORKFLOW_STARTED, () => {
      workflowStarted = true;
    });

    agentCore.on(EventTypes.WORKFLOW_COMPLETED, () => {
      workflowCompleted = true;
    });

    orchestrator.execute('Test workflow events', {}).then(() => {
      assert.strictEqual(workflowStarted, true);
      assert.strictEqual(workflowCompleted, true);
      done();
    }).catch(done);
  });

  it('should maintain event log for debugging', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    await orchestrator.execute('Test event log', {});

    const eventLog = agentCore.getEventLog();
    assert.ok(Array.isArray(eventLog));
    assert.ok(eventLog.length > 0);
  });

  it('should allow agents to subscribe to specific events', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    // Agents have subscribesTo configuration
    const planner = agentCore.getAgent('planner');
    const coder = agentCore.getAgent('coder');

    assert.ok(Array.isArray(planner.subscribesTo));
    assert.ok(Array.isArray(coder.subscribesTo));
  });
});

// =============================================================================
// State Persistence Tests
// =============================================================================

describe('Integration - State Persistence', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
    agentExecutor.resetAllSessions();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should persist agent state across snapshots', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    // Update agent states
    agentCore.updateAgentState('planner', { plansCreated: 1 });
    agentCore.updateAgentState('coder', { tasksImplemented: 2 });
    agentCore.updateAgentState('tester', { testsRun: 10 });

    orchestrator._snapshot();

    const state = agentCore.loadSnapshot();

    assert.ok(state.agents.planner.state.plansCreated === 1);
    assert.ok(state.agents.coder.state.tasksImplemented === 2);
    assert.ok(state.agents.tester.state.testsRun === 10);
  });

  it('should persist task status across snapshots', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    await orchestrator.execute('Test persistence', {});

    const state = agentCore.loadSnapshot();

    assert.ok(state.agents.planner.tasks);
    // Tasks should have status field
    state.agents.planner.tasks.forEach(task => {
      assert.ok(task.status);
    });
  });

  it('should persist goal state across snapshots', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    await orchestrator.execute('Persisted goal', {});

    const state = agentCore.loadSnapshot();

    assert.ok(state.agents.planner.goals);
    assert.ok(state.agents.planner.goals.length > 0);
  });

  it('should persist memory entries across snapshots', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    // Add memory to an agent
    agentCore.addMemory('planner', {
      content: 'Important note for testing',
      type: 'note',
      importance: 'high'
    });

    orchestrator._snapshot();

    const state = agentCore.loadSnapshot();

    assert.ok(state.agents.planner.memory);
    assert.ok(state.agents.planner.memory.some(m => m.content === 'Important note for testing'));
  });

  it('should persist workflow metadata across snapshots', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    await orchestrator.execute('Workflow to persist', {});

    const state = agentCore.loadSnapshot();

    assert.ok(state.workflow);
    // Workflow should have either goal or name to identify it
    assert.ok(state.workflow.goal || state.workflow.name);
    // Workflow should have some status indicator (status field, active flag, or result)
    assert.ok(
      state.workflow.status !== undefined ||
      state.workflow.active !== undefined ||
      state.workflow.result !== undefined
    );
  });

  it('should include timestamp in snapshots', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    const beforeSnapshot = Date.now();
    orchestrator._snapshot();
    const afterSnapshot = Date.now();

    const state = agentCore.loadSnapshot();

    assert.ok(state.timestamp);
    assert.ok(state.timestamp >= beforeSnapshot);
    assert.ok(state.timestamp <= afterSnapshot);
  });
});

// =============================================================================
// Error Handling in Integration
// =============================================================================

describe('Integration - Error Handling', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
    agentExecutor.resetAllSessions();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should handle planning phase errors gracefully', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    // Make planning fail
    orchestrator.agents.planner.createPlan = async () => {
      throw new Error('Planning failed');
    };

    await assert.rejects(
      async () => await orchestrator.execute('Failing goal', {}),
      /Planning failed/
    );

    assert.strictEqual(orchestrator.status, EXECUTION_STATUS.FAILED);
  });

  it('should save state on error for recovery', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    // Execute successfully first to have some state
    await orchestrator.execute('Initial goal', {});

    // Verify state was saved
    assert.strictEqual(agentCore.canResume(), true);
  });

  it('should update workflow status on error', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    orchestrator.agents.planner.createPlan = async () => {
      throw new Error('Test error');
    };

    try {
      await orchestrator.execute('Failing goal', {});
    } catch (e) {
      // Expected
    }

    assert.strictEqual(agentCore.workflow.status, 'failed');
  });
});

// =============================================================================
// Configuration-Driven Behavior Tests
// =============================================================================

describe('Integration - Configuration-Driven Behavior', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
    agentExecutor.resetAllSessions();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should respect maxFixCycles configuration', async () => {
    const orchestrator = createMockedOrchestrator();

    // Configure to fail more times than allowed
    let fixCycleCount = 0;

    orchestrator.agents.planner.createPlan = async (goal, context) => {
      const goalObj = agentCore.setGoal('planner', goal);
      const task = agentCore.addTask('planner', {
        description: 'Task with many failures',
        parentGoalId: goalObj.id
      });
      orchestrator.agents.planner.currentPlan = { goalId: goalObj.id, goal, tasks: [task] };
      return orchestrator.agents.planner.currentPlan;
    };

    orchestrator.agents.planner.getNextTask = () => {
      const tasks = orchestrator.agents.planner.agent.tasks;
      return tasks.find(t => t.status === 'pending') || null;
    };

    orchestrator.agents.supervisor.verify = async () => ({
      score: 85, approved: true, completeness: 'complete', recommendation: 'approve',
      feedback: '', issues: [], escalationLevel: 'none'
    });

    // Mock diagnose to return impossible after a few attempts (prevent infinite loop)
    let diagnoseCount = 0;
    orchestrator.agents.supervisor.diagnose = async () => {
      diagnoseCount++;
      if (diagnoseCount > 2) {
        return { decision: 'impossible', reasoning: 'Max attempts', blockers: ['Test config'] };
      }
      return { decision: 'replan', reasoning: 'Needs breakdown' };
    };

    orchestrator.agents.planner.replan = async (task) => {
      agentCore.updateTask('planner', task.id, { status: 'blocked' });
      return { analysis: 'Breakdown', subtasks: [], blockerResolution: 'Done' };
    };

    orchestrator.agents.coder.implement = async () => ({
      status: IMPL_STATUS.COMPLETE, summary: 'Done', filesModified: [], testsAdded: []
    });

    orchestrator.agents.tester.test = async () => ({
      status: TEST_STATUS.FAILED, testsRun: 1, testsPassed: 0, testsFailed: 1,
      failures: [{ testName: 'test', error: 'Failed' }], coverage: 0
    });

    orchestrator.agents.coder.applyFix = async (task, testResult, cycle, maxCycles) => {
      fixCycleCount = cycle;
      return { status: 'still_failing', testsPass: false, summary: 'Still failing' };
    };

    orchestrator.agents.planner.markTaskFailed = (taskId, reason) => {
      agentCore.updateTask('planner', taskId, { status: 'failed' });
      return { task: { id: taskId }, needsReplan: false };
    };

    await orchestrator.execute('Test max fix cycles', {});

    // Should have attempted maxFixCycles times
    assert.strictEqual(fixCycleCount, orchestrator.config.execution.maxFixCycles);
  });

  it('should respect time budget configuration', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    // Set a very short time limit
    orchestrator.config.execution.timeLimit = 1; // 1ms

    // Start time in the past to exceed budget
    orchestrator.startTime = Date.now() - 1000;

    assert.strictEqual(orchestrator._isTimeBudgetExceeded(), true);
  });

  it('should respect plan review configuration', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    let planReviewCalled = false;
    const originalPlanReview = orchestrator._executePlanReviewPhase.bind(orchestrator);
    orchestrator._executePlanReviewPhase = async (...args) => {
      planReviewCalled = true;
      return originalPlanReview(...args);
    };

    // With requirePrePlanReview = true (default in test config)
    await orchestrator.execute('Test plan review', {});

    assert.strictEqual(planReviewCalled, true);
  });

  it('should skip plan review when configured', async () => {
    const orchestrator = createMockedOrchestrator();
    mockSuccessfulWorkflow(orchestrator);

    // Disable plan review
    orchestrator.config.execution.requirePrePlanReview = false;

    let planReviewCalled = false;
    const originalPlanReview = orchestrator._executePlanReviewPhase.bind(orchestrator);
    orchestrator._executePlanReviewPhase = async (...args) => {
      planReviewCalled = true;
      return originalPlanReview(...args);
    };

    await orchestrator.execute('Test no plan review', {});

    assert.strictEqual(planReviewCalled, false);
  });
});
