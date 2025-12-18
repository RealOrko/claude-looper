/**
 * Multi-Agent Architecture - Core Interfaces and Protocols
 *
 * This file defines the base interfaces for all agents in the orchestration system.
 * The architecture follows a real-world development workflow:
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                           ORCHESTRATION LOOP                                 │
 * │                                                                              │
 * │  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
 * │  │ PLANNER  │───▶│  CODER   │───▶│  TESTER  │───▶│SUPERVISOR│              │
 * │  │ (Opus)   │    │ (Opus)   │    │ (Sonnet) │    │ (Sonnet) │              │
 * │  └──────────┘    └──────────┘    └──────────┘    └──────────┘              │
 * │       │              ▲               │               │                      │
 * │       │              │               │               │                      │
 * │       │         Fix Plan             │          Verify All                  │
 * │       │              │               │               │                      │
 * │       │              └───────────────┘               │                      │
 * │       │                                              │                      │
 * │       │◀─────────── Re-plan Request ─────────────────┘                      │
 * │       │                                                                      │
 * │  Recursive Re-planning (up to 3 levels deep)                                │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Message types for inter-agent communication
 */
export const MessageType = {
  // Planning messages
  PLAN_REQUEST: 'plan_request',
  PLAN_RESPONSE: 'plan_response',
  REPLAN_REQUEST: 'replan_request',
  SUBPLAN_REQUEST: 'subplan_request',
  SUBPLAN_RESPONSE: 'subplan_response',

  // Coding messages
  CODE_REQUEST: 'code_request',
  CODE_RESPONSE: 'code_response',
  CODE_FIX_REQUEST: 'code_fix_request',

  // Testing messages
  TEST_REQUEST: 'test_request',
  TEST_RESPONSE: 'test_response',
  FIX_PLAN: 'fix_plan',

  // Supervision messages
  VERIFY_REQUEST: 'verify_request',
  VERIFY_RESPONSE: 'verify_response',
  CORRECTION: 'correction',
  ESCALATION: 'escalation',

  // Orchestration messages
  STEP_COMPLETE: 'step_complete',
  STEP_BLOCKED: 'step_blocked',
  GOAL_COMPLETE: 'goal_complete',
  ABORT: 'abort',
};

/**
 * Agent roles in the system
 */
export const AgentRole = {
  PLANNER: 'planner',
  CODER: 'coder',
  TESTER: 'tester',
  SUPERVISOR: 'supervisor',
  ORCHESTRATOR: 'orchestrator',
};

/**
 * Agent status states
 */
export const AgentStatus = {
  IDLE: 'idle',
  WORKING: 'working',
  WAITING: 'waiting',
  BLOCKED: 'blocked',
  ERROR: 'error',
};

/**
 * Plan depth levels for recursive re-planning
 */
export const PlanDepth = {
  ROOT: 0,      // Main plan
  LEVEL_1: 1,   // Sub-plan for blocked step
  LEVEL_2: 2,   // Sub-sub-plan
  LEVEL_3: 3,   // Maximum depth - no further recursion
};

/**
 * Verification types for supervisor
 */
export const VerificationType = {
  PLAN: 'plan',
  PLAN_PRE: 'plan_pre',   // Pre-execution plan review
  CODE: 'code',
  TEST: 'test',
  STEP: 'step',
  GOAL: 'goal',
  PROGRESS: 'progress',   // Periodic progress check
};

/**
 * Workflow phases for the development loop
 */
export const WorkflowPhase = {
  INITIALIZING: 'initializing',
  PLANNING: 'planning',
  PLAN_REVIEW: 'plan_review',
  EXECUTING: 'executing',
  TESTING: 'testing',
  FIXING: 'fixing',
  VERIFYING: 'verifying',
  REPLANNING: 'replanning',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ABORTED: 'aborted',
  TIME_EXPIRED: 'time_expired',
};

/**
 * Fix cycle status for test-fix loops
 */
export const FixCycleStatus = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  MAX_ATTEMPTS_REACHED: 'max_attempts_reached',
};

/**
 * Base message structure for inter-agent communication
 */
