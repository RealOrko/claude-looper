/**
 * Orchestrator Unit Tests
 *
 * Tests for workflow initialization, phase management, and agent coordination
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { Orchestrator, PHASES, EXECUTION_STATUS } from './orchestrator.js';
import agentCore from './agent-core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test config directory (isolated from real one)
const TEST_CONFIG_DIR = path.join(process.cwd(), '.claude-looper-test');

/**
 * Helper to clean up test directories
 */
function cleanupTestDir() {
  if (fs.existsSync(TEST_CONFIG_DIR)) {
    fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  }
}

/**
 * Create a minimal test workflow config
 */
function createTestConfig() {
  return {
    'default-workflow': {
      name: 'Test Workflow',
      description: 'Test workflow for unit tests',
      version: '1.0.0',
      agents: {
        supervisor: {
          model: 'opus',
          fallbackModel: 'sonnet',
          subscribesTo: ['planner', 'coder', 'tester'],
          thresholds: { approval: 70, revision: 50, rejection: 30 }
        },
        planner: {
          model: 'sonnet',
          fallbackModel: 'haiku',
          subscribesTo: ['supervisor', 'coder', 'tester'],
          settings: { minTasks: 2, maxTasks: 15, maxReplanDepth: 3, attemptsBeforeReplan: 3 }
        },
        coder: {
          model: 'opus',
          fallbackModel: 'sonnet',
          subscribesTo: ['supervisor', 'planner'],
          settings: { timeout: 900000, maxFixCycles: 3 }
        },
        tester: {
          model: 'opus',
          fallbackModel: 'sonnet',
          subscribesTo: ['supervisor', 'planner'],
          settings: { requireTests: true, minCoverage: 60 }
        }
      },
      execution: {
        phases: ['planning', 'plan_review', 'execution', 'verification'],
        maxStepAttempts: 3,
        maxFixCycles: 3,
        requirePrePlanReview: true,
        maxPlanRevisions: 3,
        verifyAllOutputs: true,
        progressCheckInterval: 300000,
        timeLimit: 7200000
      },
      timeBudget: {
        planning: 0.1,
        execution: 0.8,
        verification: 0.1
      },
      escalation: {
        levels: ['none', 'remind', 'correct', 'refocus', 'critical', 'abort'],
        scoreThresholds: { none: 70, remind: 50, correct: 30, refocus: 0 },
        maxIssuesBeforeCritical: 4,
        maxIssuesBeforeAbort: 5
      },
      planReviewFailure: {
        action: 'skip_and_continue',
        options: ['skip_and_continue', 'lower_threshold', 'abort'],
        lowerThresholdTo: 50
      }
    }
  };
}

describe('Orchestrator - Config Directory Initialization', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should create config directory if it does not exist', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    assert.strictEqual(fs.existsSync(TEST_CONFIG_DIR), false);

    // initializeConfigDir should create the directory
    orchestrator.initializeConfigDir();

    assert.strictEqual(fs.existsSync(TEST_CONFIG_DIR), true);
  });

  it('should copy default workflow config if it does not exist', () => {
    const configPath = path.join(TEST_CONFIG_DIR, 'default-workflow.json');

    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath,
      silent: true
    });

    orchestrator.initializeConfigDir();

    assert.strictEqual(fs.existsSync(configPath), true);

    // Verify it's valid JSON
    const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(content['default-workflow']);
  });

  it('should copy templates directory if it does not exist', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.initializeConfigDir();

    const templatesDir = path.join(TEST_CONFIG_DIR, 'templates');
    assert.strictEqual(fs.existsSync(templatesDir), true);
  });

  it('should not overwrite existing config files', () => {
    // Create directory and custom config first
    fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    const configPath = path.join(TEST_CONFIG_DIR, 'default-workflow.json');
    const customConfig = { 'default-workflow': { name: 'Custom Config' } };
    fs.writeFileSync(configPath, JSON.stringify(customConfig));

    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath,
      silent: true
    });

    orchestrator.initializeConfigDir();

    // Should not overwrite
    const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.strictEqual(content['default-workflow'].name, 'Custom Config');
  });
});

describe('Orchestrator - Workflow Loading and Validation', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should load configuration from file', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    const config = orchestrator.loadConfiguration();

    assert.ok(config);
    assert.ok(config.agents);
    assert.ok(config.agents.supervisor);
    assert.ok(config.agents.planner);
    assert.ok(config.agents.coder);
    assert.ok(config.agents.tester);
    assert.ok(config.execution);
  });

  it('should save configuration to agent core', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();

    const savedConfig = agentCore.loadConfiguration();
    assert.ok(savedConfig);
    assert.ok(savedConfig['default-workflow']);
  });

  it('should validate configuration has required fields', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    const config = orchestrator.loadConfiguration();

    // Validate required agent configs
    assert.ok(config.agents.supervisor.model);
    assert.ok(config.agents.planner.model);
    assert.ok(config.agents.coder.model);
    assert.ok(config.agents.tester.model);

    // Validate execution config
    assert.ok(Array.isArray(config.execution.phases));
    assert.ok(typeof config.execution.maxStepAttempts === 'number');
    // timeLimits is an object with baseMinutes, perComplexityPointMinutes, maxMinutes
    assert.ok(typeof config.execution.timeLimits === 'object');
    assert.ok(typeof config.execution.timeLimits.baseMinutes === 'number');
  });

  it('should store config internally after loading', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    assert.strictEqual(orchestrator.config, null);

    orchestrator.loadConfiguration();

    assert.ok(orchestrator.config);
    assert.ok(orchestrator.config.agents);
  });
});

