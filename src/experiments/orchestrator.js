/**
 * Workflow Orchestrator - Coordinates agents to achieve goals
 *
 * This module:
 * - Initializes agents from configuration
 * - Manages the workflow phases
 * - Handles task execution loop
 * - Coordinates agent interactions
 */

import agentCore, { EventTypes } from './agent-core.js';
import agentExecutor from './agent-executor.js';
import { PlannerAgent } from './agent-planner.js';
import { CoderAgent } from './agent-coder.js';
import { TesterAgent } from './agent-tester.js';
import { SupervisorAgent, VERIFICATION_TYPES } from './agent-supervisor.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directory name for local config
const CONFIG_DIR = '.claude-looper';

// Workflow phases
const PHASES = {
  PLANNING: 'planning',
  PLAN_REVIEW: 'plan_review',
  EXECUTION: 'execution',
  VERIFICATION: 'verification'
};

// Execution status
const EXECUTION_STATUS = {
  NOT_STARTED: 'not_started',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ABORTED: 'aborted'
};

/**
 * Workflow Orchestrator class
 */
export class Orchestrator {
  constructor(options = {}) {
    // Base directory for all config files
    this.configDir = options.configDir || path.join(process.cwd(), CONFIG_DIR);
    this.configPath = options.configPath || path.join(this.configDir, 'default-workflow.json');
    this.templatesDir = path.join(this.configDir, 'templates');

    this.config = null;
    this.agents = {};
    this.status = EXECUTION_STATUS.NOT_STARTED;
    this.currentPhase = null;
    this.startTime = null;
    this.goal = null;

    // Silent mode for UI - suppresses console.log
    this.silent = options.silent || false;

    // Execution state
    this.executionState = {
      currentTaskIndex: 0,
      fixCycle: 0,
      planRevisions: 0,
      stepAttempts: 0
    };
  }

  /**
   * Log message (suppressed in silent mode)
   */
  _log(message) {
    if (!this.silent) {
      console.log(message);
    }
  }

  /**
   * Initialize config directory with defaults from package
   * Copies workflow config and templates if they don't exist
   */
  initializeConfigDir() {
    const packageDir = __dirname;

    // Create config directory if it doesn't exist
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
      this._log(`Created config directory: ${this.configDir}`);
    }

    // Copy default workflow if it doesn't exist
    if (!fs.existsSync(this.configPath)) {
      const packageDefaultPath = path.join(packageDir, 'default-workflow.json');
      if (!fs.existsSync(packageDefaultPath)) {
        throw new Error(`Default configuration not found in package: ${packageDefaultPath}`);
      }
      fs.copyFileSync(packageDefaultPath, this.configPath);
      this._log(`Created default workflow: ${this.configPath}`);
    }

