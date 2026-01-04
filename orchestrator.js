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

    // Initialize agents - need to handle already-registered agents
    this._initializeAgentsForResume();

    // Restore planner tasks and currentPlan from saved state
    const plannerState = state.agents?.planner;
    if (plannerState && this.agents.planner) {
      // The agent.tasks reference already points to agentCore.agents['planner'].tasks
      // which was restored by loadSnapshot(), so we just need to set currentPlan

      const tasks = plannerState.tasks || [];
      const activeGoal = plannerState.goals?.find(g => g.status === 'active');
      const goal = activeGoal || plannerState.goals?.[0];

      if (goal) {
        this.agents.planner.currentPlan = {
          goalId: goal.id,
          goal: this.goal,
          tasks: tasks,
          createdAt: state.timestamp
        };
        this._log(`[Orchestrator] Restored plan with goalId: ${goal.id}`);
      } else if (tasks.length > 0) {
        // No goal found but we have tasks - use the first task's parentGoalId
        const firstTask = tasks[0];
        const goalId = firstTask?.parentGoalId || `goal-resumed-${Date.now()}`;
        this.agents.planner.currentPlan = {
          goalId,
          goal: this.goal,
          tasks: tasks,
          createdAt: state.timestamp
        };
        this._log(`[Orchestrator] Restored plan using task's parentGoalId: ${goalId}`);
      } else {
        this._log(`[Orchestrator] Warning: No goals or tasks found in saved state`);
      }
    }

    // Reset failed, in-progress, and orphaned blocked tasks for retry
    const resetResult = agentCore.resetFailedTasks('planner');
    if (resetResult.resetCount > 0 || resetResult.blockedReset > 0) {
      this._log(`[Orchestrator] Reset ${resetResult.resetCount} failed/in-progress tasks, ${resetResult.blockedReset} orphaned blocked tasks`);
    }

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
   * Get the root task ID for a given task (walks up the parent chain)
   * @param {object} task - The task to find root for
   * @returns {string|null} The root task ID or null
   */
  _getRootTaskId(task) {
    if (!task) return null;
    const tasks = this.agents.planner.agent.tasks;
    let current = task;
    while (current.parentTaskId) {
      const parent = tasks.find(t => t.id === current.parentTaskId);
      if (!parent) break;
      current = parent;
    }
    return current.id;
  }

  /**
   * Execute the main execution phase
   */
  async _executeExecutionPhase(plan) {
    this._log(`[Orchestrator] Starting execution phase`);

    // Track the current root task to detect transitions between parent-level tasks
    let currentRootTaskId = null;

    // Loop until all tasks are complete or supervisor says to stop
    while (true) {
      const goalId = this.agents.planner.currentPlan?.goalId;

      // Check for failed tasks FIRST - must handle failures before moving to siblings
      // This ensures retry logic (maxStepAttempts) is respected before proceeding
      const failedTasks = this.agents.planner.agent.tasks.filter(
        t => t.status === 'failed' && t.parentGoalId === goalId
      );

      if (failedTasks.length > 0) {
        const failedTask = failedTasks[0];
        this._log(`[Orchestrator] Diagnosing failed task: ${failedTask.description}`);

        const diagnosis = await this._diagnoseAndHandle(failedTask);

        if (diagnosis.stop) {
          this._log(`[Orchestrator] Stopping: ${diagnosis.reason}`);
          break;
        }

        // Continue the loop - diagnosis may have reset task to pending or created subtasks
        continue;
      }

      // Get next pending task
      let task = this.agents.planner.getNextTask();

      if (!task) {
        this._log(`[Orchestrator] All tasks completed`);
        break;
      }

      // Proactively break down complex tasks before executing
      // Respect maxReplanDepth to prevent unlimited nesting
      const maxReplanDepth = this.config.planner?.settings?.maxReplanDepth ?? 3;
      const taskDepth = this._getTaskDepth(task);

      if (task.metadata?.complexity === 'complex' &&
          (!task.subtasks || task.subtasks.length === 0) &&
          taskDepth < maxReplanDepth) {
        this._log(`[Orchestrator] ${task.metadata.complexity} task at depth ${taskDepth} detected, breaking into subtasks: ${task.description}`);
        await this.agents.planner.replan(task, `Proactive breakdown of ${task.metadata.complexity} task`);
        // Continue loop to pick up the new subtasks
        continue;
      } else if (task.metadata?.complexity === 'complex' &&
                 (!task.subtasks || task.subtasks.length === 0) &&
                 taskDepth >= maxReplanDepth) {
        this._log(`[Orchestrator] Skipping proactive breakdown: depth ${taskDepth} >= max ${maxReplanDepth}. Executing ${task.metadata.complexity} task directly.`);
      }

      // Check if we're transitioning to a new root-level task
      const taskRootId = this._getRootTaskId(task);
      if (currentRootTaskId && taskRootId !== currentRootTaskId) {
        this._log(`[Orchestrator] Transitioning to new parent task, resetting sessions`);
        agentExecutor.resetAllSessions();
      }
      currentRootTaskId = taskRootId;

      this._log(`[Orchestrator] Executing task: ${task.description}`);

      // Update task status
      agentCore.updateTask('planner', task.id, { status: 'in_progress' });

      // Execute task with fix cycle
      const result = await this._executeTaskWithFixCycle(task);

      if (result.success) {
        this.agents.planner.markTaskComplete(task.id, { completedAt: Date.now() });
      } else {
        // Record this attempt with files modified for drift detection
        this._recordAttempt(task.id, {
          approach: result.approach,
          result: result.result,
          error: result.error,
          filesModified: result.filesModified || []
        });

        // Record failure pattern for cross-task learning
        agentCore.recordFailurePattern(
          task.description,
          result.error || 'Unknown failure',
          'pending'
        );

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
   *
   * Simplified escalation chain: RETRY -> REPLAN -> IMPOSSIBLE
   * - Retry up to maxStepAttempts (3) times per replan level
   * - Replan up to maxReplanDepth (3) levels deep
   * - Then mark as IMPOSSIBLE
   *
   * Clamp-down logic ensures we always exhaust lower-level options before escalating:
   * - Must exhaust retries before replanning
   * - Must exhaust replans before marking impossible
   *
   * @returns {object} { stop: boolean, reason?: string }
   */
  async _diagnoseAndHandle(task) {
    const attempts = this._getAttemptHistory(task.id);
    const state = this._getDiagnosisState();

    // Calculate hard limits
    const maxAttempts = this.config.execution.maxStepAttempts || 3;
    const maxReplanDepth = this.config.planner?.settings?.maxReplanDepth || 3;
    const retriesExhausted = attempts.length >= maxAttempts;
    const replanDepthExhausted = state.replanDepth >= maxReplanDepth;

    // Get diagnosis from supervisor for reasoning/feedback (but we enforce escalation rules)
    const diagnosis = await this.agents.supervisor.diagnose({
      goal: this.goal,
      task,
      parentTask: this._getParentTask(task),  // Hierarchical context
      attempts,
      ...state
    });

    this._log(`[Orchestrator] Diagnosis: ${diagnosis.decision} - ${diagnosis.reasoning}`);

    // Determine effective decision with CLAMP-DOWN enforcement
    // Escalation chain: RETRY -> REPLAN -> IMPOSSIBLE
    // We enforce minimum thresholds - can't skip steps even if supervisor suggests it
    let effectiveDecision = diagnosis.decision;

    // CLAMP DOWN: Must exhaust retries before allowing replan or impossible
    if (!retriesExhausted &&
        (effectiveDecision === DIAGNOSIS_DECISIONS.REPLAN ||
         effectiveDecision === DIAGNOSIS_DECISIONS.IMPOSSIBLE)) {
      this._log(`[Orchestrator] Clamping ${effectiveDecision} → RETRY: only ${attempts.length}/${maxAttempts} attempts used`);
      effectiveDecision = DIAGNOSIS_DECISIONS.RETRY;
    }

    // CLAMP DOWN: Must exhaust replans before allowing impossible
    if (retriesExhausted && !replanDepthExhausted &&
        effectiveDecision === DIAGNOSIS_DECISIONS.IMPOSSIBLE) {
      this._log(`[Orchestrator] Clamping IMPOSSIBLE → REPLAN: only depth ${state.replanDepth}/${maxReplanDepth} used`);
      effectiveDecision = DIAGNOSIS_DECISIONS.REPLAN;
    }

    // ESCALATE UP: If retries exhausted, escalate RETRY to REPLAN
    if (effectiveDecision === DIAGNOSIS_DECISIONS.RETRY && retriesExhausted) {
      this._log(`[Orchestrator] RETRY exhausted: ${attempts.length} attempts >= max ${maxAttempts}. Escalating to REPLAN.`);
      effectiveDecision = DIAGNOSIS_DECISIONS.REPLAN;
    }

    // ESCALATE UP: If replans exhausted, escalate REPLAN to IMPOSSIBLE
    if (effectiveDecision === DIAGNOSIS_DECISIONS.REPLAN && replanDepthExhausted) {
      this._log(`[Orchestrator] REPLAN exhausted: depth ${state.replanDepth} >= max ${maxReplanDepth}. Escalating to IMPOSSIBLE.`);
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
        // Update failure pattern resolution
        this._updateFailurePatternResolution(task.description, 'Replanned into subtasks');
        return { stop: false };

      case DIAGNOSIS_DECISIONS.IMPOSSIBLE:
        // Task cannot be achieved - all recovery options exhausted
        const blockers = diagnosis.blockers?.join(', ') ||
          `Exhausted all recovery options (${attempts.length} retries, depth ${state.replanDepth} replans)`;
        this._log(`[Orchestrator] Task impossible: ${blockers}`);
        return { stop: true, reason: `Task impossible: ${blockers}` };

      default:
        // Unknown decision - apply clamp-down logic
        this._log(`[Orchestrator] Unknown diagnosis decision: ${diagnosis.decision}, applying escalation rules`);
        if (!retriesExhausted) {
          this._log(`[Orchestrator] Defaulting to RETRY (${attempts.length + 1}/${maxAttempts})`);
          agentCore.updateTask('planner', task.id, { status: 'pending' });
          return { stop: false };
        }
        if (!replanDepthExhausted) {
          this._log(`[Orchestrator] Defaulting to REPLAN (depth ${state.replanDepth + 1}/${maxReplanDepth})`);
          await this.agents.planner.replan(task, diagnosis.reasoning);
          return { stop: false };
        }
        this._log(`[Orchestrator] All recovery options exhausted. Marking as IMPOSSIBLE.`);
        return { stop: true, reason: 'Exhausted all recovery options' };
    }
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
        result: 'blocked',
        filesModified: implementation.filesModified || []
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
          result: 'blocked',
          filesModified: [...(implementation.filesModified || []), ...(fix.filesModified || [])]
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
          result: 'rejected by supervisor',
          filesModified: implementation.filesModified || []
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
      result: 'tests still failing',
      filesModified: implementation.filesModified || []
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

    // Generate a concise issues summary from the error
    const issuesSummary = this._summarizeIssues(attemptInfo.error);

    attempts.push({
      attemptNumber: attempts.length + 1,
      ...attemptInfo,
      issuesSummary,
      timestamp: Date.now()
    });
  }

  /**
   * Update resolution for a failure pattern
   * @param {string} taskDescription - Description of the task
   * @param {string} resolution - How it was resolved
   */
  _updateFailurePatternResolution(taskDescription, resolution) {
    const patterns = agentCore.failurePatterns.filter(
      p => p.taskDescription === taskDescription && p.resolution === 'pending'
    );
    for (const pattern of patterns) {
      pattern.resolution = resolution;
    }
  }

  /**
   * Generate a concise summary of issues from error feedback
   * @param {string} error - Full error/feedback text
   * @returns {string} Concise summary (max 100 chars)
   */
  _summarizeIssues(error) {
    if (!error) return 'Unknown';

    // Extract key phrases from common error patterns
    const patterns = [
      /missing[:\s]+([^.]+)/i,
      /failed[:\s]+([^.]+)/i,
      /error[:\s]+([^.]+)/i,
      /rejected[:\s]+([^.]+)/i,
      /not[:\s]+([^.]+)/i,
      /incorrect[:\s]+([^.]+)/i,
      /incomplete[:\s]+([^.]+)/i
    ];

    for (const pattern of patterns) {
      const match = error.match(pattern);
      if (match && match[1]) {
        const summary = match[1].trim().substring(0, 80);
        return summary.length < match[1].trim().length ? summary + '...' : summary;
      }
    }

    // Fallback: first 80 chars of error
    const truncated = error.substring(0, 80).trim();
    return error.length > 80 ? truncated + '...' : truncated;
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
      taskAttempts: taskAttemptsObj
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