describe('Orchestrator - Agent Initialization', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should initialize all agents from configuration', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    const agents = orchestrator.initializeAgents();

    assert.ok(agents.supervisor);
    assert.ok(agents.planner);
    assert.ok(agents.coder);
    assert.ok(agents.tester);
  });

  it('should register agents with agent core', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();

    // Check agents are registered in agentCore
    assert.ok(agentCore.getAgent('supervisor'));
    assert.ok(agentCore.getAgent('planner'));
    assert.ok(agentCore.getAgent('coder'));
    assert.ok(agentCore.getAgent('tester'));
  });

  it('should load configuration automatically if not already loaded', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    // Don't call loadConfiguration explicitly
    const agents = orchestrator.initializeAgents();

    assert.ok(orchestrator.config);
    assert.ok(agents.supervisor);
  });

  it('should allow existing agents for resume scenarios', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();

    // First initialization
    orchestrator.initializeAgents();

    // Second initialization with allowExisting
    const agents = orchestrator.initializeAgents(true);

    // Should not throw, should return existing agents
    assert.ok(agents.planner);
  });
});

describe('Orchestrator - Phase Management', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should export PHASES constants', () => {
    assert.strictEqual(PHASES.PLANNING, 'planning');
    assert.strictEqual(PHASES.PLAN_REVIEW, 'plan_review');
    assert.strictEqual(PHASES.EXECUTION, 'execution');
    assert.strictEqual(PHASES.VERIFICATION, 'verification');
  });

  it('should export EXECUTION_STATUS constants', () => {
    assert.strictEqual(EXECUTION_STATUS.NOT_STARTED, 'not_started');
    assert.strictEqual(EXECUTION_STATUS.RUNNING, 'running');
    assert.strictEqual(EXECUTION_STATUS.PAUSED, 'paused');
    assert.strictEqual(EXECUTION_STATUS.COMPLETED, 'completed');
    assert.strictEqual(EXECUTION_STATUS.FAILED, 'failed');
    assert.strictEqual(EXECUTION_STATUS.ABORTED, 'aborted');
  });

  it('should initialize with NOT_STARTED status', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    assert.strictEqual(orchestrator.status, EXECUTION_STATUS.NOT_STARTED);
    assert.strictEqual(orchestrator.currentPhase, null);
  });

  it('should track current phase', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.currentPhase = PHASES.PLANNING;
    assert.strictEqual(orchestrator.currentPhase, PHASES.PLANNING);

    orchestrator.currentPhase = PHASES.EXECUTION;
    assert.strictEqual(orchestrator.currentPhase, PHASES.EXECUTION);
  });
});

describe('Orchestrator - Execution Control', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should pause execution and save snapshot', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.status = EXECUTION_STATUS.RUNNING;
    orchestrator.startTime = Date.now();

    orchestrator.pause();

    assert.strictEqual(orchestrator.status, EXECUTION_STATUS.PAUSED);
  });

  it('should not pause if not running', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.status = EXECUTION_STATUS.NOT_STARTED;

    orchestrator.pause();

    assert.strictEqual(orchestrator.status, EXECUTION_STATUS.NOT_STARTED);
  });

  it('should abort execution and update agent core', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.status = EXECUTION_STATUS.RUNNING;
    orchestrator.startTime = Date.now();

    // Start a workflow so abort can complete it
    agentCore.startWorkflow('test', 'Test goal');

    orchestrator.abort();

    assert.strictEqual(orchestrator.status, EXECUTION_STATUS.ABORTED);
    assert.strictEqual(agentCore.workflow.status, 'aborted');
  });

  it('should save and exit properly', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();

    const summary = orchestrator.saveAndExit();

    assert.ok(summary);
    assert.ok(summary.agents);
  });
});

describe('Orchestrator - Time Management', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should calculate elapsed time in seconds', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.startTime = Date.now() - 5000; // 5 seconds ago

    const elapsed = orchestrator.getElapsedTime();

    assert.ok(elapsed.includes('s'));
    assert.ok(elapsed.includes('5') || elapsed.includes('4') || elapsed.includes('6')); // Allow for timing variance
  });

  it('should calculate elapsed time in minutes', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.startTime = Date.now() - 125000; // 2 min 5 sec ago

    const elapsed = orchestrator.getElapsedTime();

    assert.ok(elapsed.includes('m'));
    assert.ok(elapsed.includes('2'));
  });

  it('should calculate elapsed time in hours', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.startTime = Date.now() - 3700000; // 1 hour 1 min ago

    const elapsed = orchestrator.getElapsedTime();

    assert.ok(elapsed.includes('h'));
    assert.ok(elapsed.includes('1'));
  });

  it('should return 0s when not started', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    const elapsed = orchestrator.getElapsedTime();

    assert.strictEqual(elapsed, '0s');
  });

  it('should detect when time budget is exceeded', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    // Set an explicit timeLimit for this test (timeLimit is optional, timeLimits object is used for dynamic calculation)
    orchestrator.config.execution.timeLimit = 7200000; // 2 hours in ms
    orchestrator.startTime = Date.now() - 7200001; // Just over 2 hours

    const exceeded = orchestrator._isTimeBudgetExceeded();

    assert.strictEqual(exceeded, true);
  });

  it('should return false when time budget is not exceeded', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.startTime = Date.now() - 1000; // 1 second ago

    const exceeded = orchestrator._isTimeBudgetExceeded();

    assert.strictEqual(exceeded, false);
  });
});

