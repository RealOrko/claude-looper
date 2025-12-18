/**
 * Tests for orchestrator.js - Main execution loop
 *
 * Note: These tests focus on unit testing the Orchestrator's logic
 * without requiring the full message bus request-response patterns.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import {
  AgentRole,
  MessageType,
  PlanDepth,
  ExecutionPlan,
  PlanStep,
  AgentMessage,
  WorkflowPhase,
  TimeBudgetManager,
  WorkflowLoop,
  VerificationType,
} from '../interfaces.js';
import { QualityGateType } from '../supervisor-agent.js';

// Create mock agent that returns proper responses
function createMockAgent(role) {
  return {
    role,
    status: 'idle',
    handleMessage: vi.fn(async (msg) => {
      // Return a proper response based on message type
      return msg.createResponse(
        msg.type.replace('_request', '_response').replace('_REQUEST', '_RESPONSE'),
        { success: true }
      );
    }),
    getId: () => `${role}-agent`,
    getStats: () => ({ role, status: 'idle' }),
  };
}

describe('Orchestrator', () => {
  let orchestrator;
  let mockPlanner;
  let mockCoder;
  let mockTester;
  let mockSupervisor;

  beforeEach(() => {
    orchestrator = new Orchestrator({
      maxFixCycles: 2,
      maxStepAttempts: 2,
      timeLimit: 60000,
      verifyAllOutputs: false, // Disable verification for simpler tests
    });

    mockPlanner = createMockAgent(AgentRole.PLANNER);
    mockCoder = createMockAgent(AgentRole.CODER);
    mockTester = createMockAgent(AgentRole.TESTER);
    mockSupervisor = createMockAgent(AgentRole.SUPERVISOR);

    orchestrator.registerAgents({
      [AgentRole.PLANNER]: mockPlanner,
      [AgentRole.CODER]: mockCoder,
      [AgentRole.TESTER]: mockTester,
      [AgentRole.SUPERVISOR]: mockSupervisor,
    });
  });

  describe('Initialization', () => {
    it('should initialize with a goal', async () => {
      const state = await orchestrator.initialize('Build a web app');

      expect(state.primaryGoal).toBe('Build a web app');
      expect(state.status).toBe('initializing'); // Initial status before planning
      expect(orchestrator.startTime).toBeDefined();
    });

    it('should accept context during initialization', async () => {
      const state = await orchestrator.initialize('Build app', { codebase: '/path/to/code' });

      expect(state.context.codebase).toBe('/path/to/code');
    });

    it('should emit initialized event', async () => {
      const eventHandler = vi.fn();
      orchestrator.on('initialized', eventHandler);

      await orchestrator.initialize('Test goal');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          goal: 'Test goal',
        })
      );
    });
  });

  describe('Configuration', () => {
    it('should use default configuration values', () => {
      const orch = new Orchestrator();
      expect(orch.config.maxFixCycles).toBeDefined();
      expect(orch.config.timeLimit).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const orch = new Orchestrator({
        maxFixCycles: 5,
        timeLimit: 120000,
      });
      expect(orch.config.maxFixCycles).toBe(5);
      expect(orch.config.timeLimit).toBe(120000);
    });
  });

  describe('Agent Registration', () => {
    it('should register agents with message bus', () => {
      expect(orchestrator.agents[AgentRole.PLANNER]).toBe(mockPlanner);
      expect(orchestrator.agents[AgentRole.CODER]).toBe(mockCoder);
      expect(orchestrator.agents[AgentRole.TESTER]).toBe(mockTester);
      expect(orchestrator.agents[AgentRole.SUPERVISOR]).toBe(mockSupervisor);
    });

    it('should register orchestrator itself', () => {
      expect(orchestrator.messageBus.getAgent(AgentRole.ORCHESTRATOR)).toBeDefined();
    });
  });

  describe('Time Limits', () => {
    it('should check time expiration', async () => {
      orchestrator.config.timeLimit = 1000;
      await orchestrator.initialize('Time test');

      expect(orchestrator.isTimeExpired()).toBe(false);

      // Simulate time passing - need to also update timeBudget's startTime
      orchestrator.startTime = Date.now() - 2000;
      if (orchestrator.timeBudget) {
        orchestrator.timeBudget.startTime = Date.now() - 2000;
      }

      expect(orchestrator.isTimeExpired()).toBe(true);
    });

    it('should return false if not started', () => {
      expect(orchestrator.isTimeExpired()).toBe(false);
    });
  });

  describe('State Management', () => {
    it('should track state through initialization', async () => {
      await orchestrator.initialize('State test');

      expect(orchestrator.state).toBeDefined();
      expect(orchestrator.state.primaryGoal).toBe('State test');
    });

    it('should provide state summary', async () => {
      await orchestrator.initialize('Summary test');

      const summary = orchestrator.getState();
      expect(summary).toBeDefined();
      expect(summary.status).toBe('initializing');
    });
  });

  describe('Stopping', () => {
    it('should stop gracefully', async () => {
      const stoppingHandler = vi.fn();
      orchestrator.on('stopping', stoppingHandler);

      orchestrator.stop();

      expect(orchestrator.shouldStop).toBe(true);
      expect(stoppingHandler).toHaveBeenCalled();
    });
  });

  describe('Recursive Re-planning State', () => {
    it('should limit recursion to 3 levels via state', async () => {
      await orchestrator.initialize('Recursion test');

      // Push plans to reach max depth
      for (let i = 0; i <= 3; i++) {
        const plan = new ExecutionPlan(`Level ${i}`, '');
        plan.depth = i;
        orchestrator.state.pushPlan(plan);
      }

      expect(orchestrator.state.getPlanDepth()).toBe(3); // Stack has 3 (0 pushed + 3 more)
      expect(orchestrator.state.canCreateSubPlan()).toBe(false);
    });

    it('should allow sub-plans within limit', async () => {
      await orchestrator.initialize('Sub-plan test');

      const plan = new ExecutionPlan('Root', '');
      plan.depth = 0;
      orchestrator.state.pushPlan(plan);

      expect(orchestrator.state.canCreateSubPlan()).toBe(true);
    });
  });

  describe('Report Generation', () => {
    it('should generate execution report', async () => {
      await orchestrator.initialize('Report test');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');
      orchestrator.state.currentPlan.addStep('Step 1', 'low');
      orchestrator.state.metrics.completedSteps = 1;
      orchestrator.state.status = 'completed';
      orchestrator.state.endTime = Date.now();

      const report = orchestrator.generateReport();

      expect(report.status).toBe('completed');
      expect(report.goal).toBe('Report test');
      expect(report.plan).toBeDefined();
      expect(report.metrics).toBeDefined();
      expect(report.elapsed).toBeDefined();
    });

    it('should include agent stats in report', async () => {
      await orchestrator.initialize('Agent stats test');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');

      const report = orchestrator.generateReport();

      expect(report.agentStats).toBeDefined();
    });
  });

  describe('Plan Stack Operations', () => {
    it('should handle plan stack push/pop', async () => {
      await orchestrator.initialize('Stack test');

      const rootPlan = new ExecutionPlan('Root', '');
      const subPlan = new ExecutionPlan('Sub', '');
      subPlan.depth = 1;

      orchestrator.state.pushPlan(rootPlan);
      expect(orchestrator.state.currentPlan).toBe(rootPlan);
      expect(orchestrator.state.getPlanDepth()).toBe(0);

      orchestrator.state.pushPlan(subPlan);
      expect(orchestrator.state.currentPlan).toBe(subPlan);
      expect(orchestrator.state.getPlanDepth()).toBe(1);

      orchestrator.state.popPlan();
      expect(orchestrator.state.currentPlan).toBe(rootPlan);
    });
  });

  describe('Test Requirement Helpers', () => {
    it('should build test requirement prompt', async () => {
      await orchestrator.initialize('Test prompt');

      const step = new PlanStep(1, 'Implement feature', 'medium');
      const prompt = orchestrator.buildTestRequirementPrompt(step);

      expect(prompt).toContain('TESTS REQUIRED');
      expect(prompt).toContain('Implement feature');
    });

    it('should check for required tests', () => {
      const withTests = { tests: [{ path: 'test.js' }] };
      const withoutTests = { tests: [] };
      const noOutput = null;

      expect(orchestrator.hasRequiredTests(withTests)).toBe(true);
      expect(orchestrator.hasRequiredTests(withoutTests)).toBe(false);
      expect(orchestrator.hasRequiredTests(noOutput)).toBe(false);
    });

    it('should get test coverage summary', () => {
      const step = new PlanStep(1, 'Step', 'low');
      step.codeOutput = {
        tests: [
          { path: 'test/unit.test.js', testType: 'unit' },
          { path: 'test/integration.test.js', testType: 'integration' },
        ],
      };

      const coverage = orchestrator.getTestCoverage(step);

      expect(coverage.hasTests).toBe(true);
      expect(coverage.count).toBe(2);
      expect(coverage.paths).toContain('test/unit.test.js');
    });
  });

  describe('Event Emission', () => {
    it('should emit events during initialization', async () => {
      const initHandler = vi.fn();
      orchestrator.on('initialized', initHandler);

      await orchestrator.initialize('Event test');

      expect(initHandler).toHaveBeenCalled();
    });

    it('should emit events during stopping', () => {
      const stopHandler = vi.fn();
      orchestrator.on('stopping', stopHandler);

      orchestrator.stop();

      expect(stopHandler).toHaveBeenCalled();
    });
  });

  describe('Message Bus Integration', () => {
    it('should forward message bus events', () => {
      const messageHandler = vi.fn();
      orchestrator.on('message', messageHandler);

      orchestrator.messageBus.emit('message_sent', { id: 'test', type: 'TEST' });

      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'sent' })
      );
    });
  });
});

// ===== NEW ENHANCEMENT TESTS =====

describe('WorkflowLoop', () => {
  let workflow;

  beforeEach(() => {
    workflow = new WorkflowLoop();
  });

  describe('Initialization', () => {
    it('should start in INITIALIZING phase', () => {
      expect(workflow.phase).toBe(WorkflowPhase.INITIALIZING);
    });

    it('should have zero counts initially', () => {
      expect(workflow.cycleCount).toBe(0);
      expect(workflow.stepCycleCount).toBe(0);
      expect(workflow.fixCycleCount).toBe(0);
    });
  });

  describe('Phase Transitions', () => {
    it('should transition between phases', () => {
      workflow.transition(WorkflowPhase.PLANNING);
      expect(workflow.phase).toBe(WorkflowPhase.PLANNING);

      workflow.transition(WorkflowPhase.EXECUTING);
      expect(workflow.phase).toBe(WorkflowPhase.EXECUTING);
    });

    it('should record transition history', () => {
      workflow.transition(WorkflowPhase.PLANNING);
      workflow.transition(WorkflowPhase.EXECUTING);

      expect(workflow.history.length).toBe(2);
      expect(workflow.history[0].to).toBe(WorkflowPhase.PLANNING);
      expect(workflow.history[1].to).toBe(WorkflowPhase.EXECUTING);
    });

    it('should track cycle counts', () => {
      // stepCycleCount increments when transitioning to EXECUTING
      workflow.transition(WorkflowPhase.EXECUTING);
      expect(workflow.stepCycleCount).toBe(1);

      workflow.transition(WorkflowPhase.FIXING);
      expect(workflow.fixCycleCount).toBe(1);

      workflow.transition(WorkflowPhase.EXECUTING);
      expect(workflow.stepCycleCount).toBe(2);
    });
  });

  describe('Terminal States', () => {
    it('should identify terminal phases', () => {
      expect(workflow.isTerminal()).toBe(false);

      workflow.transition(WorkflowPhase.COMPLETED);
      expect(workflow.isTerminal()).toBe(true);
    });

    it('should mark failed as terminal', () => {
      workflow.transition(WorkflowPhase.FAILED);
      expect(workflow.isTerminal()).toBe(true);
    });

    it('should mark time_expired as terminal', () => {
      workflow.transition(WorkflowPhase.TIME_EXPIRED);
      expect(workflow.isTerminal()).toBe(true);
    });
  });
});

describe('TimeBudgetManager', () => {
  let budget;

  beforeEach(() => {
    budget = new TimeBudgetManager(60 * 60 * 1000); // 1 hour
  });

  describe('Initialization', () => {
    it('should initialize with total time', () => {
      expect(budget.totalTime).toBe(60 * 60 * 1000);
      expect(budget.currentPhase).toBeNull();
    });
  });

  describe('Phase Tracking', () => {
    it('should track current phase', () => {
      budget.startPhase('planning');
      expect(budget.currentPhase).toBe('planning');
    });

    it('should end phases and record time', () => {
      budget.startPhase('planning');

      // Simulate some time passing
      budget.phaseStartTimes['planning'] = Date.now() - 5000;

      budget.endPhase();

      expect(budget.phaseElapsed['planning']).toBeGreaterThan(0);
      expect(budget.currentPhase).toBeNull();
    });
  });

  describe('Time Expiration', () => {
    it('should not be expired initially', () => {
      expect(budget.isExpired()).toBe(false);
    });

    it('should be expired after time limit', () => {
      budget.startTime = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago

      expect(budget.isExpired()).toBe(true);
    });
  });

  describe('Elapsed and Remaining', () => {
    it('should calculate elapsed time', () => {
      budget.startTime = Date.now() - 5000;

      const elapsed = budget.getElapsed();
      expect(elapsed).toBeGreaterThanOrEqual(5000);
    });

    it('should calculate remaining time', () => {
      const remaining = budget.getRemaining();
      expect(remaining).toBeLessThanOrEqual(60 * 60 * 1000);
    });

    it('should format remaining time', () => {
      const formatted = budget.formatRemaining();
      // Format can be hours+minutes, or minutes+seconds depending on time remaining
      expect(formatted).toMatch(/\d+[hms]/);
    });
  });

  describe('Summary', () => {
    it('should provide summary', () => {
      budget.startPhase('planning');

      const summary = budget.getSummary();

      // TimeBudgetManager uses 'total' not 'totalTime' in getSummary
      expect(summary.total).toBe(60 * 60 * 1000);
      expect(summary.elapsed).toBeDefined();
      expect(summary.remaining).toBeDefined();
      // currentPhase is tracked internally but not exposed in summary
      expect(budget.currentPhase).toBe('planning');
    });
  });
});

describe('Orchestrator Enhanced Features', () => {
  let orchestrator;
  let mockPlanner;
  let mockCoder;
  let mockTester;
  let mockSupervisor;

  beforeEach(() => {
    orchestrator = new Orchestrator({
      maxFixCycles: 2,
      maxStepAttempts: 2,
      timeLimit: 60000,
      verifyAllOutputs: false,
      requirePrePlanReview: true,
      enableProgressChecks: true,
      progressCheckInterval: 1000, // Fast for testing
      maxPlanRevisions: 3,
    });

    mockPlanner = {
      role: AgentRole.PLANNER,
      status: 'idle',
      handleMessage: vi.fn(async (msg) => {
        return msg.createResponse(MessageType.PLAN_RESPONSE, {
          plan: new ExecutionPlan('Goal', ''),
        });
      }),
      getId: () => 'planner-agent',
      getStats: () => ({ role: AgentRole.PLANNER, status: 'idle' }),
      resetForNewGoal: vi.fn(),
    };

    mockCoder = {
      role: AgentRole.CODER,
      status: 'idle',
      handleMessage: vi.fn(async (msg) => {
        return msg.createResponse(MessageType.CODE_RESPONSE, {
          output: { files: [], tests: [] },
        });
      }),
      getId: () => 'coder-agent',
      getStats: () => ({ role: AgentRole.CODER, status: 'idle' }),
      resetForNewGoal: vi.fn(),
    };

    mockTester = {
      role: AgentRole.TESTER,
      status: 'idle',
      handleMessage: vi.fn(async (msg) => {
        return msg.createResponse(MessageType.TEST_RESPONSE, {
          passed: true,
          issues: [],
        });
      }),
      getId: () => 'tester-agent',
      getStats: () => ({ role: AgentRole.TESTER, status: 'idle' }),
      resetForNewGoal: vi.fn(),
    };

    mockSupervisor = {
      role: AgentRole.SUPERVISOR,
      status: 'idle',
      handleMessage: vi.fn(async (msg) => {
        return msg.createResponse(MessageType.VERIFY_RESPONSE, {
          verified: true,
          score: 85,
          qualityGate: { passed: true, gateType: QualityGateType.PLAN_APPROVAL },
        });
      }),
      getId: () => 'supervisor-agent',
      getStats: () => ({ role: AgentRole.SUPERVISOR, status: 'idle' }),
      getEnhancedStats: () => ({ role: AgentRole.SUPERVISOR, qualityGates: { total: 0 } }),
      resetForNewGoal: vi.fn(),
    };

    orchestrator.registerAgents({
      [AgentRole.PLANNER]: mockPlanner,
      [AgentRole.CODER]: mockCoder,
      [AgentRole.TESTER]: mockTester,
      [AgentRole.SUPERVISOR]: mockSupervisor,
    });
  });

  describe('Initialization with Workflow', () => {
    it('should initialize workflow loop and time budget', async () => {
      await orchestrator.initialize('Test goal');

      expect(orchestrator.workflowLoop).toBeDefined();
      expect(orchestrator.timeBudget).toBeDefined();
      expect(orchestrator.timeBudget.totalTime).toBe(60000);
    });

    it('should reset agents for new goal', async () => {
      await orchestrator.initialize('Test goal');

      expect(mockPlanner.resetForNewGoal).toHaveBeenCalled();
      expect(mockCoder.resetForNewGoal).toHaveBeenCalled();
      expect(mockTester.resetForNewGoal).toHaveBeenCalled();
      expect(mockSupervisor.resetForNewGoal).toHaveBeenCalled();
    });

    it('should include time budget in initialized event', async () => {
      const eventHandler = vi.fn();
      orchestrator.on('initialized', eventHandler);

      await orchestrator.initialize('Test goal');

      // The event includes timeBudget.getSummary() which uses 'total' not 'totalTime'
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          timeBudget: expect.objectContaining({
            total: 60000,
          }),
        })
      );
    });
  });

  describe('Plan Review Phase', () => {
    it('should emit plan_reviewed event', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');
      orchestrator.state.currentPlan.addStep('Step 1', 'low');

      const planReviewedHandler = vi.fn();
      orchestrator.on('plan_reviewed', planReviewedHandler);

      await orchestrator.planReviewPhase();

      expect(planReviewedHandler).toHaveBeenCalled();
    });

    it('should emit plan_approved event on approval', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');
      orchestrator.state.currentPlan.addStep('Step 1', 'low');

      const planApprovedHandler = vi.fn();
      orchestrator.on('plan_approved', planApprovedHandler);

      const approved = await orchestrator.planReviewPhase();

      expect(approved).toBe(true);
      expect(planApprovedHandler).toHaveBeenCalled();
    });

    it('should request revision on rejection', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');

      // First call rejects, second approves
      let callCount = 0;
      mockSupervisor.handleMessage = vi.fn(async (msg) => {
        callCount++;
        if (callCount === 1) {
          return msg.createResponse(MessageType.VERIFY_RESPONSE, {
            verified: false,
            score: 50,
            qualityGate: { passed: false },
            issues: [{ description: 'Plan too vague' }],
            reason: 'Need more detail',
          });
        }
        return msg.createResponse(MessageType.VERIFY_RESPONSE, {
          verified: true,
          score: 80,
          qualityGate: { passed: true },
        });
      });

      // Mock planner to return revised plan
      mockPlanner.handleMessage = vi.fn(async (msg) => {
        const plan = new ExecutionPlan('Goal', '');
        plan.addStep('Better Step', 'low');
        return msg.createResponse(MessageType.PLAN_RESPONSE, { plan });
      });

      const planNeedsRevisionHandler = vi.fn();
      const planRevisedHandler = vi.fn();
      orchestrator.on('plan_needs_revision', planNeedsRevisionHandler);
      orchestrator.on('plan_revised', planRevisedHandler);

      const approved = await orchestrator.planReviewPhase();

      expect(approved).toBe(true);
      expect(planNeedsRevisionHandler).toHaveBeenCalled();
      expect(planRevisedHandler).toHaveBeenCalled();
      expect(orchestrator.planRevisionCount).toBe(1);
    });

    it('should fail after max revisions', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');
      orchestrator.config.maxPlanRevisions = 2;

      // Always reject
      mockSupervisor.handleMessage = vi.fn(async (msg) => {
        return msg.createResponse(MessageType.VERIFY_RESPONSE, {
          verified: false,
          score: 40,
          qualityGate: { passed: false },
        });
      });

      // Always return a revision
      mockPlanner.handleMessage = vi.fn(async (msg) => {
        const plan = new ExecutionPlan('Goal', '');
        return msg.createResponse(MessageType.PLAN_RESPONSE, { plan });
      });

      const approved = await orchestrator.planReviewPhase();

      expect(approved).toBe(false);
      expect(orchestrator.planRevisionCount).toBe(2);
    });
  });

  describe('Progress Checking', () => {
    it('should check progress at intervals', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.config.progressCheckInterval = 0; // Immediate
      orchestrator.lastProgressCheck = 0;

      // Mock verifyOutput
      orchestrator.verifyOutput = vi.fn().mockResolvedValue({
        verified: true,
        pace: 'GOOD',
        actionNeeded: 'NONE',
      });

      await orchestrator.checkProgress();

      expect(orchestrator.verifyOutput).toHaveBeenCalledWith(
        VerificationType.PROGRESS,
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should emit progress_check event', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.config.progressCheckInterval = 0;
      orchestrator.lastProgressCheck = 0;

      const progressCheckHandler = vi.fn();
      orchestrator.on('progress_check', progressCheckHandler);

      orchestrator.verifyOutput = vi.fn().mockResolvedValue({
        verified: true,
        isStalled: false,
        pace: 'GOOD',
      });

      await orchestrator.checkProgress();

      expect(progressCheckHandler).toHaveBeenCalled();
    });

    it('should not check too frequently', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.config.progressCheckInterval = 60000;
      orchestrator.lastProgressCheck = Date.now();

      orchestrator.verifyOutput = vi.fn();

      await orchestrator.checkProgress();

      expect(orchestrator.verifyOutput).not.toHaveBeenCalled();
    });

    it('should stop on abort recommendation', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.config.progressCheckInterval = 0;
      orchestrator.lastProgressCheck = 0;

      orchestrator.verifyOutput = vi.fn().mockResolvedValue({
        actionNeeded: 'ABORT',
        reason: 'Cannot complete',
      });

      const abortHandler = vi.fn();
      orchestrator.on('abort_recommended', abortHandler);

      await orchestrator.checkProgress();

      expect(orchestrator.shouldStop).toBe(true);
      expect(orchestrator.state.status).toBe('aborted');
      expect(abortHandler).toHaveBeenCalled();
    });
  });

  describe('Time Expiration Handling', () => {
    it('should check time expiration with timeBudget', async () => {
      await orchestrator.initialize('Test goal');

      expect(orchestrator.checkTimeExpired()).toBe(false);

      // Simulate time expiration
      orchestrator.timeBudget.startTime = Date.now() - 120000; // 2 minutes ago

      const timeExpiredHandler = vi.fn();
      orchestrator.on('time_expired', timeExpiredHandler);

      expect(orchestrator.checkTimeExpired()).toBe(true);
      expect(orchestrator.state.status).toBe('time_expired');
      expect(orchestrator.shouldStop).toBe(true);
      expect(timeExpiredHandler).toHaveBeenCalled();
    });

    it('should transition workflow to TIME_EXPIRED', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.timeBudget.startTime = Date.now() - 120000;

      orchestrator.checkTimeExpired();

      expect(orchestrator.workflowLoop.phase).toBe(WorkflowPhase.TIME_EXPIRED);
    });
  });

  describe('Workflow Status', () => {
    it('should provide workflow status', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');
      orchestrator.state.currentPlan.addStep('Step 1', 'low');

      const status = orchestrator.getWorkflowStatus();

      expect(status.isRunning).toBe(false);
      expect(status.phase).toBeDefined();
      expect(status.timeBudget).toBeDefined();
      expect(status.metrics).toBeDefined();
    });
  });

  describe('Enhanced Report Generation', () => {
    it('should include workflow data in report', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');
      orchestrator.workflowLoop.transition(WorkflowPhase.EXECUTING);

      const report = orchestrator.generateReport();

      expect(report.workflow).toBeDefined();
      expect(report.workflow.currentPhase).toBe(WorkflowPhase.EXECUTING);
      expect(report.workflow.cycleCount).toBeDefined();
    });

    it('should include time budget data in report', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');
      orchestrator.timeBudget.startPhase('test');

      const report = orchestrator.generateReport();

      expect(report.timeBudget).toBeDefined();
      expect(report.timeBudget.formattedRemaining).toBeDefined();
    });

    it('should include plan revision count in report', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');
      orchestrator.planRevisionCount = 2;

      const report = orchestrator.generateReport();

      expect(report.planRevisions).toBe(2);
    });

    it('should use enhanced stats from agents', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');

      const report = orchestrator.generateReport();

      expect(report.agentStats[AgentRole.SUPERVISOR]).toBeDefined();
      expect(report.agentStats[AgentRole.SUPERVISOR].qualityGates).toBeDefined();
    });
  });

  describe('Configuration Options', () => {
    it('should accept requirePrePlanReview config', () => {
      const orch = new Orchestrator({ requirePrePlanReview: false });
      expect(orch.config.requirePrePlanReview).toBe(false);
    });

    it('should accept enableProgressChecks config', () => {
      const orch = new Orchestrator({ enableProgressChecks: false });
      expect(orch.config.enableProgressChecks).toBe(false);
    });

    it('should accept progressCheckInterval config', () => {
      const orch = new Orchestrator({ progressCheckInterval: 10000 });
      expect(orch.config.progressCheckInterval).toBe(10000);
    });

    it('should accept maxPlanRevisions config', () => {
      const orch = new Orchestrator({ maxPlanRevisions: 5 });
      expect(orch.config.maxPlanRevisions).toBe(5);
    });
  });

  describe('Verify Output with Context', () => {
    it('should include workflow phase in context', async () => {
      await orchestrator.initialize('Test goal');
      orchestrator.state.currentPlan = new ExecutionPlan('Goal', '');
      orchestrator.workflowLoop.transition(WorkflowPhase.EXECUTING);

      await orchestrator.verifyOutput(VerificationType.CODE, { files: [] });

      expect(mockSupervisor.handleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            context: expect.objectContaining({
              phase: WorkflowPhase.EXECUTING,
            }),
          }),
        })
      );
    });
  });
});
