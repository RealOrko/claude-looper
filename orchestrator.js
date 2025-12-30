/**
 * Workflow Orchestrator - Coordinates agents to achieve goals
 *
 * This module:
 * - Initializes agents from configuration
 * - Manages the workflow phases
 * - Handles task execution loop
 * - Coordinates agent interactions
 */

import agentCore from './agent-core.js';
import agentExecutor from './agent-executor.js';
import { PlannerAgent } from './agent-planner.js';
import { CoderAgent } from './agent-coder.js';
import { TesterAgent } from './agent-tester.js';
import { SupervisorAgent, VERIFICATION_TYPES, DIAGNOSIS_DECISIONS } from './agent-supervisor.js';
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

    // Track attempt history per task for diagnosis
    this.taskAttempts = new Map();

    // Track pivot count for the current goal
    this.pivotCount = 0;

    // Periodic snapshot interval (null when not running)
    this.snapshotInterval = null;
    this.snapshotIntervalMs = options.snapshotIntervalMs || 60000; // Default 60 seconds
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
   * Check if we're running in the source tree directory
   * (where the package source code lives)
   */
  _isSourceTreeDirectory() {
    const packageDir = __dirname;
    const cwd = process.cwd();

    // Check if cwd is the package directory or a parent/child of it
    // by looking for source markers in cwd
    const sourceMarkers = ['orchestrator.js', 'cli.js', 'agent-executor.js'];
    const hasSourceMarkers = sourceMarkers.every(marker =>
      fs.existsSync(path.join(cwd, marker))
    );

    // Also check if there's a templates/ directory at cwd root (source templates)
    const hasSourceTemplates = fs.existsSync(path.join(cwd, 'templates'));

    return hasSourceMarkers && hasSourceTemplates;
  }

  /**
   * Initialize config directory with defaults from package
   * Copies workflow config and templates if they don't exist
   * When running in source tree directory, always overwrites templates from source
   */
  initializeConfigDir() {
    const packageDir = __dirname;
    const isSourceTree = this._isSourceTreeDirectory();

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

    // Copy templates directory
    // Always overwrite when in source tree directory to ensure templates stay in sync
    const packageTemplatesDir = path.join(packageDir, 'templates');
    const shouldCopyTemplates = !fs.existsSync(this.templatesDir) || isSourceTree;

    if (shouldCopyTemplates) {
      if (!fs.existsSync(packageTemplatesDir)) {
        throw new Error(`Templates not found in package: ${packageTemplatesDir}`);
      }
      this._copyDirRecursive(packageTemplatesDir, this.templatesDir);
      if (isSourceTree) {
        this._log(`Synced templates from source: ${this.templatesDir}`);
      } else {
        this._log(`Created templates directory: ${this.templatesDir}`);
      }
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
   * @param {boolean} allowExisting - If true, allow using existing agents (for resume)
   */
  initializeAgents(allowExisting = false) {
    if (!this.config) {
      this.loadConfiguration();
    }

    const agentConfigs = this.config.agents;

    // Initialize each agent
    this.agents.supervisor = new SupervisorAgent({
      model: agentConfigs.supervisor.model,
      fallbackModel: agentConfigs.supervisor.fallbackModel,
      subscribesTo: agentConfigs.supervisor.subscribesTo,
      allowExisting
    });

    this.agents.planner = new PlannerAgent({
      model: agentConfigs.planner.model,
      fallbackModel: agentConfigs.planner.fallbackModel,
      subscribesTo: agentConfigs.planner.subscribesTo,
      allowExisting
    });

    this.agents.coder = new CoderAgent({
      model: agentConfigs.coder.model,
      fallbackModel: agentConfigs.coder.fallbackModel,
      subscribesTo: agentConfigs.coder.subscribesTo,
      allowExisting
    });

    this.agents.tester = new TesterAgent({
      model: agentConfigs.tester.model,
      fallbackModel: agentConfigs.tester.fallbackModel,
      subscribesTo: agentConfigs.tester.subscribesTo,
      allowExisting
    });

    return this.agents;
  }

  /**
   * Initialize agents for resume - allows existing registered agents
   */
  _initializeAgentsForResume() {
    return this.initializeAgents(true);
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
    this._startPeriodicSnapshots();

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
      this._stopPeriodicSnapshots();
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
      this._stopPeriodicSnapshots();
      agentCore.completeWorkflow('failed', { error: error.message });

      throw error;
    }
  }

  /**
   * Resume a failed or interrupted workflow
   * Loads saved state, resets failed tasks, and continues execution
   */
  async resumeExecution() {
    // Load configuration first (needed for execution settings)
    this.loadConfiguration();

    // Load saved state (this restores agentCore.agents)
    const state = agentCore.loadSnapshot();
    if (!state) {
      throw new Error('No saved state to resume from');
    }

    this.goal = state.workflow.goal;
    this.startTime = Date.now(); // Reset start time for this session
    this.currentPhase = state.currentPhase || PHASES.EXECUTION;

    // Restore executor sessions for Claude conversation continuity
    this._restoreSessions(state);

    // Restore task attempt history for proper diagnosis context
    if (state.taskAttempts) {
      this.taskAttempts = new Map(Object.entries(state.taskAttempts));
      this._log(`[Orchestrator] Restored attempt history for ${this.taskAttempts.size} tasks`);
    }

    // Restore pivot count
    if (state.pivotCount !== undefined) {
      this.pivotCount = state.pivotCount;
      this._log(`[Orchestrator] Restored pivot count: ${this.pivotCount}`);
    }

    // Initialize agents - need to handle already-registered agents
    this._initializeAgentsForResume();

    // Restore planner tasks and currentPlan from saved state
    const plannerState = state.agents?.planner;
    if (plannerState && this.agents.planner) {
      // The agent.tasks reference already points to agentCore.agents['planner'].tasks
      // which was restored by loadSnapshot(), so we just need to set currentPlan

      // Find the goal - prefer active goal, fall back to first goal
      const activeGoal = plannerState.goals?.find(g => g.status === 'active');
      const goal = activeGoal || plannerState.goals?.[0];

      if (goal) {
        this.agents.planner.currentPlan = {
          goalId: goal.id,
          goal: this.goal,
          tasks: plannerState.tasks || [],
          createdAt: state.timestamp
        };
        this._log(`[Orchestrator] Restored plan with goalId: ${goal.id}`);
      } else if (plannerState.tasks?.length > 0) {
        // No goal found but we have tasks - use the first task's parentGoalId
        const firstTask = plannerState.tasks[0];
        const goalId = firstTask?.parentGoalId || `goal-resumed-${Date.now()}`;
        this.agents.planner.currentPlan = {
          goalId,
          goal: this.goal,
          tasks: plannerState.tasks,
          createdAt: state.timestamp
        };
        this._log(`[Orchestrator] Restored plan using task's parentGoalId: ${goalId}`);
      } else {
        this._log(`[Orchestrator] Warning: No goals or tasks found in saved state`);
      }
    }

    // Reset failed and in-progress tasks for retry
    const resetCount = agentCore.resetFailedTasks('planner');
    this._log(`[Orchestrator] Reset ${resetCount} failed/in-progress tasks for retry`);

    this.status = EXECUTION_STATUS.RUNNING;
    this._startPeriodicSnapshots();

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
      this._stopPeriodicSnapshots();
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
      this._stopPeriodicSnapshots();
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

    // Loop until all tasks are complete or supervisor says to stop
    while (true) {
      // Get next pending task
      let task = this.agents.planner.getNextTask();

      if (!task) {
        // No pending tasks - check if there are failed tasks to diagnose
        const goalId = this.agents.planner.currentPlan?.goalId;
        const failedTasks = this.agents.planner.agent.tasks.filter(
          t => t.status === 'failed' && t.parentGoalId === goalId
        );

        if (failedTasks.length === 0) {
          this._log(`[Orchestrator] All tasks completed`);
          break;
        }

        // Diagnose the first failed task
        task = failedTasks[0];
        this._log(`[Orchestrator] Diagnosing failed task: ${task.description}`);

        const diagnosis = await this._diagnoseAndHandle(task);

        if (diagnosis.stop) {
          this._log(`[Orchestrator] Stopping: ${diagnosis.reason}`);
          break;
        }

        // Continue the loop - diagnosis may have created new tasks or reset the failed one
        continue;
      }

      // Proactively break down complex and medium tasks before executing
      // Respect maxReplanDepth to prevent unlimited nesting
      const maxReplanDepth = this.config.planner?.settings?.maxReplanDepth ?? 3;
      const taskDepth = this._getTaskDepth(task);

      if (['complex', 'medium'].includes(task.metadata?.complexity) &&
          (!task.subtasks || task.subtasks.length === 0) &&
          taskDepth < maxReplanDepth) {
        this._log(`[Orchestrator] ${task.metadata.complexity} task at depth ${taskDepth} detected, breaking into subtasks: ${task.description}`);
        await this.agents.planner.replan(task, `Proactive breakdown of ${task.metadata.complexity} task`);
        // Continue loop to pick up the new subtasks
        continue;
      } else if (['complex', 'medium'].includes(task.metadata?.complexity) &&
                 (!task.subtasks || task.subtasks.length === 0) &&
                 taskDepth >= maxReplanDepth) {
        this._log(`[Orchestrator] Skipping proactive breakdown: depth ${taskDepth} >= max ${maxReplanDepth}. Executing ${task.metadata.complexity} task directly.`);
      }

      this._log(`[Orchestrator] Executing task: ${task.description}`);

      // Update task status
      agentCore.updateTask('planner', task.id, { status: 'in_progress' });

      // Execute task with fix cycle
      const result = await this._executeTaskWithFixCycle(task);

      if (result.success) {
        this.agents.planner.markTaskComplete(task.id, { completedAt: Date.now() });
      } else {
        // Record this attempt
        this._recordAttempt(task.id, {
          approach: result.approach,
          result: result.result,
          error: result.error
        });

        // Mark task as failed (will be diagnosed on next iteration)
        this.agents.planner.markTaskFailed(task.id, result.error);
      }

      // Snapshot after each task for resumability
      this._snapshot();

      // Check time budget (if configured)
      if (this.config.execution.timeLimit > 0 && this._isTimeBudgetExceeded()) {
        this._log(`[Orchestrator] Time budget exceeded`);
        break;
      }
    }

    this._log(`[Orchestrator] Execution phase complete`);
  }

  /**
   * Diagnose a failed task and handle the decision
   * @returns {object} { stop: boolean, reason?: string }
   */
  async _diagnoseAndHandle(task) {
    const attempts = this._getAttemptHistory(task.id);
    const state = this._getDiagnosisState();

    // Calculate hard limits
    const maxAttempts = this.config.execution.maxStepAttempts || 3;
    const maxReplanDepth = this.config.planner?.settings?.maxReplanDepth || 3;
    const maxPivots = this.config.execution.maxPivots || 3;
    const retriesExhausted = attempts.length >= maxAttempts;
    const replanDepthExhausted = state.replanDepth >= maxReplanDepth;
    const pivotsExhausted = this.pivotCount >= maxPivots;

    const diagnosis = await this.agents.supervisor.diagnose({
      goal: this.goal,
      task,
      parentTask: this._getParentTask(task),  // Hierarchical context
      attempts,
      ...state,
      pivotCount: this.pivotCount,
      maxPivots
    });

    this._log(`[Orchestrator] Diagnosis: ${diagnosis.decision} - ${diagnosis.reasoning}`);

    // Determine effective decision with hard limit enforcement
    // Escalation chain: RETRY -> REPLAN -> PIVOT -> IMPOSSIBLE
    let effectiveDecision = diagnosis.decision;

    // Enforce retry limit: escalate RETRY to REPLAN if retries exhausted
    if (effectiveDecision === DIAGNOSIS_DECISIONS.RETRY && retriesExhausted) {
      this._log(`[Orchestrator] RETRY blocked: ${attempts.length} attempts >= max ${maxAttempts}. Escalating to REPLAN.`);
      effectiveDecision = DIAGNOSIS_DECISIONS.REPLAN;
    }

    // Enforce replan depth limit: escalate REPLAN to PIVOT if depth exhausted
    if (effectiveDecision === DIAGNOSIS_DECISIONS.REPLAN && replanDepthExhausted) {
      this._log(`[Orchestrator] REPLAN blocked: depth ${state.replanDepth} >= max ${maxReplanDepth}. Escalating to PIVOT.`);
      effectiveDecision = DIAGNOSIS_DECISIONS.PIVOT;
    }

    // Enforce pivot limit: escalate PIVOT to IMPOSSIBLE if pivots exhausted
    if (effectiveDecision === DIAGNOSIS_DECISIONS.PIVOT && pivotsExhausted) {
      this._log(`[Orchestrator] PIVOT blocked: ${this.pivotCount} pivots >= max ${maxPivots}. Escalating to IMPOSSIBLE.`);
      effectiveDecision = DIAGNOSIS_DECISIONS.IMPOSSIBLE;
    }

    switch (effectiveDecision) {
      case DIAGNOSIS_DECISIONS.RETRY:
        // Reset task to pending and clear its failed status
        this._log(`[Orchestrator] Retrying task (attempt ${attempts.length + 1}/${maxAttempts})`);
        agentCore.updateTask('planner', task.id, { status: 'pending' });
        return { stop: false };

      case DIAGNOSIS_DECISIONS.REPLAN:
        // Break task into subtasks
        this._log(`[Orchestrator] Replanning task into subtasks (depth ${state.replanDepth + 1}/${maxReplanDepth})`);
        await this.agents.planner.replan(task, diagnosis.reasoning);
        return { stop: false };

      case DIAGNOSIS_DECISIONS.PIVOT:
        // Create a fresh plan with a different approach
        this.pivotCount++;
        this._log(`[Orchestrator] Pivoting to new approach (pivot ${this.pivotCount}/${maxPivots}): ${diagnosis.suggestion}`);
        await this._pivot(diagnosis.suggestion);
        return { stop: false };

      case DIAGNOSIS_DECISIONS.CLARIFY:
        // LLM requested clarification - but we want autonomous operation
        // Treat as a signal to try a different approach (pivot) if possible
        if (!pivotsExhausted) {
          this.pivotCount++;
          this._log(`[Orchestrator] CLARIFY requested but running autonomously. Pivoting instead (pivot ${this.pivotCount}/${maxPivots})`);
          await this._pivot(diagnosis.clarification || 'Try alternative approach');
          return { stop: false };
        }
        // Fall through to IMPOSSIBLE if pivots exhausted
        this._log(`[Orchestrator] CLARIFY requested but pivots exhausted. Marking as IMPOSSIBLE.`);
        return { stop: true, reason: `Task impossible: ${diagnosis.clarification || 'No viable approach found'}` };

      case DIAGNOSIS_DECISIONS.IMPOSSIBLE:
        // Goal cannot be achieved
        const blockers = diagnosis.blockers?.join(', ') ||
          `Exhausted all recovery options (${attempts.length} retries, depth ${state.replanDepth} replans, ${this.pivotCount} pivots)`;
        this._log(`[Orchestrator] Task impossible: ${blockers}`);
        return { stop: true, reason: `Task impossible: ${blockers}` };

      default:
        // Unknown decision - default to replan with escalation
        this._log(`[Orchestrator] Unknown diagnosis decision: ${diagnosis.decision}, defaulting to replan`);
        if (replanDepthExhausted) {
          if (!pivotsExhausted) {
            this.pivotCount++;
            this._log(`[Orchestrator] Replan depth exhausted, pivoting instead (pivot ${this.pivotCount}/${maxPivots})`);
            await this._pivot(diagnosis.reasoning || 'Try alternative approach');
            return { stop: false };
          }
          this._log(`[Orchestrator] All recovery options exhausted. Marking as IMPOSSIBLE.`);
          return { stop: true, reason: 'Exhausted all recovery options' };
        }
        await this.agents.planner.replan(task, diagnosis.reasoning);
        return { stop: false };
    }
  }

  /**
   * Pivot to a new approach by creating a fresh plan
   */
  async _pivot(suggestion) {
    // Mark all pending/failed tasks as blocked (they're from the old approach)
    const goalId = this.agents.planner.currentPlan?.goalId;
    const tasks = this.agents.planner.agent.tasks.filter(
      t => t.parentGoalId === goalId && (t.status === 'pending' || t.status === 'failed')
    );

    for (const task of tasks) {
      agentCore.updateTask('planner', task.id, {
        status: 'blocked',
        metadata: { ...task.metadata, blockedReason: 'Pivot to new approach' }
      });
    }

    // Create a fresh plan with the suggested approach
    const newPlan = await this.agents.planner.createPlan(this.goal, {
      previousAttempts: this._summarizeAttempts(),
      suggestedApproach: suggestion,
      instruction: 'Previous approaches failed. Try this different strategy.'
    });

    this._log(`[Orchestrator] Pivot created ${newPlan.tasks.length} new tasks`);
  }

  /**
   * Summarize all attempts for context in pivot
   */
  _summarizeAttempts() {
    const summary = [];
    for (const [taskId, attempts] of this.taskAttempts.entries()) {
      const task = this.agents.planner.agent.tasks.find(t => t.id === taskId);
      if (task && attempts.length > 0) {
        summary.push({
          task: task.description,
          attempts: attempts.map(a => ({
            approach: a.approach,
            result: a.result,
            error: a.error
          }))
        });
      }
    }
    return summary;
  }

  /**
   * Execute a single task with fix cycles
   * @returns {object} { success: boolean, error?: string, implementation?: object }
   */
  async _executeTaskWithFixCycle(task) {
    const maxFixCycles = this.config.execution.maxFixCycles;
    let fixCycle = 0;

    // Coder implements - include previous attempts so coder can learn from feedback
    const previousAttempts = this._getAttemptHistory(task.id);
    const implementation = await this.agents.coder.implement(task, {
      goal: this.goal,
      completedTasks: this.agents.planner.agent.tasks.filter(t => t.status === 'completed'),
      previousAttempts: previousAttempts.length > 0 ? previousAttempts : undefined
    });

    if (implementation.status === 'blocked') {
      return {
        success: false,
        error: implementation.blockReason || 'Implementation blocked',
        approach: 'Initial implementation',
        result: 'blocked'
      };
    }

    // Tester tests
    let testResult = await this.agents.tester.test(task, implementation, { goal: this.goal });

    while (testResult.status === 'failed' && fixCycle < maxFixCycles) {
      fixCycle++;
      this._log(`[Orchestrator] Fix cycle ${fixCycle}/${maxFixCycles}`);

      // Coder fixes
      const fix = await this.agents.coder.applyFix(task, testResult, fixCycle, maxFixCycles);

      if (fix.status === 'blocked') {
        return {
          success: false,
          error: fix.blockReason || 'Fix blocked',
          approach: `Fix attempt ${fixCycle}`,
          result: 'blocked'
        };
      }

      if (fix.testsPass) {
        testResult = {
          status: 'passed',
          summary: fix.summary,
          filesModified: fix.filesModified,
          testsRun: fix.testsRun,
          testsPass: fix.testsPass
        };
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
          parentTask: this._getParentTask(task),  // Hierarchical context
          agentOutput: { implementation, testResult }
        }
      );

      if (!verification.approved) {
        return {
          success: false,
          error: verification.feedback || 'Supervisor rejected',
          approach: 'Implementation with passing tests',
          result: 'rejected by supervisor'
        };
      }

      return { success: true };
    }

    if (testResult.status === 'passed') {
      return { success: true };
    }

    // Tests still failing after max fix cycles
    const failureDetails = testResult.failures?.map(f => f.error).join('; ') || 'Tests failed';
    return {
      success: false,
      error: failureDetails,
      approach: `Implementation with ${fixCycle} fix attempts`,
      result: 'tests still failing'
    };
  }

  /**
   * Record an attempt for a task
   */
  _recordAttempt(taskId, attemptInfo) {
    if (!this.taskAttempts.has(taskId)) {
      this.taskAttempts.set(taskId, []);
    }
    const attempts = this.taskAttempts.get(taskId);
    attempts.push({
      attemptNumber: attempts.length + 1,
      ...attemptInfo,
      timestamp: Date.now()
    });
  }

  /**
   * Get attempt history for a task
   */
  _getAttemptHistory(taskId) {
    return this.taskAttempts.get(taskId) || [];
  }

  /**
   * Get current state for diagnosis
   */
  _getDiagnosisState() {
    const tasks = this.agents.planner.agent.tasks;
    const goalId = this.agents.planner.currentPlan?.goalId;
    const goalTasks = tasks.filter(t => t.parentGoalId === goalId);

    return {
      completedCount: goalTasks.filter(t => t.status === 'completed').length,
      totalCount: goalTasks.length,
      failedCount: goalTasks.filter(t => t.status === 'failed').length,
      replanDepth: this._getReplanDepth(goalTasks),
      maxReplanDepth: this.config.planner?.settings?.maxReplanDepth || 3
    };
  }

  /**
   * Calculate the current replan depth
   */
  _getReplanDepth(tasks) {
    let maxDepth = 0;
    for (const task of tasks) {
      let depth = 0;
      let current = task;
      while (current.parentTaskId) {
        depth++;
        current = tasks.find(t => t.id === current.parentTaskId) || { parentTaskId: null };
      }
      maxDepth = Math.max(maxDepth, depth);
    }
    return maxDepth;
  }

  /**
   * Calculate the depth of a single task in the hierarchy
   * @param {object} task - The task to calculate depth for
   * @returns {number} Depth (0 for root tasks, 1 for subtasks, etc.)
   */
  _getTaskDepth(task) {
    const tasks = this.agents.planner.agent.tasks;
    let depth = 0;
    let current = task;
    while (current.parentTaskId) {
      depth++;
      current = tasks.find(t => t.id === current.parentTaskId) || { parentTaskId: null };
    }
    return depth;
  }

  /**
   * Get parent task for hierarchical context
   * @param {object} task - The task to find parent for
   * @returns {object|null} The parent task or null if none
   */
  _getParentTask(task) {
    if (!task.parentTaskId) return null;
    const tasks = this.agents.planner.agent.tasks;
    return tasks.find(t => t.id === task.parentTaskId) || null;
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
      this._stopPeriodicSnapshots();
      this._snapshot();
    }
  }

  /**
   * Resume execution
   */
  async resume() {
    if (this.status === EXECUTION_STATUS.PAUSED) {
      this.status = EXECUTION_STATUS.RUNNING;
      this._startPeriodicSnapshots();
      // Continue from where we left off
    }
  }

  /**
   * Abort execution
   */
  abort() {
    this.status = EXECUTION_STATUS.ABORTED;
    this._stopPeriodicSnapshots();
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
    // Convert taskAttempts Map to serializable object
    const taskAttemptsObj = {};
    for (const [taskId, attempts] of this.taskAttempts.entries()) {
      taskAttemptsObj[taskId] = attempts;
    }

    agentCore.snapshot({
      executorSessions: agentExecutor.sessions,
      currentPhase: this.currentPhase,
      taskAttempts: taskAttemptsObj,
      pivotCount: this.pivotCount
    });
  }

  /**
   * Start periodic snapshots during execution
   */
  _startPeriodicSnapshots() {
    // Don't start if already running
    if (this.snapshotInterval) return;

    this.snapshotInterval = setInterval(() => {
      if (this.status === EXECUTION_STATUS.RUNNING) {
        this._snapshot();
      }
    }, this.snapshotIntervalMs);
  }

  /**
   * Stop periodic snapshots
   */
  _stopPeriodicSnapshots() {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
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