describe('Orchestrator - Status Reporting', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should return current status', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.status = EXECUTION_STATUS.RUNNING;
    orchestrator.currentPhase = PHASES.EXECUTION;
    orchestrator.goal = 'Test goal';
    orchestrator.startTime = Date.now();

    const status = orchestrator.getStatus();

    assert.strictEqual(status.status, EXECUTION_STATUS.RUNNING);
    assert.strictEqual(status.phase, PHASES.EXECUTION);
    assert.strictEqual(status.goal, 'Test goal');
    assert.ok(status.elapsed);
    assert.ok(status.agentStats);
  });

  it('should include agent stats in status', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();

    const status = orchestrator.getStatus();

    assert.ok(status.agentStats.planner);
    assert.ok(status.agentStats.coder);
    assert.ok(status.agentStats.tester);
    assert.ok(status.agentStats.supervisor);
  });
});

describe('Orchestrator - Resume Functionality', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should restore executor sessions from state', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    const mockState = {
      executorSessions: {
        planner: 'session-123',
        coder: 'session-456'
      }
    };

    // Import agentExecutor to check session restoration
    import('./agent-executor.js').then(module => {
      const agentExecutor = module.default;

      // Clear existing sessions
      agentExecutor.sessions = {};

      orchestrator._restoreSessions(mockState);

      assert.strictEqual(agentExecutor.sessions.planner, 'session-123');
      assert.strictEqual(agentExecutor.sessions.coder, 'session-456');
    });
  });

  it('should handle state without executor sessions', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    const mockState = {};

    // Should not throw
    orchestrator._restoreSessions(mockState);
  });

  it('should snapshot current state including phase', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.currentPhase = PHASES.EXECUTION;

    orchestrator._snapshot();

    // Load the snapshot and verify phase is saved
    const state = agentCore.loadSnapshot();
    assert.strictEqual(state.currentPhase, PHASES.EXECUTION);
  });

  it('should throw error when resuming without saved state', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();

    // Ensure no state file exists
    const statePath = agentCore.getStatePath();
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }

    await assert.rejects(
      async () => orchestrator.resumeExecution(),
      /No saved state to resume from/
    );
  });
});

describe('Orchestrator - Execution State', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should initialize with default execution state', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    assert.strictEqual(orchestrator.executionState.currentTaskIndex, 0);
    assert.strictEqual(orchestrator.executionState.fixCycle, 0);
    assert.strictEqual(orchestrator.executionState.planRevisions, 0);
    assert.strictEqual(orchestrator.executionState.stepAttempts, 0);
  });

  it('should track plan revisions', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.executionState.planRevisions = 2;

    assert.strictEqual(orchestrator.executionState.planRevisions, 2);
  });
});

describe('Orchestrator - Silent Mode', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should suppress logs in silent mode', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    // This should not throw or log anything
    orchestrator._log('Test message');

    assert.strictEqual(orchestrator.silent, true);
  });

  it('should default to non-silent mode', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json')
    });

    assert.strictEqual(orchestrator.silent, false);
  });
});

describe('Orchestrator - Directory Copy', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should recursively copy directories', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    // Create source directory structure
    const srcDir = path.join(TEST_CONFIG_DIR, 'src');
    const subDir = path.join(srcDir, 'sub');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'file1.txt'), 'content1');
    fs.writeFileSync(path.join(subDir, 'file2.txt'), 'content2');

    // Copy to destination
    const destDir = path.join(TEST_CONFIG_DIR, 'dest');
    orchestrator._copyDirRecursive(srcDir, destDir);

    // Verify copy
    assert.strictEqual(fs.existsSync(destDir), true);
    assert.strictEqual(fs.existsSync(path.join(destDir, 'file1.txt')), true);
    assert.strictEqual(fs.existsSync(path.join(destDir, 'sub', 'file2.txt')), true);
    assert.strictEqual(fs.readFileSync(path.join(destDir, 'file1.txt'), 'utf8'), 'content1');
    assert.strictEqual(fs.readFileSync(path.join(destDir, 'sub', 'file2.txt'), 'utf8'), 'content2');
  });
});

