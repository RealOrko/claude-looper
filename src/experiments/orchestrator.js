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
import { PlannerAgent } from './agent-planner.js';
import { CoderAgent } from './agent-coder.js';
import { TesterAgent } from './agent-tester.js';
import { SupervisorAgent, VERIFICATION_TYPES } from './agent-supervisor.js';
import fs from 'fs';
import path from 'path';

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
    this.configPath = options.configPath ||
      path.join(process.cwd(), 'src/experiments/default-workflow.json');

    this.config = null;
    this.agents = {};
    this.status = EXECUTION_STATUS.NOT_STARTED;
    this.currentPhase = null;
    this.startTime = null;
    this.goal = null;

    // Execution state
    this.executionState = {
      currentTaskIndex: 0,
      fixCycle: 0,
      planRevisions: 0,
      stepAttempts: 0
    };
  }

  /**
   * Load workflow configuration
   */
  loadConfiguration() {
    if (!fs.existsSync(this.configPath)) {
      throw new Error(`Configuration not found: ${this.configPath}`);
    }

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
          throw new Error('Plan was not approved after maximum revisions');
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
   * Execute planning phase
   */
  async _executePlanningPhase(goal, context) {
    console.log(`[Orchestrator] Starting planning phase for: ${goal}`);

    const plan = await this.agents.planner.createPlan(goal, context);

    console.log(`[Orchestrator] Plan created with ${plan.tasks.length} tasks`);

    return plan;
  }

  /**
   * Execute plan review phase
   */
  async _executePlanReviewPhase(plan) {
    let approved = false;
    let revisions = 0;
    const maxRevisions = this.config.execution.maxPlanRevisions;

    while (!approved && revisions < maxRevisions) {
      console.log(`[Orchestrator] Plan review attempt ${revisions + 1}/${maxRevisions}`);

      const verification = await this.agents.supervisor.verify(
        'planner',
        VERIFICATION_TYPES.PLAN,
        {
          goal: this.goal,
          task: null,
          agentOutput: plan,
          attemptNumber: revisions + 1
        }
      );

      if (verification.approved) {
        approved = true;
        console.log(`[Orchestrator] Plan approved with score ${verification.score}`);
      } else {
        revisions++;
        this.executionState.planRevisions = revisions;

        if (revisions < maxRevisions) {
          console.log(`[Orchestrator] Plan needs revision: ${verification.feedback}`);
          // Re-plan would happen here
        }
      }
    }

    return approved;
  }

  /**
   * Execute the main execution phase
   */
  async _executeExecutionPhase(plan) {
    console.log(`[Orchestrator] Starting execution phase`);

    let task = this.agents.planner.getNextTask();

    while (task) {
      console.log(`[Orchestrator] Executing task: ${task.description}`);

      // Update task status
      agentCore.updateTask('planner', task.id, { status: 'in_progress' });

      // Execute task with fix cycle
      const success = await this._executeTaskWithFixCycle(task);

      if (success) {
        this.agents.planner.markTaskComplete(task.id, { completedAt: Date.now() });
      } else {
        const { needsReplan } = this.agents.planner.markTaskFailed(task.id, 'Max attempts exceeded');

        if (needsReplan) {
          console.log(`[Orchestrator] Task needs re-planning`);
          await this.agents.planner.replan(task, 'Max attempts exceeded');
        }
      }

      // Check time budget
      if (this._isTimeBudgetExceeded()) {
        console.log(`[Orchestrator] Time budget exceeded`);
        break;
      }

      // Get next task
      task = this.agents.planner.getNextTask();
    }

    console.log(`[Orchestrator] Execution phase complete`);
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
      console.log(`[Orchestrator] Fix cycle ${fixCycle}/${maxFixCycles}`);

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
    console.log(`[Orchestrator] Starting verification phase`);

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

    console.log(`[Orchestrator] Goal verification: ${verification.approved ? 'APPROVED' : 'REJECTED'} (score: ${verification.score})`);

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
      agentCore.snapshot();
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
    agentCore.snapshot();
    return agentCore.getSummary();
  }
}

export default Orchestrator;
export { PHASES, EXECUTION_STATUS };
