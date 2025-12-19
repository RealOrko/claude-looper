/**
 * Tests for Orchestration Module
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  OrchestrationState,
  TimeBudgetManager,
  WorkflowLoop,
} from '../orchestration.js';
import { AgentRole, AgentStatus, WorkflowPhase } from '../enums.js';

describe('OrchestrationState', () => {
  let state;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    state = new OrchestrationState('Build a web app');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with primary goal', () => {
      expect(state.primaryGoal).toBe('Build a web app');
    });

    it('should generate unique ID', () => {
      vi.advanceTimersByTime(1); // Advance time to ensure different timestamp
      const state2 = new OrchestrationState('Another goal');
      expect(state.id).toMatch(/^orch_\d+$/);
      expect(state.id).not.toBe(state2.id);
    });

    it('should initialize with status initializing', () => {
      expect(state.status).toBe('initializing');
    });

    it('should initialize with null current plan', () => {
      expect(state.currentPlan).toBeNull();
    });

    it('should initialize empty plan stack', () => {
      expect(state.planStack).toEqual([]);
    });

    it('should initialize all agents as idle', () => {
      expect(state.agents[AgentRole.PLANNER].status).toBe(AgentStatus.IDLE);
      expect(state.agents[AgentRole.CODER].status).toBe(AgentStatus.IDLE);
      expect(state.agents[AgentRole.TESTER].status).toBe(AgentStatus.IDLE);
      expect(state.agents[AgentRole.SUPERVISOR].status).toBe(AgentStatus.IDLE);
    });

    it('should initialize metrics to zero', () => {
      expect(state.metrics.totalSteps).toBe(0);
      expect(state.metrics.completedSteps).toBe(0);
      expect(state.metrics.failedSteps).toBe(0);
      expect(state.metrics.replanCount).toBe(0);
    });

    it('should initialize empty event log', () => {
      expect(state.eventLog).toEqual([]);
    });

    it('should set start time', () => {
      expect(state.startTime).toBeDefined();
      expect(state.endTime).toBeNull();
    });
  });

  describe('logEvent', () => {
    it('should add event to log', () => {
      state.logEvent('step_started', AgentRole.CODER, { stepId: 'step-1' });

      expect(state.eventLog).toHaveLength(1);
      expect(state.eventLog[0].type).toBe('step_started');
      expect(state.eventLog[0].agent).toBe(AgentRole.CODER);
      expect(state.eventLog[0].details.stepId).toBe('step-1');
    });

    it('should include timestamp and iteration', () => {
      state.iteration = 5;
      state.logEvent('test', AgentRole.PLANNER);

      expect(state.eventLog[0].timestamp).toBeDefined();
      expect(state.eventLog[0].iteration).toBe(5);
    });

    it('should trim log when exceeding max size', () => {
      for (let i = 0; i < 250; i++) {
        state.logEvent(`event-${i}`, AgentRole.CODER);
      }

      expect(state.eventLog).toHaveLength(state.maxEventLogSize);
      expect(state.eventLog[0].type).toBe('event-50');
    });
  });

  describe('updateAgentState', () => {
    it('should update agent status', () => {
      state.updateAgentState(AgentRole.CODER, AgentStatus.WORKING);

      expect(state.agents[AgentRole.CODER].status).toBe(AgentStatus.WORKING);
    });

    it('should update agent output when provided', () => {
      state.updateAgentState(AgentRole.PLANNER, AgentStatus.COMPLETED, { plan: 'test' });

      expect(state.agents[AgentRole.PLANNER].lastOutput).toEqual({ plan: 'test' });
    });

    it('should not update output when not provided', () => {
      state.agents[AgentRole.CODER].lastOutput = { existing: true };
      state.updateAgentState(AgentRole.CODER, AgentStatus.WORKING);

      expect(state.agents[AgentRole.CODER].lastOutput).toEqual({ existing: true });
    });

    it('should ignore unknown roles', () => {
      state.updateAgentState('unknown_role', AgentStatus.WORKING);
      // Should not throw
      expect(state.agents['unknown_role']).toBeUndefined();
    });
  });

  describe('pushPlan', () => {
    it('should set current plan when stack is empty', () => {
      const plan = { id: 'plan-1' };
      state.pushPlan(plan);

      expect(state.currentPlan).toBe(plan);
      expect(state.planStack).toEqual([]);
    });

    it('should push current plan to stack and set new plan', () => {
      const plan1 = { id: 'plan-1' };
      const plan2 = { id: 'plan-2' };

      state.pushPlan(plan1);
      state.pushPlan(plan2);

      expect(state.currentPlan).toBe(plan2);
      expect(state.planStack).toEqual([plan1]);
    });

    it('should support multiple nested plans', () => {
      const plan1 = { id: 'plan-1' };
      const plan2 = { id: 'plan-2' };
      const plan3 = { id: 'plan-3' };

      state.pushPlan(plan1);
      state.pushPlan(plan2);
      state.pushPlan(plan3);

      expect(state.currentPlan).toBe(plan3);
      expect(state.planStack).toHaveLength(2);
    });
  });

  describe('popPlan', () => {
    it('should return null when stack is empty', () => {
      const result = state.popPlan();
      expect(result).toBeNull();
    });

    it('should restore previous plan from stack', () => {
      const plan1 = { id: 'plan-1' };
      const plan2 = { id: 'plan-2' };

      state.pushPlan(plan1);
      state.pushPlan(plan2);
      const restored = state.popPlan();

      expect(restored).toBe(plan1);
      expect(state.currentPlan).toBe(plan1);
    });

    it('should pop multiple levels', () => {
      const plan1 = { id: 'plan-1' };
      const plan2 = { id: 'plan-2' };
      const plan3 = { id: 'plan-3' };

      state.pushPlan(plan1);
      state.pushPlan(plan2);
      state.pushPlan(plan3);

      state.popPlan();
      expect(state.currentPlan.id).toBe('plan-2');

      state.popPlan();
      expect(state.currentPlan.id).toBe('plan-1');

      // After popping all sub-plans, stack is empty but currentPlan is plan-1
      // One more pop returns null (no more in stack) but currentPlan remains
      const result = state.popPlan();
      expect(result).toBeNull();
    });
  });

  describe('getPlanDepth', () => {
    it('should return 0 when no plans', () => {
      expect(state.getPlanDepth()).toBe(0);
    });

    it('should return stack length', () => {
      state.pushPlan({ id: 'plan-1' });
      expect(state.getPlanDepth()).toBe(0);

      state.pushPlan({ id: 'plan-2' });
      expect(state.getPlanDepth()).toBe(1);

      state.pushPlan({ id: 'plan-3' });
      expect(state.getPlanDepth()).toBe(2);
    });
  });

  describe('canCreateSubPlan', () => {
    it('should return true at level 0', () => {
      expect(state.canCreateSubPlan()).toBe(true);
    });

    it('should return true at level 1', () => {
      state.pushPlan({ id: 'plan-1' });
      state.pushPlan({ id: 'plan-2' });
      expect(state.canCreateSubPlan()).toBe(true);
    });

    it('should return true at level 2', () => {
      state.pushPlan({ id: 'plan-1' });
      state.pushPlan({ id: 'plan-2' });
      state.pushPlan({ id: 'plan-3' });
      expect(state.canCreateSubPlan()).toBe(true);
    });

    it('should return false at level 3', () => {
      state.pushPlan({ id: 'plan-1' });
      state.pushPlan({ id: 'plan-2' });
      state.pushPlan({ id: 'plan-3' });
      state.pushPlan({ id: 'plan-4' });
      expect(state.canCreateSubPlan()).toBe(false);
    });
  });

  describe('getSummary', () => {
    it('should return summary object', () => {
      const summary = state.getSummary();

      expect(summary).toHaveProperty('status');
      expect(summary).toHaveProperty('iteration');
      expect(summary).toHaveProperty('elapsed');
      expect(summary).toHaveProperty('planDepth');
      expect(summary).toHaveProperty('agents');
      expect(summary).toHaveProperty('metrics');
    });

    it('should calculate elapsed time', () => {
      vi.advanceTimersByTime(5000);
      const summary = state.getSummary();

      expect(summary.elapsed).toBe(5000);
    });

    it('should return agent statuses', () => {
      state.updateAgentState(AgentRole.CODER, AgentStatus.WORKING);
      const summary = state.getSummary();

      expect(summary.agents[AgentRole.CODER]).toBe(AgentStatus.WORKING);
    });

    it('should return current step description when plan exists', () => {
      const mockPlan = {
        getCurrentStep: () => ({ description: 'Test step' }),
      };
      state.currentPlan = mockPlan;

      const summary = state.getSummary();
      expect(summary.currentStep).toBe('Test step');
    });

    it('should return null for currentStep when no plan', () => {
      const summary = state.getSummary();
      expect(summary.currentStep).toBeNull();
    });
  });
});

describe('TimeBudgetManager', () => {
  let manager;
  const ONE_HOUR = 60 * 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    manager = new TimeBudgetManager(ONE_HOUR);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should set total time', () => {
      expect(manager.totalTime).toBe(ONE_HOUR);
    });

    it('should set start time', () => {
      expect(manager.startTime).toBeDefined();
    });

    it('should calculate phase allocations', () => {
      expect(manager.phaseAllocations.planning).toBeDefined();
      expect(manager.phaseAllocations.execution).toBeDefined();
      expect(manager.phaseAllocations.verification).toBeDefined();
    });

    it('should cap planning allocation at 15 minutes', () => {
      const longManager = new TimeBudgetManager(24 * ONE_HOUR);
      expect(longManager.phaseAllocations.planning).toBe(15 * 60 * 1000);
    });

    it('should cap verification allocation at 10 minutes', () => {
      const longManager = new TimeBudgetManager(24 * ONE_HOUR);
      expect(longManager.phaseAllocations.verification).toBe(10 * 60 * 1000);
    });

    it('should allocate 80% to execution', () => {
      expect(manager.phaseAllocations.execution).toBe(0.8 * ONE_HOUR);
    });

    it('should initialize phase elapsed to 0', () => {
      expect(manager.phaseElapsed.planning).toBe(0);
      expect(manager.phaseElapsed.execution).toBe(0);
      expect(manager.phaseElapsed.verification).toBe(0);
    });
  });

  describe('startPhase', () => {
    it('should set current phase', () => {
      manager.startPhase('planning');
      expect(manager.currentPhase).toBe('planning');
    });

    it('should record phase start time', () => {
      manager.startPhase('execution');
      expect(manager.phaseStartTimes['execution']).toBeDefined();
    });

    it('should end previous phase before starting new one', () => {
      manager.startPhase('planning');
      vi.advanceTimersByTime(1000);
      manager.startPhase('execution');

      expect(manager.phaseElapsed.planning).toBe(1000);
      expect(manager.currentPhase).toBe('execution');
    });
  });

  describe('endPhase', () => {
    it('should calculate elapsed time for phase', () => {
      manager.startPhase('planning');
      vi.advanceTimersByTime(5000);
      manager.endPhase();

      expect(manager.phaseElapsed.planning).toBe(5000);
    });

    it('should set current phase to null', () => {
      manager.startPhase('planning');
      manager.endPhase();

      expect(manager.currentPhase).toBeNull();
    });

    it('should do nothing if no current phase', () => {
      manager.endPhase();
      expect(manager.currentPhase).toBeNull();
    });

    it('should accumulate elapsed time', () => {
      manager.startPhase('planning');
      vi.advanceTimersByTime(1000);
      manager.endPhase();

      manager.startPhase('planning');
      vi.advanceTimersByTime(2000);
      manager.endPhase();

      expect(manager.phaseElapsed.planning).toBe(3000);
    });
  });

  describe('getElapsed', () => {
    it('should return time since start', () => {
      vi.advanceTimersByTime(30000);
      expect(manager.getElapsed()).toBe(30000);
    });
  });

  describe('getRemaining', () => {
    it('should return remaining time', () => {
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(manager.getRemaining()).toBe(50 * 60 * 1000);
    });

    it('should return 0 when time is exceeded', () => {
      vi.advanceTimersByTime(2 * ONE_HOUR);
      expect(manager.getRemaining()).toBe(0);
    });
  });

  describe('isExpired', () => {
    it('should return false when time remains', () => {
      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(manager.isExpired()).toBe(false);
    });

    it('should return true when time is exceeded', () => {
      vi.advanceTimersByTime(ONE_HOUR + 1000);
      expect(manager.isExpired()).toBe(true);
    });

    it('should return true when exactly at limit', () => {
      vi.advanceTimersByTime(ONE_HOUR);
      expect(manager.isExpired()).toBe(true);
    });
  });

  describe('getPhaseRemaining', () => {
    it('should return full allocation when not started', () => {
      expect(manager.getPhaseRemaining('execution')).toBe(0.8 * ONE_HOUR);
    });

    it('should subtract elapsed time', () => {
      manager.startPhase('execution');
      vi.advanceTimersByTime(10 * 60 * 1000);
      manager.endPhase();

      expect(manager.getPhaseRemaining('execution')).toBe(0.8 * ONE_HOUR - 10 * 60 * 1000);
    });

    it('should include current phase time', () => {
      manager.startPhase('execution');
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(manager.getPhaseRemaining('execution')).toBe(0.8 * ONE_HOUR - 10 * 60 * 1000);
    });

    it('should return 0 for unknown phase', () => {
      expect(manager.getPhaseRemaining('unknown')).toBe(0);
    });

    it('should not go negative', () => {
      manager.startPhase('planning');
      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(manager.getPhaseRemaining('planning')).toBe(0);
    });
  });

  describe('getPerStepBudget', () => {
    it('should divide execution time by steps', () => {
      const budget = manager.getPerStepBudget(10);
      expect(budget).toBe(Math.floor(0.8 * ONE_HOUR / 10));
    });

    it('should return full execution time for 0 steps', () => {
      expect(manager.getPerStepBudget(0)).toBe(0.8 * ONE_HOUR);
    });

    it('should return full execution time for negative steps', () => {
      expect(manager.getPerStepBudget(-5)).toBe(0.8 * ONE_HOUR);
    });
  });

  describe('getSummary', () => {
    it('should return complete summary', () => {
      manager.startPhase('planning');
      vi.advanceTimersByTime(5 * 60 * 1000);

      const summary = manager.getSummary();

      expect(summary.total).toBe(ONE_HOUR);
      expect(summary.elapsed).toBe(5 * 60 * 1000);
      expect(summary.remaining).toBe(55 * 60 * 1000);
      expect(summary.expired).toBe(false);
      expect(summary.percentUsed).toBeGreaterThan(0);
      expect(summary.phaseElapsed).toBeDefined();
      expect(summary.phaseRemaining).toBeDefined();
    });

    it('should calculate correct percent used', () => {
      vi.advanceTimersByTime(30 * 60 * 1000);
      const summary = manager.getSummary();

      expect(summary.percentUsed).toBe(50);
    });
  });

  describe('formatRemaining', () => {
    it('should format hours and minutes', () => {
      const longManager = new TimeBudgetManager(3 * ONE_HOUR);
      expect(longManager.formatRemaining()).toBe('3h 0m');
    });

    it('should format minutes and seconds', () => {
      vi.advanceTimersByTime(ONE_HOUR - 5 * 60 * 1000);
      expect(manager.formatRemaining()).toBe('5m 0s');
    });

    it('should format only seconds when less than a minute', () => {
      vi.advanceTimersByTime(ONE_HOUR - 30 * 1000);
      expect(manager.formatRemaining()).toBe('30s');
    });

    it('should show 0s when expired', () => {
      vi.advanceTimersByTime(2 * ONE_HOUR);
      expect(manager.formatRemaining()).toBe('0s');
    });
  });
});

describe('WorkflowLoop', () => {
  let loop;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    loop = new WorkflowLoop();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with INITIALIZING phase', () => {
      expect(loop.phase).toBe(WorkflowPhase.INITIALIZING);
    });

    it('should initialize counts to 0', () => {
      expect(loop.cycleCount).toBe(0);
      expect(loop.stepCycleCount).toBe(0);
      expect(loop.fixCycleCount).toBe(0);
    });

    it('should initialize empty history', () => {
      expect(loop.history).toEqual([]);
    });
  });

  describe('transition', () => {
    it('should update phase', () => {
      loop.transition(WorkflowPhase.PLANNING);
      expect(loop.phase).toBe(WorkflowPhase.PLANNING);
    });

    it('should record transition in history', () => {
      loop.transition(WorkflowPhase.PLANNING);

      expect(loop.history).toHaveLength(1);
      expect(loop.history[0].from).toBe(WorkflowPhase.INITIALIZING);
      expect(loop.history[0].to).toBe(WorkflowPhase.PLANNING);
    });

    it('should include timestamp in transition', () => {
      loop.transition(WorkflowPhase.PLANNING);
      expect(loop.history[0].timestamp).toBeDefined();
    });

    it('should include metadata in transition', () => {
      loop.transition(WorkflowPhase.EXECUTING, { stepId: 'step-1' });
      expect(loop.history[0].metadata.stepId).toBe('step-1');
    });

    it('should increment stepCycleCount on EXECUTING', () => {
      loop.transition(WorkflowPhase.EXECUTING);
      expect(loop.stepCycleCount).toBe(1);

      loop.transition(WorkflowPhase.VERIFYING);
      loop.transition(WorkflowPhase.EXECUTING);
      expect(loop.stepCycleCount).toBe(2);
    });

    it('should increment fixCycleCount on FIXING', () => {
      loop.transition(WorkflowPhase.FIXING);
      expect(loop.fixCycleCount).toBe(1);

      loop.transition(WorkflowPhase.VERIFYING);
      loop.transition(WorkflowPhase.FIXING);
      expect(loop.fixCycleCount).toBe(2);
    });

    it('should return transition object', () => {
      const transition = loop.transition(WorkflowPhase.PLANNING);

      expect(transition.from).toBe(WorkflowPhase.INITIALIZING);
      expect(transition.to).toBe(WorkflowPhase.PLANNING);
      expect(transition.cycle).toBe(0);
    });

    it('should limit history to maxHistory', () => {
      for (let i = 0; i < 150; i++) {
        loop.transition(i % 2 === 0 ? WorkflowPhase.EXECUTING : WorkflowPhase.VERIFYING);
      }

      expect(loop.history).toHaveLength(loop.maxHistory);
    });
  });

  describe('isTerminal', () => {
    it('should return false for non-terminal phases', () => {
      expect(loop.isTerminal()).toBe(false);

      loop.transition(WorkflowPhase.PLANNING);
      expect(loop.isTerminal()).toBe(false);

      loop.transition(WorkflowPhase.EXECUTING);
      expect(loop.isTerminal()).toBe(false);

      loop.transition(WorkflowPhase.VERIFYING);
      expect(loop.isTerminal()).toBe(false);

      loop.transition(WorkflowPhase.FIXING);
      expect(loop.isTerminal()).toBe(false);
    });

    it('should return true for COMPLETED', () => {
      loop.transition(WorkflowPhase.COMPLETED);
      expect(loop.isTerminal()).toBe(true);
    });

    it('should return true for FAILED', () => {
      loop.transition(WorkflowPhase.FAILED);
      expect(loop.isTerminal()).toBe(true);
    });

    it('should return true for ABORTED', () => {
      loop.transition(WorkflowPhase.ABORTED);
      expect(loop.isTerminal()).toBe(true);
    });

    it('should return true for TIME_EXPIRED', () => {
      loop.transition(WorkflowPhase.TIME_EXPIRED);
      expect(loop.isTerminal()).toBe(true);
    });
  });

  describe('getSummary', () => {
    it('should return summary object', () => {
      loop.transition(WorkflowPhase.PLANNING);
      loop.transition(WorkflowPhase.EXECUTING);

      const summary = loop.getSummary();

      expect(summary.currentPhase).toBe(WorkflowPhase.EXECUTING);
      // cycleCount is 1 because the implementation checks `this.phase` after it's been updated
      // so when transitioning to PLANNING, it checks if PLANNING !== INITIALIZING (always true)
      expect(summary.cycleCount).toBe(1);
      expect(summary.stepCycleCount).toBe(1);
      expect(summary.fixCycleCount).toBe(0);
      expect(summary.isTerminal).toBe(false);
      expect(summary.recentTransitions).toHaveLength(2);
    });

    it('should return last 10 transitions', () => {
      for (let i = 0; i < 20; i++) {
        loop.transition(WorkflowPhase.EXECUTING);
        loop.transition(WorkflowPhase.VERIFYING);
      }

      const summary = loop.getSummary();
      expect(summary.recentTransitions).toHaveLength(10);
    });
  });
});