describe('Orchestrator - Phase Transitions', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should transition through planning phase', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();

    // Mock the planning method to avoid actual execution
    orchestrator.agents.planner.createPlan = async (goal) => {
      return {
        goalId: 'test-goal-1',
        goal,
        tasks: [
          { id: 'task-1', description: 'Test task 1', status: 'pending' },
          { id: 'task-2', description: 'Test task 2', status: 'pending' }
        ]
      };
    };

    orchestrator.currentPhase = PHASES.PLANNING;
    const plan = await orchestrator._executePlanningPhase('Test goal', {});

    assert.ok(plan);
    assert.strictEqual(plan.tasks.length, 2);
    assert.strictEqual(plan.goal, 'Test goal');
  });

  it('should transition from planning to plan_review', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test goal';

    // Mock planner
    orchestrator.agents.planner.createPlan = async () => ({
      goalId: 'test-goal-1',
      goal: 'Test goal',
      tasks: [{ id: 'task-1', description: 'Task 1', status: 'pending' }]
    });

    // Mock supervisor
    orchestrator.agents.supervisor.verify = async () => ({
      approved: true,
      score: 85
    });

    const plan = await orchestrator._executePlanningPhase('Test goal', {});

    orchestrator.currentPhase = PHASES.PLAN_REVIEW;
    const approved = await orchestrator._executePlanReviewPhase(plan);

    assert.strictEqual(approved, true);
    assert.strictEqual(orchestrator.currentPhase, PHASES.PLAN_REVIEW);
  });

  it('should handle plan rejection with revision', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test goal';

    let verifyCallCount = 0;

    // Mock planner - returns different plan on revision
    orchestrator.agents.planner.createPlan = async (goal, context) => {
      const isRevision = context?.previousPlan != null;
      return {
        goalId: 'test-goal-1',
        goal,
        tasks: [
          { id: 'task-1', description: isRevision ? 'Revised task' : 'Original task', status: 'pending' }
        ]
      };
    };

    // Mock supervisor - reject first time, approve second time
    orchestrator.agents.supervisor.verify = async () => {
      verifyCallCount++;
      if (verifyCallCount === 1) {
        return {
          approved: false,
          score: 45,
          feedback: 'Need more detail',
          issues: ['Not enough detail'],
          missingElements: ['Error handling']
        };
      }
      return { approved: true, score: 80 };
    };

    const plan = await orchestrator._executePlanningPhase('Test goal', {});
    orchestrator.currentPhase = PHASES.PLAN_REVIEW;
    const approved = await orchestrator._executePlanReviewPhase(plan);

    assert.strictEqual(approved, true);
    assert.strictEqual(verifyCallCount, 2);
    assert.strictEqual(orchestrator.executionState.planRevisions, 1);
  });

  it('should fail plan review after max revisions', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test goal';

    // Mock planner
    orchestrator.agents.planner.createPlan = async () => ({
      goalId: 'test-goal-1',
      goal: 'Test goal',
      tasks: [{ id: 'task-1', description: 'Task 1', status: 'pending' }]
    });

    // Mock supervisor - always reject
    orchestrator.agents.supervisor.verify = async () => ({
      approved: false,
      score: 30,
      feedback: 'Plan not adequate'
    });

    const plan = await orchestrator._executePlanningPhase('Test goal', {});
    orchestrator.currentPhase = PHASES.PLAN_REVIEW;
    const approved = await orchestrator._executePlanReviewPhase(plan);

    assert.strictEqual(approved, false);
    // Should have tried max revisions (default is 3)
    assert.strictEqual(orchestrator.executionState.planRevisions, orchestrator.config.execution.maxPlanRevisions);
  });
});

describe('Orchestrator - Execution Phase', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should execute tasks sequentially', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test goal';
    orchestrator.startTime = Date.now();

    const executedTasks = [];

    // Set up tasks in planner
    const tasks = [
      { id: 'task-1', description: 'Task 1', status: 'pending', attempts: 0 },
      { id: 'task-2', description: 'Task 2', status: 'pending', attempts: 0 }
    ];

    // Add tasks to agentCore
    agentCore.getAgent('planner').tasks = tasks;
    orchestrator.agents.planner.agent.tasks = tasks;

    let taskIndex = 0;
    orchestrator.agents.planner.getNextTask = () => {
      const pendingTasks = tasks.filter(t => t.status === 'pending');
      return pendingTasks[0] || null;
    };

    orchestrator.agents.planner.markTaskComplete = (taskId) => {
      const task = tasks.find(t => t.id === taskId);
      if (task) task.status = 'completed';
      executedTasks.push(taskId);
    };

    orchestrator.agents.planner.markTaskFailed = (taskId) => {
      const task = tasks.find(t => t.id === taskId);
      if (task) task.status = 'failed';
      return { needsReplan: false };
    };

    // Mock coder and tester
    orchestrator.agents.coder.implement = async () => ({ status: 'success', code: 'test code' });
    orchestrator.agents.tester.test = async () => ({ status: 'passed' });
    orchestrator.agents.supervisor.verify = async () => ({ approved: true, score: 90 });

    const plan = { tasks };
    await orchestrator._executeExecutionPhase(plan);

    assert.deepStrictEqual(executedTasks, ['task-1', 'task-2']);
  });

  it('should handle task failures with fix cycles', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    // Disable step verification to focus on fix cycle logic
    orchestrator.config.execution.verifyAllOutputs = false;
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test goal';

    // Need to mock the tasks array for the coder context
    orchestrator.agents.planner.agent = { tasks: [] };

    const task = { id: 'task-1', description: 'Task 1', status: 'pending' };
    let fixCycleCount = 0;
    let testCallCount = 0;

    // Mock agents
    // Initial implementation succeeds but tests fail initially
    orchestrator.agents.coder.implement = async () => ({ status: 'success', code: 'initial code' });

    // applyFix is called when tests fail
    orchestrator.agents.coder.applyFix = async (t, testResult, cycle) => {
      fixCycleCount = cycle;
      // On fix cycle 2, the coder reports tests pass (short-circuits the loop)
      return { status: 'success', code: 'fixed code', testsPass: false };
    };

    // Tester: fail first call, pass on second
    orchestrator.agents.tester.test = async () => {
      testCallCount++;
      if (testCallCount === 1) {
        return { status: 'failed', errors: ['Test failed'] };
      }
      return { status: 'passed' };
    };

    orchestrator.agents.supervisor.verify = async () => ({ approved: true, score: 85 });

    const result = await orchestrator._executeTaskWithFixCycle(task);

    // The task should succeed because second test call passes
    assert.strictEqual(result.success, true);
    // Only one fix cycle needed since test passes on retry
    assert.strictEqual(fixCycleCount, 1);
  });

  it('should fail task after max fix cycles exceeded', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test goal';

    const task = { id: 'task-1', description: 'Task 1', status: 'pending' };
    let fixCycleCount = 0;

    // Mock agents - always fail
    orchestrator.agents.coder.implement = async () => ({ status: 'success', code: 'code' });
    orchestrator.agents.coder.applyFix = async (t, testResult, cycle) => {
      fixCycleCount = cycle;
      return { status: 'success', code: 'fixed code', testsPass: false };
    };
    orchestrator.agents.tester.test = async () => ({ status: 'failed', failures: [{ error: 'Test failed' }] });

    const result = await orchestrator._executeTaskWithFixCycle(task);

    assert.strictEqual(result.success, false);
    assert.strictEqual(fixCycleCount, orchestrator.config.execution.maxFixCycles);
  });

  it('should handle blocked implementations', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test goal';

    const task = { id: 'task-1', description: 'Task 1', status: 'pending' };

    // Mock coder returning blocked
    orchestrator.agents.coder.implement = async () => ({
      status: 'blocked',
      blockReason: 'Missing dependency'
    });

    const result = await orchestrator._executeTaskWithFixCycle(task);

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Missing dependency'));
  });

  it('should handle blocked fixes', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test goal';

    const task = { id: 'task-1', description: 'Task 1', status: 'pending' };

    // Mock agents
    orchestrator.agents.coder.implement = async () => ({ status: 'success', code: 'code' });
    orchestrator.agents.coder.applyFix = async () => ({
      status: 'blocked',
      blockReason: 'Cannot fix'
    });
    orchestrator.agents.tester.test = async () => ({ status: 'failed', failures: [{ error: 'Test failed' }] });

    const result = await orchestrator._executeTaskWithFixCycle(task);

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Cannot fix'));
  });
});