    // Copy templates directory if it doesn't exist
    if (!fs.existsSync(this.templatesDir)) {
      const packageTemplatesDir = path.join(packageDir, 'templates');
      if (!fs.existsSync(packageTemplatesDir)) {
        throw new Error(`Templates not found in package: ${packageTemplatesDir}`);
      }
      this._copyDirRecursive(packageTemplatesDir, this.templatesDir);
      this._log(`Created templates directory: ${this.templatesDir}`);
    }
  }

  /**
   * Recursively copy a directory
   */
  _copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this._copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Load workflow configuration
   * Initializes config directory if needed
   */
  loadConfiguration() {
    // Ensure config directory is initialized with defaults
    this.initializeConfigDir();

    const configData = fs.readFileSync(this.configPath, 'utf8');
    this.config = JSON.parse(configData)['default-workflow'];

    // Save to agent core
    agentCore.saveConfiguration({ 'default-workflow': this.config });

    return this.config;
  }

  /**
   * Initialize all agents from configuration
   */
  initializeAgents() {
    if (!this.config) {
      this.loadConfiguration();
    }

    const agentConfigs = this.config.agents;

    // Initialize each agent
    this.agents.supervisor = new SupervisorAgent({
      model: agentConfigs.supervisor.model,
      fallbackModel: agentConfigs.supervisor.fallbackModel,
      subscribesTo: agentConfigs.supervisor.subscribesTo
    });

    this.agents.planner = new PlannerAgent({
      model: agentConfigs.planner.model,
      fallbackModel: agentConfigs.planner.fallbackModel,
      subscribesTo: agentConfigs.planner.subscribesTo
    });

    this.agents.coder = new CoderAgent({
      model: agentConfigs.coder.model,
      fallbackModel: agentConfigs.coder.fallbackModel,
      subscribesTo: agentConfigs.coder.subscribesTo
    });

    this.agents.tester = new TesterAgent({
      model: agentConfigs.tester.model,
      fallbackModel: agentConfigs.tester.fallbackModel,
      subscribesTo: agentConfigs.tester.subscribesTo
    });

    return this.agents;
  }

  /**
   * Start workflow execution
   * @param {string} goal - Goal description
   * @param {object} context - Additional context
   */
  async execute(goal, context = {}) {
    this.goal = goal;
    this.startTime = Date.now();
    this.status = EXECUTION_STATUS.RUNNING;

    // Initialize if not already done
    if (Object.keys(this.agents).length === 0) {
      this.initializeAgents();
    }

    // Start workflow in agent core
    agentCore.startWorkflow('default-workflow', goal, this.config);

    try {
      // Phase 1: Planning
      this.currentPhase = PHASES.PLANNING;
      const plan = await this._executePlanningPhase(goal, context);

      // Phase 2: Plan Review (if required)
      if (this.config.execution.requirePrePlanReview) {
        this.currentPhase = PHASES.PLAN_REVIEW;
        const approved = await this._executePlanReviewPhase(plan);

        if (!approved) {
          // Handle based on data-driven config
          const failureAction = this.config.planReviewFailure?.action || 'skip_and_continue';

          if (failureAction === 'abort') {
            throw new Error('Plan was not approved after maximum revisions');
          } else if (failureAction === 'skip_and_continue') {
            this._log(`[Orchestrator] Plan review failed but continuing per config (skip_and_continue)`);
          }
          // For 'lower_threshold', the threshold would be adjusted in supervisor config
        }
      }

      // Phase 3: Execution
      this.currentPhase = PHASES.EXECUTION;
      await this._executeExecutionPhase(plan);

      // Phase 4: Final Verification
      this.currentPhase = PHASES.VERIFICATION;
      const verified = await this._executeVerificationPhase();

      // Complete workflow
      this.status = verified ? EXECUTION_STATUS.COMPLETED : EXECUTION_STATUS.FAILED;
      agentCore.completeWorkflow(this.status, {
        duration: Date.now() - this.startTime,
        goal,
        verified
      });

      return {
        success: verified,
        status: this.status,
        duration: Date.now() - this.startTime,
        summary: agentCore.getSummary()
      };

    } catch (error) {
      this.status = EXECUTION_STATUS.FAILED;
      agentCore.completeWorkflow('failed', { error: error.message });

      throw error;
    }
  }

  /**
   * Resume a failed or interrupted workflow
   * Loads saved state, resets failed tasks, and continues execution
   */
  async resumeExecution() {
    // Load saved state
    const state = agentCore.loadSnapshot();
    if (!state) {
      throw new Error('No saved state to resume from');
    }

    this.goal = state.workflow.goal;
    this.startTime = Date.now(); // Reset start time for this session
    this.currentPhase = state.currentPhase || PHASES.EXECUTION;

    // Restore executor sessions for Claude conversation continuity
    this._restoreSessions(state);

    // Initialize agents if not already done
    if (Object.keys(this.agents).length === 0) {
      this.initializeAgents();
    }

    // Restore planner tasks from saved state
    const plannerState = state.agents?.planner;
    if (plannerState && this.agents.planner) {
      // Sync tasks to the planner agent
      this.agents.planner.agent.tasks = plannerState.tasks || [];

      // Restore planner's currentPlan so getNextTask() works correctly
      const goalId = plannerState.goals?.[0]?.id;
      if (goalId) {
        this.agents.planner.currentPlan = {
          goalId,
          goal: this.goal,
          tasks: plannerState.tasks || [],
          createdAt: state.timestamp
        };
      }
    }

    // Reset failed and in-progress tasks for retry
    const resetCount = agentCore.resetFailedTasks('planner');
    this._log(`[Orchestrator] Reset ${resetCount} failed/in-progress tasks for retry`);

    // Also reset in the planner agent instance
    if (this.agents.planner) {
      for (const task of this.agents.planner.agent.tasks) {
        if (task.status === 'failed' || task.status === 'in_progress') {
          task.status = 'pending';
          task.attempts = 0;
        }
      }
    }

    this.status = EXECUTION_STATUS.RUNNING;

    try {
      // Get the current plan from saved tasks
      const plan = {
        tasks: this.agents.planner.agent.tasks
      };

      // Check if we need to do plan review (skip if already done)
      const hasCompletedTasks = plan.tasks.some(t => t.status === 'completed');
      if (!hasCompletedTasks && this.config.execution.requirePrePlanReview) {
        this.currentPhase = PHASES.PLAN_REVIEW;
        const approved = await this._executePlanReviewPhase(plan);
        if (!approved) {
          // Handle based on data-driven config
          const failureAction = this.config.planReviewFailure?.action || 'skip_and_continue';

          if (failureAction === 'abort') {
            throw new Error('Plan was not approved after maximum revisions');
          } else if (failureAction === 'skip_and_continue') {
            this._log(`[Orchestrator] Plan review failed but continuing per config (skip_and_continue)`);
          }
        }
      }

      // Continue with execution phase
      this.currentPhase = PHASES.EXECUTION;
      await this._executeExecutionPhase(plan);

      // Final verification
      this.currentPhase = PHASES.VERIFICATION;
      const verified = await this._executeVerificationPhase();

      // Complete workflow
      this.status = verified ? EXECUTION_STATUS.COMPLETED : EXECUTION_STATUS.FAILED;
      agentCore.completeWorkflow(this.status, {
        duration: Date.now() - this.startTime,
        goal: this.goal,
        verified,
        resumed: true
      });

      return {
        success: verified,
        status: this.status,
        duration: Date.now() - this.startTime,
        summary: agentCore.getSummary(),
        resumed: true
      };

    } catch (error) {
      this.status = EXECUTION_STATUS.FAILED;
      agentCore.completeWorkflow('failed', { error: error.message });
      // Save state so we can resume again
      this._snapshot();
      throw error;
    }
  }

  /**
   * Execute planning phase
   */
  async _executePlanningPhase(goal, context) {
    this._log(`[Orchestrator] Starting planning phase for: ${goal}`);

    const plan = await this.agents.planner.createPlan(goal, context);

    this._log(`[Orchestrator] Plan created with ${plan.tasks.length} tasks`);

    return plan;
  }

  /**
   * Execute plan review phase
   */
  async _executePlanReviewPhase(plan) {
    let approved = false;
    let revisions = 0;
    const maxRevisions = this.config.execution.maxPlanRevisions;
    let currentPlan = plan;

    while (!approved && revisions < maxRevisions) {
      this._log(`[Orchestrator] Plan review attempt ${revisions + 1}/${maxRevisions}`);

      const verification = await this.agents.supervisor.verify(
        'planner',
        VERIFICATION_TYPES.PLAN,
        {
          goal: this.goal,
          task: null,
          agentOutput: currentPlan,
          attemptNumber: revisions + 1
        }
      );

      if (verification.approved) {
        approved = true;
        this._log(`[Orchestrator] Plan approved with score ${verification.score}`);
      } else {
        revisions++;
        this.executionState.planRevisions = revisions;

        if (revisions < maxRevisions) {
          this._log(`[Orchestrator] Plan needs revision: ${verification.feedback}`);

          // Re-create plan incorporating supervisor feedback
          currentPlan = await this.agents.planner.createPlan(this.goal, {
            previousPlan: currentPlan,
            feedback: verification.feedback,
            issues: verification.issues,
            missingElements: verification.missingElements
          });
        }
      }
    }

    return approved;
  }

  /**
   * Execute the main execution phase
   */
  async _executeExecutionPhase(plan) {
    this._log(`[Orchestrator] Starting execution phase`);

    let task = this.agents.planner.getNextTask();

    while (task) {
      this._log(`[Orchestrator] Executing task: ${task.description}`);

      // Update task status
      agentCore.updateTask('planner', task.id, { status: 'in_progress' });

      // Execute task with fix cycle
      const success = await this._executeTaskWithFixCycle(task);

      if (success) {
        this.agents.planner.markTaskComplete(task.id, { completedAt: Date.now() });
      } else {
        const { needsReplan } = this.agents.planner.markTaskFailed(task.id, 'Max attempts exceeded');

        if (needsReplan) {
          this._log(`[Orchestrator] Task needs re-planning`);
          await this.agents.planner.replan(task, 'Max attempts exceeded');
        }
      }

      // Snapshot after each task for resumability
      this._snapshot();

      // Check time budget
      if (this._isTimeBudgetExceeded()) {
        this._log(`[Orchestrator] Time budget exceeded`);
        break;
      }

      // Get next task
      task = this.agents.planner.getNextTask();
    }

    this._log(`[Orchestrator] Execution phase complete`);
  }

  /**
   * Execute a single task with fix cycles
   */
  async _executeTaskWithFixCycle(task) {
    const maxFixCycles = this.config.execution.maxFixCycles;
    let fixCycle = 0;

    // Coder implements
    const implementation = await this.agents.coder.implement(task, {
      goal: this.goal,
      completedTasks: this.agents.planner.agent.tasks.filter(t => t.status === 'completed')
    });

    if (implementation.status === 'blocked') {
      return false;
    }

    // Tester tests
    let testResult = await this.agents.tester.test(task, implementation, { goal: this.goal });

    while (testResult.status === 'failed' && fixCycle < maxFixCycles) {
      fixCycle++;
      this._log(`[Orchestrator] Fix cycle ${fixCycle}/${maxFixCycles}`);

      // Coder fixes
      const fix = await this.agents.coder.applyFix(task, testResult, fixCycle, maxFixCycles);

      if (fix.status === 'blocked') {
        return false;
      }

      if (fix.testsPass) {
        testResult = { status: 'passed', ...fix };
        break;
      }

      // Re-test
      testResult = await this.agents.tester.test(task, fix, { goal: this.goal });
    }

    // Supervisor verification
    if (testResult.status === 'passed' && this.config.execution.verifyAllOutputs) {
      const verification = await this.agents.supervisor.verify(
        'coder',
        VERIFICATION_TYPES.STEP,
        {
          goal: this.goal,
          task,
          agentOutput: { implementation, testResult }
        }
      );

      return verification.approved;
    }

    return testResult.status === 'passed';
  }

  /**
   * Execute final verification phase
   */
  async _executeVerificationPhase() {
    this._log(`[Orchestrator] Starting verification phase`);

    const planStatus = this.agents.planner.getPlanStatus();

    const verification = await this.agents.supervisor.verify(
      'orchestrator',
      VERIFICATION_TYPES.GOAL,
      {
        goal: this.goal,
        agentOutput: {
          planStatus,
          agentStats: {
            planner: this.agents.planner.getStats(),
            coder: this.agents.coder.getStats(),
            tester: this.agents.tester.getStats(),
            supervisor: this.agents.supervisor.getStats()
          }
        }
      }
    );

    this._log(`[Orchestrator] Goal verification: ${verification.approved ? 'APPROVED' : 'REJECTED'} (score: ${verification.score})`);

    return verification.approved;
  }

  /**
   * Check if time budget is exceeded
   */
  _isTimeBudgetExceeded() {
    const timeLimit = this.config.execution.timeLimit;
    const elapsed = Date.now() - this.startTime;
    return elapsed >= timeLimit;
  }

  /**
   * Get elapsed time formatted
   */
  getElapsedTime() {
    if (!this.startTime) return '0s';

    const elapsed = Date.now() - this.startTime;
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      status: this.status,
      phase: this.currentPhase,
      goal: this.goal,
      elapsed: this.getElapsedTime(),
      planStatus: this.agents.planner?.getPlanStatus(),
      agentStats: {
        planner: this.agents.planner?.getStats(),
        coder: this.agents.coder?.getStats(),
        tester: this.agents.tester?.getStats(),
        supervisor: this.agents.supervisor?.getStats()
      }
    };
  }

  /**
   * Pause execution
   */
  pause() {
    if (this.status === EXECUTION_STATUS.RUNNING) {
      this.status = EXECUTION_STATUS.PAUSED;
      this._snapshot();
    }
  }

  /**
   * Resume execution
   */
  async resume() {
    if (this.status === EXECUTION_STATUS.PAUSED) {
      this.status = EXECUTION_STATUS.RUNNING;
      // Continue from where we left off
    }
  }

  /**
   * Abort execution
   */
  abort() {
    this.status = EXECUTION_STATUS.ABORTED;
    agentCore.completeWorkflow('aborted', {
      duration: Date.now() - this.startTime,
      reason: 'User aborted'
    });
  }

  /**
   * Save state and exit
   */
  saveAndExit() {
    this._snapshot();
    return agentCore.getSummary();
  }

  /**
   * Snapshot state including executor sessions for full resumability
   */
  _snapshot() {
    agentCore.snapshot({
      executorSessions: agentExecutor.sessions,
      currentPhase: this.currentPhase
    });
  }

  /**
   * Restore executor sessions from loaded state
   */
  _restoreSessions(state) {
    if (state.executorSessions) {
      Object.assign(agentExecutor.sessions, state.executorSessions);
    }
  }
}

export default Orchestrator;
export { PHASES, EXECUTION_STATUS };
