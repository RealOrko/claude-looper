import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanManager } from '../plan-manager.js';

describe('PlanManager', () => {
  let manager;
  let mockRunner;

  beforeEach(() => {
    mockRunner = {
      primaryGoal: 'Build a web application',
      initialContext: 'Initial context here',
      workingDirectory: '/test/dir',
      planCreated: false,
      enablePersistence: false,
      pendingSubPlan: null,
      onProgress: vi.fn(),
      planner: {
        restorePlan: vi.fn(),
        getCurrentStep: vi.fn().mockReturnValue({ number: 1 }),
        currentStep: 0,
        createPlan: vi.fn().mockResolvedValue({ totalSteps: 5, steps: [] }),
        enableParallelMode: vi.fn(),
        getSummary: vi.fn().mockReturnValue('Plan summary'),
        getExecutionStats: vi.fn().mockReturnValue({}),
        plan: { totalSteps: 5, steps: [] },
        createSubPlan: vi.fn(),
        failCurrentStep: vi.fn(),
        advanceStep: vi.fn(),
        getProgress: vi.fn().mockReturnValue({ completed: 2, total: 5 }),
        shouldDecomposeStep: vi.fn().mockReturnValue(false),
        decomposeComplexStep: vi.fn(),
        injectSubtasks: vi.fn(),
      },
      supervisor: {
        reviewPlan: vi.fn().mockResolvedValue({ approved: true }),
      },
      metrics: {
        recordPlanningTime: vi.fn(),
      },
      contextManager: {
        recordMilestone: vi.fn(),
        recordDecision: vi.fn(),
        trackTokenUsage: vi.fn(),
      },
      statePersistence: {
        setPlan: vi.fn().mockResolvedValue(undefined),
        createCheckpoint: vi.fn().mockResolvedValue(undefined),
      },
      config: {
        get: vi.fn().mockReturnValue({}),
      },
      client: {
        continueConversation: vi.fn().mockResolvedValue({}),
        reset: vi.fn(),
      },
      phaseManager: {
        getTimeStatus: vi.fn().mockReturnValue({ remaining: 60000 }),
      },
    };
    manager = new PlanManager(mockRunner);
  });

  describe('constructor', () => {
    it('should store runner reference', () => {
      expect(manager.runner).toBe(mockRunner);
    });
  });

  describe('setupPlan', () => {
    it('should restore plan when resumed session has plan', async () => {
      const resumedSession = {
        plan: { steps: [{ number: 1 }] },
        currentStep: 1,
        completedSteps: [1],
      };

      const restoreSpy = vi.spyOn(manager, 'restorePlan');

      await manager.setupPlan(resumedSession);

      expect(restoreSpy).toHaveBeenCalledWith(resumedSession);
    });

    it('should create new plan when no resumed session', async () => {
      const createSpy = vi.spyOn(manager, 'createNewPlan');

      await manager.setupPlan(null);

      expect(createSpy).toHaveBeenCalled();
    });

    it('should create new plan when resumed session has no plan', async () => {
      const createSpy = vi.spyOn(manager, 'createNewPlan');

      await manager.setupPlan({ completedSteps: [] });

      expect(createSpy).toHaveBeenCalled();
    });
  });

  describe('restorePlan', () => {
    it('should emit resuming progress event', async () => {
      const resumedSession = { plan: { steps: [] }, currentStep: 0 };

      await manager.restorePlan(resumedSession);

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'resuming',
        message: 'Resuming from saved session...',
      });
    });

    it('should restore plan via planner', async () => {
      const resumedSession = { plan: { steps: [1, 2] }, currentStep: 1 };

      await manager.restorePlan(resumedSession);

      expect(mockRunner.planner.restorePlan).toHaveBeenCalledWith({ steps: [1, 2] }, 1);
    });

    it('should set planCreated to true', async () => {
      await manager.restorePlan({ plan: {}, currentStep: 0 });

      expect(mockRunner.planCreated).toBe(true);
    });

    it('should emit plan_restored with correct step number', async () => {
      mockRunner.planner.getCurrentStep.mockReturnValue({ number: 3 });
      const resumedSession = { plan: { steps: [] }, currentStep: 2, completedSteps: [1, 2] };

      await manager.restorePlan(resumedSession);

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'plan_restored',
        plan: { steps: [] },
        currentStep: 3,
        completedSteps: [1, 2],
      });
    });

    it('should use fallback step number when getCurrentStep returns null', async () => {
      mockRunner.planner.getCurrentStep.mockReturnValue(null);
      mockRunner.planner.currentStep = 2;

      await manager.restorePlan({ plan: {}, currentStep: 2 });

      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ currentStep: 3 })
      );
    });
  });

  describe('createNewPlan', () => {
    it('should emit planning progress event', async () => {
      await manager.createNewPlan();

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'planning',
        message: 'Creating execution plan...',
      });
    });

    it('should call planner createPlan with correct args', async () => {
      await manager.createNewPlan();

      expect(mockRunner.planner.createPlan).toHaveBeenCalledWith(
        'Build a web application',
        'Initial context here',
        '/test/dir'
      );
    });

    it('should set planCreated to true', async () => {
      await manager.createNewPlan();

      expect(mockRunner.planCreated).toBe(true);
    });

    it('should record planning time metrics', async () => {
      await manager.createNewPlan();

      expect(mockRunner.metrics.recordPlanningTime).toHaveBeenCalledWith(
        expect.any(Number),
        5
      );
    });

    it('should persist plan when persistence enabled', async () => {
      mockRunner.enablePersistence = true;
      const plan = { totalSteps: 3, steps: [] };
      mockRunner.planner.createPlan.mockResolvedValue(plan);

      await manager.createNewPlan();

      expect(mockRunner.statePersistence.setPlan).toHaveBeenCalledWith(plan);
      expect(mockRunner.statePersistence.createCheckpoint).toHaveBeenCalledWith('plan_created', plan);
    });

    it('should not persist when persistence disabled', async () => {
      mockRunner.enablePersistence = false;

      await manager.createNewPlan();

      expect(mockRunner.statePersistence.setPlan).not.toHaveBeenCalled();
    });

    it('should enable parallel mode by default', async () => {
      await manager.createNewPlan();

      expect(mockRunner.planner.enableParallelMode).toHaveBeenCalled();
    });

    it('should not enable parallel mode when disabled in config', async () => {
      mockRunner.config.get.mockReturnValue({ enabled: false });

      await manager.createNewPlan();

      expect(mockRunner.planner.enableParallelMode).not.toHaveBeenCalled();
    });

    it('should record milestone', async () => {
      await manager.createNewPlan();

      expect(mockRunner.contextManager.recordMilestone).toHaveBeenCalledWith(
        'Created execution plan with 5 steps'
      );
    });

    it('should emit plan_created event', async () => {
      await manager.createNewPlan();

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'plan_created',
        plan: expect.any(Object),
        summary: 'Plan summary',
        executionStats: {},
      });
    });

    it('should call reviewPlan', async () => {
      const reviewSpy = vi.spyOn(manager, 'reviewPlan');
      const plan = { totalSteps: 2, steps: [] };
      mockRunner.planner.createPlan.mockResolvedValue(plan);

      await manager.createNewPlan();

      expect(reviewSpy).toHaveBeenCalledWith(plan);
    });
  });

  describe('reviewPlan', () => {
    it('should emit plan_review_started event', async () => {
      const plan = { steps: [] };

      await manager.reviewPlan(plan);

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'plan_review_started',
        plan,
      });
    });

    it('should call supervisor reviewPlan', async () => {
      const plan = { steps: [] };

      await manager.reviewPlan(plan);

      expect(mockRunner.supervisor.reviewPlan).toHaveBeenCalledWith(plan, 'Build a web application');
    });

    it('should emit plan_review_complete event', async () => {
      const review = { approved: true };
      mockRunner.supervisor.reviewPlan.mockResolvedValue(review);

      await manager.reviewPlan({});

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'plan_review_complete',
        review,
      });
    });

    it('should record decision when plan approved', async () => {
      mockRunner.supervisor.reviewPlan.mockResolvedValue({ approved: true });

      await manager.reviewPlan({});

      expect(mockRunner.contextManager.recordDecision).toHaveBeenCalledWith(
        'Plan approved by supervisor',
        '5 steps ready for execution'
      );
    });

    it('should record decision and emit warning when plan not approved', async () => {
      mockRunner.supervisor.reviewPlan.mockResolvedValue({
        approved: false,
        issues: ['Issue 1'],
        missingSteps: ['Step A'],
        suggestions: ['Suggestion 1'],
      });

      await manager.reviewPlan({});

      expect(mockRunner.contextManager.recordDecision).toHaveBeenCalledWith(
        'Proceeding with plan despite review warnings',
        'Issues: 1, Missing steps: 1'
      );
      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'plan_review_warning',
        issues: ['Issue 1'],
        missingSteps: ['Step A'],
        suggestions: ['Suggestion 1'],
      });
    });
  });

  describe('handlePendingSubPlan', () => {
    it('should return early if no pending sub-plan', async () => {
      mockRunner.pendingSubPlan = null;

      await manager.handlePendingSubPlan();

      expect(mockRunner.planner.createSubPlan).not.toHaveBeenCalled();
    });

    it('should emit subplan_creating event', async () => {
      mockRunner.pendingSubPlan = { step: { number: 1 }, reason: 'Blocked' };
      mockRunner.planner.createSubPlan.mockResolvedValue(null);

      await manager.handlePendingSubPlan();

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'subplan_creating',
        step: { number: 1 },
        reason: 'Blocked',
      });
    });

    it('should create sub-plan via planner', async () => {
      const step = { number: 2 };
      mockRunner.pendingSubPlan = { step, reason: 'Timeout' };
      mockRunner.planner.createSubPlan.mockResolvedValue(null);

      await manager.handlePendingSubPlan();

      expect(mockRunner.planner.createSubPlan).toHaveBeenCalledWith(step, 'Timeout', '/test/dir');
    });

    it('should handle successful sub-plan creation', async () => {
      const step = { number: 3 };
      const subPlan = {
        totalSteps: 2,
        steps: [{ number: 1, description: 'Sub A' }, { number: 2, description: 'Sub B' }],
      };
      mockRunner.pendingSubPlan = { step, reason: 'Blocked' };
      mockRunner.planner.createSubPlan.mockResolvedValue(subPlan);

      await manager.handlePendingSubPlan();

      expect(mockRunner.contextManager.recordDecision).toHaveBeenCalledWith(
        'Created sub-plan for step 3',
        'Original step blocked: Blocked. Created 2 sub-steps.'
      );
      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'subplan_created',
        parentStep: step,
        subPlan,
      });
    });

    it('should continue conversation with sub-plan prompt', async () => {
      const subPlan = {
        totalSteps: 1,
        steps: [{ number: 1, description: 'Do thing' }],
      };
      mockRunner.pendingSubPlan = { step: {}, reason: 'Error' };
      mockRunner.planner.createSubPlan.mockResolvedValue(subPlan);

      await manager.handlePendingSubPlan();

      expect(mockRunner.client.continueConversation).toHaveBeenCalledWith(
        expect.stringContaining('Alternative Approach Required')
      );
    });

    it('should track token usage from sub-plan result', async () => {
      mockRunner.pendingSubPlan = { step: {}, reason: 'Test' };
      mockRunner.planner.createSubPlan.mockResolvedValue({ totalSteps: 1, steps: [{ number: 1, description: 'x' }] });
      mockRunner.client.continueConversation.mockResolvedValue({ tokensIn: 100, tokensOut: 200 });

      await manager.handlePendingSubPlan();

      expect(mockRunner.contextManager.trackTokenUsage).toHaveBeenCalledWith(100, 200);
    });

    it('should handle failed sub-plan creation', async () => {
      mockRunner.pendingSubPlan = { step: { number: 5 }, reason: 'Failed' };
      mockRunner.planner.createSubPlan.mockResolvedValue(null);

      await manager.handlePendingSubPlan();

      expect(mockRunner.planner.failCurrentStep).toHaveBeenCalledWith('Failed');
      expect(mockRunner.planner.advanceStep).toHaveBeenCalled();
      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'step_failed',
        step: { number: 5 },
        reason: 'Sub-plan creation failed',
        progress: { completed: 2, total: 5 },
      });
    });

    it('should clear pending sub-plan after handling', async () => {
      mockRunner.pendingSubPlan = { step: {}, reason: 'Test' };
      mockRunner.planner.createSubPlan.mockResolvedValue(null);

      await manager.handlePendingSubPlan();

      expect(mockRunner.pendingSubPlan).toBeNull();
    });
  });

  describe('createGapPlan', () => {
    beforeEach(() => {
      mockRunner.planner.plan.steps = [
        { status: 'completed', description: 'Step 1' },
        { status: 'failed', description: 'Step 2' },
      ];
    });

    it('should emit creating_gap_plan event', async () => {
      await manager.createGapPlan(2, null);

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'creating_gap_plan',
        cycle: 2,
        gaps: expect.any(String),
        failedSteps: 1,
        timeRemaining: 60000,
      });
    });

    it('should use verification gaps when available', async () => {
      const cycleVerification = {
        goalVerification: { gaps: 'Unit tests missing' },
      };

      await manager.createGapPlan(1, cycleVerification);

      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ gaps: 'Unit tests missing' })
      );
    });

    it('should use failed step descriptions when no verification gaps', async () => {
      await manager.createGapPlan(1, {});

      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ gaps: 'Step 2' })
      );
    });

    it('should create new plan with gap context', async () => {
      await manager.createGapPlan(3, null);

      expect(mockRunner.planner.createPlan).toHaveBeenCalledWith(
        'Build a web application',
        expect.stringContaining('CRITICAL GAPS TO ADDRESS'),
        '/test/dir'
      );
    });

    it('should include initial context in new plan', async () => {
      await manager.createGapPlan(1, null);

      expect(mockRunner.planner.createPlan).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Initial context here'),
        expect.any(String)
      );
    });

    it('should emit gap_plan_created event', async () => {
      const newPlan = { totalSteps: 3, steps: [] };
      mockRunner.planner.createPlan.mockResolvedValue(newPlan);

      await manager.createGapPlan(2, null);

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'gap_plan_created',
        cycle: 2,
        plan: newPlan,
        steps: 3,
      });
    });

    it('should reset client after gap plan creation', async () => {
      await manager.createGapPlan(1, null);

      expect(mockRunner.client.reset).toHaveBeenCalled();
    });
  });

  describe('checkStepDecomposition', () => {
    it('should return early if step is null', async () => {
      await manager.checkStepDecomposition(null);

      expect(mockRunner.planner.shouldDecomposeStep).not.toHaveBeenCalled();
    });

    it('should return early if step is subtask', async () => {
      await manager.checkStepDecomposition({ isSubtask: true });

      expect(mockRunner.planner.shouldDecomposeStep).not.toHaveBeenCalled();
    });

    it('should return early if step already decomposed', async () => {
      await manager.checkStepDecomposition({ decomposedInto: [1, 2] });

      expect(mockRunner.planner.shouldDecomposeStep).not.toHaveBeenCalled();
    });

    it('should check if step should be decomposed', async () => {
      const step = { startTime: Date.now() - 5000 };

      await manager.checkStepDecomposition(step);

      expect(mockRunner.planner.shouldDecomposeStep).toHaveBeenCalledWith(step, expect.any(Number));
    });

    it('should emit step_decomposing for complex step', async () => {
      const step = { complexity: 'complex' };
      mockRunner.planner.shouldDecomposeStep.mockReturnValue(true);
      mockRunner.planner.decomposeComplexStep.mockResolvedValue(null);

      await manager.checkStepDecomposition(step);

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'step_decomposing',
        step,
        reason: 'complex_step',
      });
    });

    it('should emit step_decomposing for long running step', async () => {
      const step = { complexity: 'simple' };
      mockRunner.planner.shouldDecomposeStep.mockReturnValue(true);
      mockRunner.planner.decomposeComplexStep.mockResolvedValue(null);

      await manager.checkStepDecomposition(step);

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'step_decomposing',
        step,
        reason: 'long_running',
      });
    });

    it('should decompose step via planner', async () => {
      const step = { id: 1 };
      mockRunner.planner.shouldDecomposeStep.mockReturnValue(true);
      mockRunner.planner.decomposeComplexStep.mockResolvedValue(null);

      await manager.checkStepDecomposition(step);

      expect(mockRunner.planner.decomposeComplexStep).toHaveBeenCalledWith(step, '/test/dir');
    });

    it('should inject subtasks and emit step_decomposed', async () => {
      const step = { id: 2 };
      const decomposition = { subtasks: [{ id: 3 }], parallelSafe: true };
      mockRunner.planner.shouldDecomposeStep.mockReturnValue(true);
      mockRunner.planner.decomposeComplexStep.mockResolvedValue(decomposition);
      mockRunner.planner.injectSubtasks.mockReturnValue(true);

      await manager.checkStepDecomposition(step);

      expect(mockRunner.planner.injectSubtasks).toHaveBeenCalledWith(decomposition);
      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'step_decomposed',
        parentStep: step,
        subtasks: [{ id: 3 }],
        parallelSafe: true,
      });
    });

    it('should not emit step_decomposed if injection fails', async () => {
      const step = { id: 1 };
      mockRunner.planner.shouldDecomposeStep.mockReturnValue(true);
      mockRunner.planner.decomposeComplexStep.mockResolvedValue({ subtasks: [] });
      mockRunner.planner.injectSubtasks.mockReturnValue(false);

      await manager.checkStepDecomposition(step);

      expect(mockRunner.onProgress).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'step_decomposed' })
      );
    });

    it('should calculate step elapsed time correctly', async () => {
      const startTime = Date.now() - 10000;
      const step = { startTime };
      mockRunner.planner.shouldDecomposeStep.mockReturnValue(false);

      await manager.checkStepDecomposition(step);

      expect(mockRunner.planner.shouldDecomposeStep).toHaveBeenCalledWith(
        step,
        expect.any(Number)
      );
      const [, elapsed] = mockRunner.planner.shouldDecomposeStep.mock.calls[0];
      expect(elapsed).toBeGreaterThanOrEqual(10000);
      expect(elapsed).toBeLessThan(11000);
    });
  });
});