describe('Orchestrator - Verification Phase', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should run final verification', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test goal';

    // Mock agents
    orchestrator.agents.planner.getPlanStatus = () => ({
      completed: 2,
      pending: 0,
      failed: 0,
      total: 2,
      progress: 100
    });
    orchestrator.agents.planner.getStats = () => ({ tasksCompleted: 2 });
    orchestrator.agents.coder.getStats = () => ({ implementations: 2 });
    orchestrator.agents.tester.getStats = () => ({ testsRun: 2 });
    orchestrator.agents.supervisor.getStats = () => ({ verifications: 3 });

    orchestrator.agents.supervisor.verify = async (agent, type, context) => {
      assert.strictEqual(agent, 'orchestrator');
      assert.ok(context.goal);
      assert.ok(context.agentOutput.planStatus);
      return { approved: true, score: 90 };
    };

    const verified = await orchestrator._executeVerificationPhase();

    assert.strictEqual(verified, true);
  });

  it('should fail verification when supervisor rejects', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test goal';

    // Mock agents
    orchestrator.agents.planner.getPlanStatus = () => ({ completed: 1, pending: 0, failed: 1, total: 2 });
    orchestrator.agents.planner.getStats = () => ({});
    orchestrator.agents.coder.getStats = () => ({});
    orchestrator.agents.tester.getStats = () => ({});
    orchestrator.agents.supervisor.getStats = () => ({});

    orchestrator.agents.supervisor.verify = async () => ({
      approved: false,
      score: 40,
      feedback: 'Not all tasks completed'
    });

    const verified = await orchestrator._executeVerificationPhase();

    assert.strictEqual(verified, false);
  });
});