export class AgentMessage {
  constructor(type, fromAgent, toAgent, payload = {}) {
    this.id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.type = type;
    this.from = fromAgent;
    this.to = toAgent;
    this.payload = payload;
    this.timestamp = Date.now();
    this.correlationId = null; // For request-response matching
  }

  /**
   * Create a response to this message
   */
  createResponse(type, payload) {
    const response = new AgentMessage(type, this.to, this.from, payload);
    response.correlationId = this.id;
    return response;
  }
}

/**
 * Base Agent Interface
 * All agents must implement this interface
 */
export class BaseAgent {
  constructor(role, client, config = {}) {
    this.role = role;
    this.client = client;
    this.config = config;
    this.status = AgentStatus.IDLE;
    this.lastActivity = Date.now();
    this.messageHandlers = new Map();
    this.outputHistory = [];
    this.maxHistorySize = 50;
  }

  /**
   * Get agent identifier
   */
  getId() {
    return `${this.role}_${this.client?.getSessionId() || 'no_session'}`;
  }

  /**
   * Register a message handler
   */
  onMessage(messageType, handler) {
    this.messageHandlers.set(messageType, handler);
  }

  /**
   * Process an incoming message
   */
  async handleMessage(message) {
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      this.status = AgentStatus.WORKING;
      this.lastActivity = Date.now();
      try {
        const result = await handler(message);
        this.recordOutput(message, result);
        return result;
      } finally {
        this.status = AgentStatus.IDLE;
      }
    }
    throw new Error(`No handler for message type: ${message.type}`);
  }

  /**
   * Record output for supervisor verification
   */
  recordOutput(inputMessage, output) {
    this.outputHistory.push({
      timestamp: Date.now(),
      input: inputMessage,
      output,
      verified: false,
    });

    // Trim history
    if (this.outputHistory.length > this.maxHistorySize) {
      this.outputHistory = this.outputHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get unverified outputs for supervisor review
   */
  getUnverifiedOutputs() {
    return this.outputHistory.filter(o => !o.verified);
  }

  /**
   * Mark outputs as verified
   */
  markVerified(outputIds) {
    for (const entry of this.outputHistory) {
      if (outputIds.includes(entry.timestamp)) {
        entry.verified = true;
      }
    }
  }

  /**
   * Abstract method - must be implemented by subclasses
   */
  async execute(task) {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * Get agent statistics
   */
  getStats() {
    return {
      role: this.role,
      status: this.status,
      lastActivity: this.lastActivity,
      outputCount: this.outputHistory.length,
      unverifiedCount: this.getUnverifiedOutputs().length,
    };
  }
}

/**
 * Plan Step structure
 */
export class PlanStep {
  constructor(number, description, complexity = 'medium') {
    this.id = `step_${Date.now()}_${number}`;
    this.number = number;
    this.description = description;
    this.complexity = complexity; // simple, medium, complex
    this.status = 'pending'; // pending, in_progress, completed, failed, blocked
    this.depth = PlanDepth.ROOT;
    this.parentStepId = null;
    this.subSteps = [];
    this.attempts = 0;
    this.maxAttempts = 3;
    this.codeOutput = null;
    this.testResults = null;
    this.verificationResult = null;
    this.failReason = null;
    this.createdAt = Date.now();
    this.completedAt = null;
  }

  /**
   * Check if step can be retried
   */
  canRetry() {
    return this.attempts < this.maxAttempts && this.depth < PlanDepth.LEVEL_3;
  }

  /**
   * Check if step has sub-steps
   */
  hasSubSteps() {
    return this.subSteps.length > 0;
  }

  /**
   * Add a sub-step
   */
  addSubStep(step) {
    step.depth = this.depth + 1;
    step.parentStepId = this.id;
    this.subSteps.push(step);
  }

  /**
   * Get all sub-steps recursively
   */
  getAllSubSteps() {
    const all = [];
    for (const sub of this.subSteps) {
      all.push(sub);
      all.push(...sub.getAllSubSteps());
    }
    return all;
  }
}

/**
 * Execution Plan structure
 */
export class ExecutionPlan {
  constructor(goal, analysis = '') {
    this.id = `plan_${Date.now()}`;
    this.goal = goal;
    this.analysis = analysis;
    this.steps = [];
    this.depth = PlanDepth.ROOT;
    this.parentPlanId = null;
    this.status = 'pending'; // pending, in_progress, completed, failed
    this.currentStepIndex = 0;
    this.createdAt = Date.now();
    this.completedAt = null;
  }

  /**
   * Add a step to the plan
   */
  addStep(description, complexity = 'medium') {
    const step = new PlanStep(this.steps.length + 1, description, complexity);
    step.depth = this.depth;
    this.steps.push(step);
    return step;
  }

  /**
   * Get current step
   */
  getCurrentStep() {
    return this.steps[this.currentStepIndex] || null;
  }

  /**
   * Advance to next step
   */
  advanceStep() {
    if (this.currentStepIndex < this.steps.length) {
      const current = this.steps[this.currentStepIndex];
      current.status = 'completed';
      current.completedAt = Date.now();
      this.currentStepIndex++;
    }
    return this.getCurrentStep();
  }

  /**
   * Check if plan is complete
   */
  isComplete() {
    return this.currentStepIndex >= this.steps.length;
  }

  /**
   * Get progress information
   */
  getProgress() {
    const completed = this.steps.filter(s => s.status === 'completed').length;
    const failed = this.steps.filter(s => s.status === 'failed').length;

    return {
      current: this.currentStepIndex + 1,
      total: this.steps.length,
      completed,
      failed,
      pending: this.steps.length - completed - failed,
      percentComplete: this.steps.length > 0
        ? Math.round((completed / this.steps.length) * 100)
        : 0,
    };
  }
}

/**
 * Test Result structure
 */
export class TestResult {
  constructor(stepId, testType) {
    this.id = `test_${Date.now()}`;
    this.stepId = stepId;
    this.testType = testType; // unit, integration, exploratory
    this.passed = false;
    this.issues = [];
    this.suggestions = [];
    this.coverage = null;
    this.output = '';
    this.fixPlan = null; // If failed, contains fix instructions
    this.timestamp = Date.now();
  }

  /**
   * Add an issue found during testing
   */
  addIssue(severity, description, location = null) {
    this.issues.push({
      id: `issue_${this.issues.length + 1}`,
      severity, // critical, major, minor
      description,
      location, // file:line or function name
    });
  }

  /**
   * Add a suggestion for improvement
   */
  addSuggestion(description, priority = 'medium') {
    this.suggestions.push({
      description,
      priority, // high, medium, low
    });
  }

  /**
   * Generate a fix plan from issues
   */
  generateFixPlan() {
    if (this.issues.length === 0) return null;

    this.fixPlan = {
      id: `fixplan_${Date.now()}`,
      testResultId: this.id,
      issues: this.issues.map(issue => ({
        ...issue,
        fixDescription: `Fix: ${issue.description}`,
      })),
      priority: this.issues.some(i => i.severity === 'critical') ? 'critical' :
                this.issues.some(i => i.severity === 'major') ? 'major' : 'minor',
    };

    return this.fixPlan;
  }
}

/**
 * Verification Result structure
 */
export class VerificationResult {
  constructor(type, targetId) {
    this.id = `verify_${Date.now()}`;
    this.type = type; // plan, code, test, step, goal
    this.targetId = targetId;
    this.verified = false;
    this.score = 0; // 0-100
    this.issues = [];
    this.recommendation = 'continue'; // continue, fix, replan, abort
    this.reason = '';
    this.timestamp = Date.now();
  }

  /**
   * Set verification result
   */
  setResult(verified, score, recommendation, reason) {
    this.verified = verified;
    this.score = score;
    this.recommendation = recommendation;
    this.reason = reason;
  }

  /**
   * Add a verification issue
   */
  addIssue(description, severity = 'warning') {
    this.issues.push({ description, severity });
  }
}

/**
 * Orchestration State - tracks the overall execution state
 */
export class OrchestrationState {
  constructor(primaryGoal) {
    this.id = `orch_${Date.now()}`;
    this.primaryGoal = primaryGoal;
    this.status = 'initializing'; // initializing, planning, executing, testing, verifying, completed, failed, aborted
    this.currentPlan = null;
    this.planStack = []; // For recursive re-planning
    this.currentAgent = null;
    this.iteration = 0;
    this.startTime = Date.now();
    this.endTime = null;

    // Agent states
    this.agents = {
      [AgentRole.PLANNER]: { status: AgentStatus.IDLE, lastOutput: null },
      [AgentRole.CODER]: { status: AgentStatus.IDLE, lastOutput: null },
      [AgentRole.TESTER]: { status: AgentStatus.IDLE, lastOutput: null },
      [AgentRole.SUPERVISOR]: { status: AgentStatus.IDLE, lastOutput: null },
    };

    // Metrics
    this.metrics = {
      totalSteps: 0,
      completedSteps: 0,
      failedSteps: 0,
      replanCount: 0,
      fixCycles: 0,
      verificationsPassed: 0,
      verificationsFailed: 0,
    };

    // Event log
    this.eventLog = [];
    this.maxEventLogSize = 200;
  }

  /**
   * Log an event
   */
  logEvent(type, agent, details = {}) {
    this.eventLog.push({
      timestamp: Date.now(),
      iteration: this.iteration,
      type,
      agent,
      details,
    });

    // Trim event log
    if (this.eventLog.length > this.maxEventLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxEventLogSize);
    }
  }

  /**
   * Update agent state
   */
  updateAgentState(role, status, output = null) {
    if (this.agents[role]) {
      this.agents[role].status = status;
      if (output) {
        this.agents[role].lastOutput = output;
      }
    }
  }

  /**
   * Push a new plan onto the stack (for recursive re-planning)
   */
  pushPlan(plan) {
    if (this.currentPlan) {
      this.planStack.push(this.currentPlan);
    }
    this.currentPlan = plan;
  }

  /**
   * Pop back to parent plan
   */
  popPlan() {
    if (this.planStack.length > 0) {
      this.currentPlan = this.planStack.pop();
      return this.currentPlan;
    }
    return null;
  }

  /**
   * Get current plan depth
   */
  getPlanDepth() {
    return this.planStack.length;
  }

  /**
   * Check if can create sub-plan (max 3 levels)
   */
  canCreateSubPlan() {
    return this.getPlanDepth() < PlanDepth.LEVEL_3;
  }

  /**
   * Get state summary
   */
  getSummary() {
    const elapsed = Date.now() - this.startTime;

    return {
      status: this.status,
      iteration: this.iteration,
      elapsed,
      planDepth: this.getPlanDepth(),
      currentStep: this.currentPlan?.getCurrentStep()?.description || null,
      agents: Object.entries(this.agents).reduce((acc, [role, state]) => {
        acc[role] = state.status;
        return acc;
      }, {}),
      metrics: { ...this.metrics },
    };
  }
}

/**
 * Time Budget Manager - Tracks and allocates time across phases
 */
export class TimeBudgetManager {
  constructor(totalTimeMs) {
    this.totalTime = totalTimeMs;
    this.startTime = Date.now();
    this.phaseAllocations = {
      planning: Math.min(0.1 * totalTimeMs, 15 * 60 * 1000),     // 10% or max 15 min
      execution: 0.8 * totalTimeMs,                               // 80%
      verification: Math.min(0.1 * totalTimeMs, 10 * 60 * 1000),  // 10% or max 10 min
    };
    this.phaseStartTimes = {};
    this.phaseElapsed = {
      planning: 0,
      execution: 0,
      verification: 0,
    };
    this.currentPhase = null;
  }

  /**
   * Start tracking a phase
   */
  startPhase(phase) {
    if (this.currentPhase) {
      this.endPhase();
    }
    this.currentPhase = phase;
    this.phaseStartTimes[phase] = Date.now();
  }

  /**
   * End current phase tracking
   */
  endPhase() {
    if (this.currentPhase && this.phaseStartTimes[this.currentPhase]) {
      this.phaseElapsed[this.currentPhase] +=
        Date.now() - this.phaseStartTimes[this.currentPhase];
    }
    this.currentPhase = null;
  }

  /**
   * Get elapsed time since start
   */
  getElapsed() {
    return Date.now() - this.startTime;
  }

  /**
   * Get remaining time
   */
  getRemaining() {
    return Math.max(0, this.totalTime - this.getElapsed());
  }

  /**
   * Check if time has expired
   */
  isExpired() {
    return this.getElapsed() >= this.totalTime;
  }

  /**
   * Get remaining time for current phase
   */
  getPhaseRemaining(phase) {
    const allocation = this.phaseAllocations[phase] || 0;
    const elapsed = this.phaseElapsed[phase] || 0;
    const currentElapsed = this.currentPhase === phase && this.phaseStartTimes[phase]
      ? Date.now() - this.phaseStartTimes[phase]
      : 0;
    return Math.max(0, allocation - elapsed - currentElapsed);
  }

  /**
   * Calculate time budget per step
   */
  getPerStepBudget(totalSteps) {
    if (totalSteps <= 0) return this.phaseAllocations.execution;
    return Math.floor(this.phaseAllocations.execution / totalSteps);
  }

  /**
   * Get time budget summary
   */
  getSummary() {
    return {
      total: this.totalTime,
      elapsed: this.getElapsed(),
      remaining: this.getRemaining(),
      expired: this.isExpired(),
      percentUsed: Math.round((this.getElapsed() / this.totalTime) * 100),
      phaseElapsed: { ...this.phaseElapsed },
      phaseRemaining: {
        planning: this.getPhaseRemaining('planning'),
        execution: this.getPhaseRemaining('execution'),
        verification: this.getPhaseRemaining('verification'),
      },
    };
  }

  /**
   * Format remaining time for display
   */
  formatRemaining() {
    const remaining = this.getRemaining();
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((remaining % (60 * 1000)) / 1000);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }
}

/**
 * Development Workflow Loop - Tracks the current position in the dev cycle
 */
export class WorkflowLoop {
  constructor() {
    this.phase = WorkflowPhase.INITIALIZING;
    this.cycleCount = 0;
    this.stepCycleCount = 0;
    this.fixCycleCount = 0;
    this.history = [];
    this.maxHistory = 100;
  }

  /**
   * Transition to a new phase
   */
  transition(newPhase, metadata = {}) {
    const transition = {
      from: this.phase,
      to: newPhase,
      timestamp: Date.now(),
      cycle: this.cycleCount,
      metadata,
    };

    this.history.push(transition);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    this.phase = newPhase;

    // Track cycle counts
    if (newPhase === WorkflowPhase.EXECUTING) {
      this.stepCycleCount++;
    } else if (newPhase === WorkflowPhase.FIXING) {
      this.fixCycleCount++;
    } else if (newPhase === WorkflowPhase.PLANNING && this.phase !== WorkflowPhase.INITIALIZING) {
      this.cycleCount++;
    }

    return transition;
  }

  /**
   * Check if in a terminal phase
   */
  isTerminal() {
    return [
      WorkflowPhase.COMPLETED,
      WorkflowPhase.FAILED,
      WorkflowPhase.ABORTED,
      WorkflowPhase.TIME_EXPIRED,
    ].includes(this.phase);
  }

  /**
   * Get workflow summary
   */
  getSummary() {
    return {
      currentPhase: this.phase,
      cycleCount: this.cycleCount,
      stepCycleCount: this.stepCycleCount,
      fixCycleCount: this.fixCycleCount,
      isTerminal: this.isTerminal(),
      recentTransitions: this.history.slice(-10),
    };
  }
}

export default {
  MessageType,
  AgentRole,
  AgentStatus,
  PlanDepth,
  VerificationType,
  WorkflowPhase,
  FixCycleStatus,
  AgentMessage,
  BaseAgent,
  PlanStep,
  ExecutionPlan,
  TestResult,
  VerificationResult,
  OrchestrationState,
  TimeBudgetManager,
  WorkflowLoop,
};
