/**
 * Orchestration Types
 *
 * Defines OrchestrationState, TimeBudgetManager, and WorkflowLoop classes.
 */

import { AgentRole, AgentStatus, PlanDepth, WorkflowPhase } from './enums.js';

/**
 * Orchestration State - tracks the overall execution state
 */
export class OrchestrationState {
  constructor(primaryGoal) {
    this.id = `orch_${Date.now()}`;
    this.primaryGoal = primaryGoal;
    this.status = 'initializing';
    this.currentPlan = null;
    this.planStack = [];
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
   * Push a new plan onto the stack
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
   * Check if can create sub-plan
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
      planning: Math.min(0.1 * totalTimeMs, 15 * 60 * 1000),
      execution: 0.8 * totalTimeMs,
      verification: Math.min(0.1 * totalTimeMs, 10 * 60 * 1000),
    };
    this.phaseStartTimes = {};
    this.phaseElapsed = {
      planning: 0,
      execution: 0,
      verification: 0,
    };
    this.currentPhase = null;
  }

  /** Start tracking a phase */
  startPhase(phase) {
    if (this.currentPhase) {
      this.endPhase();
    }
    this.currentPhase = phase;
    this.phaseStartTimes[phase] = Date.now();
  }

  /** End current phase tracking */
  endPhase() {
    if (this.currentPhase && this.phaseStartTimes[this.currentPhase]) {
      this.phaseElapsed[this.currentPhase] +=
        Date.now() - this.phaseStartTimes[this.currentPhase];
    }
    this.currentPhase = null;
  }

  /** Get elapsed time since start */
  getElapsed() {
    return Date.now() - this.startTime;
  }

  /** Get remaining time */
  getRemaining() {
    return Math.max(0, this.totalTime - this.getElapsed());
  }

  /** Check if time has expired */
  isExpired() {
    return this.getElapsed() >= this.totalTime;
  }

  /** Get remaining time for current phase */
  getPhaseRemaining(phase) {
    const allocation = this.phaseAllocations[phase] || 0;
    const elapsed = this.phaseElapsed[phase] || 0;
    const currentElapsed = this.currentPhase === phase && this.phaseStartTimes[phase]
      ? Date.now() - this.phaseStartTimes[phase]
      : 0;
    return Math.max(0, allocation - elapsed - currentElapsed);
  }

  /** Calculate time budget per step */
  getPerStepBudget(totalSteps) {
    if (totalSteps <= 0) return this.phaseAllocations.execution;
    return Math.floor(this.phaseAllocations.execution / totalSteps);
  }

  /** Get time budget summary */
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

  /** Format remaining time for display */
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

  /** Transition to a new phase */
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

    if (newPhase === WorkflowPhase.EXECUTING) {
      this.stepCycleCount++;
    } else if (newPhase === WorkflowPhase.FIXING) {
      this.fixCycleCount++;
    } else if (newPhase === WorkflowPhase.PLANNING && this.phase !== WorkflowPhase.INITIALIZING) {
      this.cycleCount++;
    }

    return transition;
  }

  /** Check if in a terminal phase */
  isTerminal() {
    return [
      WorkflowPhase.COMPLETED,
      WorkflowPhase.FAILED,
      WorkflowPhase.ABORTED,
      WorkflowPhase.TIME_EXPIRED,
    ].includes(this.phase);
  }

  /** Get workflow summary */
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
  OrchestrationState,
  TimeBudgetManager,
  WorkflowLoop,
};