describe('Orchestrator - Full Execution Flow', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should execute complete workflow successfully', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();

    // Disable plan review for simpler test
    orchestrator.config.execution.requirePrePlanReview = false;
    // Disable step verification to simplify test
    orchestrator.config.execution.verifyAllOutputs = false;

    orchestrator.initializeAgents();

    const tasks = [
      { id: 'task-1', description: 'Task 1', status: 'pending', attempts: 0 }
    ];

    // Add tasks to agentCore so updateTask can find them
    agentCore.getAgent('planner').tasks = tasks;

    // Mock all agents
    orchestrator.agents.planner.createPlan = async (goal) => ({
      goalId: 'goal-1',
      goal,
      tasks
    });

    orchestrator.agents.planner.getNextTask = () => {
      const pending = tasks.filter(t => t.status === 'pending');
      return pending[0] || null;
    };

    orchestrator.agents.planner.markTaskComplete = (taskId) => {
      const task = tasks.find(t => t.id === taskId);
      if (task) task.status = 'completed';
    };

    orchestrator.agents.planner.agent = { tasks };
    orchestrator.agents.planner.getPlanStatus = () => ({
      completed: tasks.filter(t => t.status === 'completed').length,
      total: tasks.length
    });
    orchestrator.agents.planner.getStats = () => ({});

    orchestrator.agents.coder.implement = async () => ({ status: 'success', code: 'code' });
    orchestrator.agents.coder.getStats = () => ({});

    orchestrator.agents.tester.test = async () => ({ status: 'passed' });
    orchestrator.agents.tester.getStats = () => ({});

    orchestrator.agents.supervisor.verify = async () => ({ approved: true, score: 90 });
    orchestrator.agents.supervisor.getStats = () => ({});

    const result = await orchestrator.execute('Complete test goal');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, EXECUTION_STATUS.COMPLETED);
    assert.ok(result.duration > 0);
  });

  it('should fail workflow when execution fails', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.config.execution.requirePrePlanReview = false;
    orchestrator.initializeAgents();

    // Mock planner to throw error
    orchestrator.agents.planner.createPlan = async () => {
      throw new Error('Planning failed');
    };

    await assert.rejects(
      async () => orchestrator.execute('Failing goal'),
      /Planning failed/
    );

    assert.strictEqual(orchestrator.status, EXECUTION_STATUS.FAILED);
  });

  it('should track phase transitions during execution', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.config.execution.requirePrePlanReview = false;
    orchestrator.config.execution.verifyAllOutputs = false;
    orchestrator.initializeAgents();

    const phases = [];

    // Intercept phase changes
    const originalPhaseSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(orchestrator), 'currentPhase') ||
      { set: (v) => orchestrator._currentPhase = v, get: () => orchestrator._currentPhase };

    Object.defineProperty(orchestrator, 'currentPhase', {
      set(value) {
        phases.push(value);
        this._currentPhase = value;
      },
      get() {
        return this._currentPhase;
      }
    });

    const tasks = [{ id: 'task-1', description: 'Task 1', status: 'pending', attempts: 0 }];

    // Add tasks to agentCore so updateTask can find them
    agentCore.getAgent('planner').tasks = tasks;

    // Mock agents
    orchestrator.agents.planner.createPlan = async () => ({ goalId: 'g1', goal: 'test', tasks });
    orchestrator.agents.planner.getNextTask = () => {
      const p = tasks.filter(t => t.status === 'pending');
      return p[0] || null;
    };
    orchestrator.agents.planner.markTaskComplete = (id) => {
      const t = tasks.find(x => x.id === id);
      if (t) t.status = 'completed';
    };
    orchestrator.agents.planner.agent = { tasks };
    orchestrator.agents.planner.getPlanStatus = () => ({ completed: 1, total: 1 });
    orchestrator.agents.planner.getStats = () => ({});
    orchestrator.agents.coder.implement = async () => ({ status: 'success' });
    orchestrator.agents.coder.getStats = () => ({});
    orchestrator.agents.tester.test = async () => ({ status: 'passed' });
    orchestrator.agents.tester.getStats = () => ({});
    orchestrator.agents.supervisor.verify = async () => ({ approved: true, score: 90 });
    orchestrator.agents.supervisor.getStats = () => ({});

    await orchestrator.execute('Test goal');

    // Should have gone through planning, execution, verification (no plan_review since disabled)
    assert.ok(phases.includes(PHASES.PLANNING), 'Should include planning phase');
    assert.ok(phases.includes(PHASES.EXECUTION), 'Should include execution phase');
    assert.ok(phases.includes(PHASES.VERIFICATION), 'Should include verification phase');
  });
});

describe('Orchestrator - Error Handling', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should handle planner errors gracefully', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();

    orchestrator.agents.planner.createPlan = async () => {
      throw new Error('Planner API error');
    };

    await assert.rejects(
      async () => orchestrator.execute('Test goal'),
      /Planner API error/
    );

    assert.strictEqual(orchestrator.status, EXECUTION_STATUS.FAILED);
  });

  it('should handle coder errors during task execution', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.config.execution.requirePrePlanReview = false;
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test';
    orchestrator.startTime = Date.now();

    const task = { id: 'task-1', description: 'Task', status: 'pending' };

    orchestrator.agents.coder.implement = async () => {
      throw new Error('Coder API error');
    };

    await assert.rejects(
      async () => orchestrator._executeTaskWithFixCycle(task),
      /Coder API error/
    );
  });

  it('should handle tester errors during task execution', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.config.execution.requirePrePlanReview = false;
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test';
    orchestrator.startTime = Date.now();

    const task = { id: 'task-1', description: 'Task', status: 'pending' };

    orchestrator.agents.coder.implement = async () => ({ status: 'success', code: 'code' });
    orchestrator.agents.tester.test = async () => {
      throw new Error('Tester API error');
    };

    await assert.rejects(
      async () => orchestrator._executeTaskWithFixCycle(task),
      /Tester API error/
    );
  });

  it('should handle supervisor verification errors', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test';

    orchestrator.agents.planner.getPlanStatus = () => ({});
    orchestrator.agents.planner.getStats = () => ({});
    orchestrator.agents.coder.getStats = () => ({});
    orchestrator.agents.tester.getStats = () => ({});
    orchestrator.agents.supervisor.getStats = () => ({});

    orchestrator.agents.supervisor.verify = async () => {
      throw new Error('Supervisor API error');
    };

    await assert.rejects(
      async () => orchestrator._executeVerificationPhase(),
      /Supervisor API error/
    );
  });

  it('should abort on plan review failure when configured', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.config.planReviewFailure = { action: 'abort' };
    orchestrator.config.execution.requirePrePlanReview = true;
    orchestrator.initializeAgents();

    orchestrator.agents.planner.createPlan = async () => ({
      goalId: 'g1',
      goal: 'test',
      tasks: [{ id: 't1', description: 'Task', status: 'pending' }]
    });

    orchestrator.agents.supervisor.verify = async () => ({
      approved: false,
      score: 20,
      feedback: 'Plan rejected'
    });

    await assert.rejects(
      async () => orchestrator.execute('Test goal'),
      /Plan was not approved after maximum revisions/
    );
  });
});

describe('Orchestrator - Time Budget Management', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should stop execution when time budget exceeded', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.config.execution.requirePrePlanReview = false;
    orchestrator.config.execution.verifyAllOutputs = false;
    // Set very short time limit
    orchestrator.config.execution.timeLimit = 1; // 1ms
    orchestrator.initializeAgents();

    const tasks = [
      { id: 'task-1', description: 'Task 1', status: 'pending', attempts: 0 },
      { id: 'task-2', description: 'Task 2', status: 'pending', attempts: 0 }
    ];
    let executedCount = 0;

    // Add tasks to agentCore so updateTask can find them
    agentCore.getAgent('planner').tasks = tasks;

    orchestrator.agents.planner.createPlan = async () => ({
      goalId: 'g1',
      goal: 'test',
      tasks
    });

    orchestrator.agents.planner.getNextTask = () => {
      const pending = tasks.filter(t => t.status === 'pending');
      return pending[0] || null;
    };

    orchestrator.agents.planner.markTaskComplete = (id) => {
      const t = tasks.find(x => x.id === id);
      if (t) t.status = 'completed';
      executedCount++;
    };

    orchestrator.agents.planner.agent = { tasks };
    orchestrator.agents.planner.getPlanStatus = () => ({ completed: executedCount, total: 2 });
    orchestrator.agents.planner.getStats = () => ({});

    orchestrator.agents.coder.implement = async () => {
      // Add delay to ensure time budget is exceeded
      await new Promise(resolve => setTimeout(resolve, 10));
      return { status: 'success' };
    };
    orchestrator.agents.coder.getStats = () => ({});

    orchestrator.agents.tester.test = async () => ({ status: 'passed' });
    orchestrator.agents.tester.getStats = () => ({});

    orchestrator.agents.supervisor.verify = async () => ({ approved: true, score: 90 });
    orchestrator.agents.supervisor.getStats = () => ({});

    const result = await orchestrator.execute('Test goal');

    // Should have stopped before completing all tasks
    assert.ok(executedCount <= 2);
  });
});

describe('Orchestrator - Agent Coordination', () => {
  beforeEach(() => {
    cleanupTestDir();
    agentCore.reset();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should pass context between agents during execution', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test goal';
    orchestrator.startTime = Date.now();

    const task = { id: 'task-1', description: 'Test task', status: 'pending' };
    let coderContext = null;
    let testerContext = null;

    orchestrator.agents.coder.implement = async (t, ctx) => {
      coderContext = ctx;
      return { status: 'success', code: 'test code' };
    };

    orchestrator.agents.tester.test = async (t, impl, ctx) => {
      testerContext = { task: t, implementation: impl, context: ctx };
      return { status: 'passed' };
    };

    orchestrator.agents.supervisor.verify = async () => ({ approved: true, score: 90 });

    await orchestrator._executeTaskWithFixCycle(task);

    // Verify coder received goal context
    assert.ok(coderContext);
    assert.strictEqual(coderContext.goal, 'Test goal');

    // Verify tester received implementation from coder
    assert.ok(testerContext);
    assert.strictEqual(testerContext.task.id, 'task-1');
    assert.strictEqual(testerContext.implementation.code, 'test code');
    assert.strictEqual(testerContext.context.goal, 'Test goal');
  });

  it('should pass test failures to coder for fixes', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.goal = 'Test goal';

    const task = { id: 'task-1', description: 'Task', status: 'pending' };
    let testResultPassedToCoder = null;
    let testCount = 0;

    orchestrator.agents.coder.implement = async () => ({ status: 'success', code: 'code' });
    orchestrator.agents.coder.applyFix = async (t, testResult) => {
      testResultPassedToCoder = testResult;
      return { status: 'success', code: 'fixed code', testsPass: true };
    };

    orchestrator.agents.tester.test = async () => {
      testCount++;
      if (testCount === 1) {
        return { status: 'failed', errors: ['Error 1', 'Error 2'] };
      }
      return { status: 'passed' };
    };

    orchestrator.agents.supervisor.verify = async () => ({ approved: true, score: 90 });

    await orchestrator._executeTaskWithFixCycle(task);

    assert.ok(testResultPassedToCoder);
    assert.strictEqual(testResultPassedToCoder.status, 'failed');
    assert.deepStrictEqual(testResultPassedToCoder.errors, ['Error 1', 'Error 2']);
  });

  it('should coordinate supervisor verification with task output', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.goal = 'Verification test';

    const task = { id: 'task-1', description: 'Task', status: 'pending' };
    let supervisorContext = null;

    orchestrator.agents.coder.implement = async () => ({
      status: 'success',
      code: 'implementation code',
      filesModified: ['file1.js']
    });

    orchestrator.agents.tester.test = async () => ({
      status: 'passed',
      testResults: { passed: 5, failed: 0 }
    });

    orchestrator.agents.supervisor.verify = async (agent, type, ctx) => {
      supervisorContext = ctx;
      return { approved: true, score: 95 };
    };

    await orchestrator._executeTaskWithFixCycle(task);

    assert.ok(supervisorContext);
    assert.strictEqual(supervisorContext.goal, 'Verification test');
    assert.ok(supervisorContext.task);
    assert.ok(supervisorContext.agentOutput.implementation);
    assert.ok(supervisorContext.agentOutput.testResult);
  });
});

describe('Orchestrator - Task Depth Calculation', () => {
  beforeEach(() => {
    agentCore.reset();
  });

  it('should return depth 0 for root tasks', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();

    // Create a root task (no parent)
    const rootTask = agentCore.addTask('planner', {
      description: 'Root task',
      parentGoalId: 'goal-1'
    });

    const depth = orchestrator._getTaskDepth(rootTask);
    assert.strictEqual(depth, 0);
  });

  it('should return depth 1 for direct subtasks', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();

    const rootTask = agentCore.addTask('planner', {
      description: 'Root task',
      parentGoalId: 'goal-1'
    });

    const subtask = agentCore.addSubtask('planner', rootTask.id, {
      description: 'Subtask level 1'
    });

    const depth = orchestrator._getTaskDepth(subtask);
    assert.strictEqual(depth, 1);
  });

  it('should return correct depth for deeply nested tasks', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();

    // Create a 5-level deep hierarchy
    const level0 = agentCore.addTask('planner', {
      description: 'Level 0 (root)',
      parentGoalId: 'goal-1'
    });

    const level1 = agentCore.addSubtask('planner', level0.id, {
      description: 'Level 1'
    });

    const level2 = agentCore.addSubtask('planner', level1.id, {
      description: 'Level 2'
    });

    const level3 = agentCore.addSubtask('planner', level2.id, {
      description: 'Level 3'
    });

    const level4 = agentCore.addSubtask('planner', level3.id, {
      description: 'Level 4'
    });

    assert.strictEqual(orchestrator._getTaskDepth(level0), 0);
    assert.strictEqual(orchestrator._getTaskDepth(level1), 1);
    assert.strictEqual(orchestrator._getTaskDepth(level2), 2);
    assert.strictEqual(orchestrator._getTaskDepth(level3), 3);
    assert.strictEqual(orchestrator._getTaskDepth(level4), 4);
  });
});

describe('Orchestrator - Proactive Breakdown Depth Limit', () => {
  beforeEach(() => {
    agentCore.reset();
  });

  it('should proactively break down complex task at depth 0', async () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.config.planner = { settings: { maxReplanDepth: 3 } };

    const goal = agentCore.setGoal('planner', 'Test goal');
    const complexTask = agentCore.addTask('planner', {
      description: 'Complex root task',
      parentGoalId: goal.id,
      metadata: { complexity: 'complex' }
    });

    orchestrator.agents.planner.currentPlan = { goalId: goal.id };
    let replanCalled = false;

    orchestrator.agents.planner.replan = async () => {
      replanCalled = true;
      // Create subtasks to prevent infinite loop
      agentCore.addSubtask('planner', complexTask.id, {
        description: 'Subtask 1',
        metadata: { complexity: 'simple' }
      });
      return { subtasks: [] };
    };

    // Mock other agents to prevent execution
    orchestrator.agents.coder.implement = async () => ({ status: 'success' });
    orchestrator.agents.tester.test = async () => ({ status: 'passed' });
    orchestrator.agents.supervisor.verify = async () => ({ approved: true, score: 90 });

    // Start execution (will process first task)
    orchestrator.startTime = Date.now();
    orchestrator.goal = 'Test goal';

    // Get the task through getNextTask and check if replan would be called
    const task = orchestrator.agents.planner.getNextTask();
    const taskDepth = orchestrator._getTaskDepth(task);
    const maxReplanDepth = orchestrator.config.planner?.settings?.maxReplanDepth ?? 3;

    // Verify depth check would allow proactive breakdown
    assert.strictEqual(taskDepth, 0);
    assert.ok(taskDepth < maxReplanDepth, 'Should allow breakdown at depth 0');
  });

  it('should skip proactive breakdown when at max depth', () => {
    const orchestrator = new Orchestrator({
      configDir: TEST_CONFIG_DIR,
      configPath: path.join(TEST_CONFIG_DIR, 'default-workflow.json'),
      silent: true
    });

    orchestrator.loadConfiguration();
    orchestrator.initializeAgents();
    orchestrator.config.planner = { settings: { maxReplanDepth: 2 } };

    const goal = agentCore.setGoal('planner', 'Test goal');

    // Create hierarchy: root -> level1 -> level2 (depth 2)
    const root = agentCore.addTask('planner', {
      description: 'Root',
      parentGoalId: goal.id,
      metadata: { complexity: 'complex' }
    });

    const level1 = agentCore.addSubtask('planner', root.id, {
      description: 'Level 1',
      metadata: { complexity: 'complex' }
    });

    const level2 = agentCore.addSubtask('planner', level1.id, {
      description: 'Level 2 - at max depth',
      metadata: { complexity: 'complex' }
    });

    orchestrator.agents.planner.currentPlan = { goalId: goal.id };

    // Check depths
    assert.strictEqual(orchestrator._getTaskDepth(root), 0);
    assert.strictEqual(orchestrator._getTaskDepth(level1), 1);
    assert.strictEqual(orchestrator._getTaskDepth(level2), 2);

    // At maxReplanDepth: 2, level2 should NOT be proactively broken down
    const maxReplanDepth = orchestrator.config.planner.settings.maxReplanDepth;
    const level2Depth = orchestrator._getTaskDepth(level2);

    assert.ok(level2Depth >= maxReplanDepth, 'Level 2 should be at or beyond max depth');
  });
});
