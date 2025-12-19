import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerificationHandler } from '../verification-handler.js';

describe('VerificationHandler', () => {
  let handler;
  let mockRunner;

  beforeEach(() => {
    mockRunner = {
      pendingStepCompletion: null,
      pendingCompletion: null,
      stepVerificationFailures: 0,
      verificationFailures: 0,
      iterationCount: 1,
      shouldStop: false,
      finalSummary: null,
      primaryGoal: 'Build a complete application',
      workingDirectory: '/test/dir',
      abortReason: null,
      enablePersistence: false,
      onProgress: vi.fn(),
      onVerification: vi.fn(),
      onEscalation: vi.fn(),
      supervisor: {
        verifyStepCompletion: vi.fn(),
        verifyGoalAchieved: vi.fn(),
      },
      planner: {
        advanceStep: vi.fn(),
        getProgress: vi.fn().mockReturnValue({ completed: 1, total: 5, percentComplete: 20 }),
        isComplete: vi.fn().mockReturnValue(false),
        plan: { steps: [] },
      },
      client: {
        continueConversation: vi.fn().mockResolvedValue({}),
      },
      config: {
        get: vi.fn().mockReturnValue({}),
      },
      verifier: {
        verify: vi.fn(),
        generateRejectionPrompt: vi.fn().mockReturnValue('Rejection prompt'),
      },
      metrics: {
        recordStepExecution: vi.fn(),
      },
      contextManager: {
        recordMilestone: vi.fn(),
        recordDecision: vi.fn(),
        trackTokenUsage: vi.fn(),
      },
      statePersistence: {
        updateStepProgress: vi.fn().mockResolvedValue(undefined),
        createCheckpoint: vi.fn().mockResolvedValue(undefined),
      },
      adaptiveOptimizer: {
        classifyTask: vi.fn().mockReturnValue('general'),
        recordTaskPerformance: vi.fn(),
        recordStrategyEffectiveness: vi.fn(),
      },
      currentExecutionProfile: null,
      phaseManager: {
        isTimeExpired: vi.fn().mockReturnValue(false),
      },
    };
    handler = new VerificationHandler(mockRunner);
  });

  describe('constructor', () => {
    it('should store runner reference', () => {
      expect(handler.runner).toBe(mockRunner);
    });
  });

  describe('handlePendingStepVerification', () => {
    it('should return early if no pending step completion', async () => {
      mockRunner.pendingStepCompletion = null;

      await handler.handlePendingStepVerification();

      expect(mockRunner.supervisor.verifyStepCompletion).not.toHaveBeenCalled();
    });

    it('should emit step_verification_started progress event', async () => {
      const step = { number: 1, description: 'Test step' };
      mockRunner.pendingStepCompletion = { step, response: 'Done' };
      mockRunner.supervisor.verifyStepCompletion.mockResolvedValue({ verified: true });

      await handler.handlePendingStepVerification();

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'step_verification_started',
        step,
      });
    });

    it('should call verifyStepCompletion with step and response', async () => {
      const step = { number: 1, description: 'Test step' };
      const response = 'Step completed successfully';
      mockRunner.pendingStepCompletion = { step, response };
      mockRunner.supervisor.verifyStepCompletion.mockResolvedValue({ verified: true });

      await handler.handlePendingStepVerification();

      expect(mockRunner.supervisor.verifyStepCompletion).toHaveBeenCalledWith(step, response);
    });

    it('should call handleVerifiedStep when verification passes', async () => {
      const step = { number: 1, description: 'Test step' };
      mockRunner.pendingStepCompletion = { step, response: 'Done' };
      const verification = { verified: true };
      mockRunner.supervisor.verifyStepCompletion.mockResolvedValue(verification);

      const handleVerifiedSpy = vi.spyOn(handler, 'handleVerifiedStep');

      await handler.handlePendingStepVerification();

      expect(handleVerifiedSpy).toHaveBeenCalledWith(verification);
    });

    it('should call handleRejectedStep when verification fails', async () => {
      const step = { number: 1, description: 'Test step' };
      mockRunner.pendingStepCompletion = { step, response: 'Done' };
      const verification = { verified: false, reason: 'Not complete' };
      mockRunner.supervisor.verifyStepCompletion.mockResolvedValue(verification);

      const handleRejectedSpy = vi.spyOn(handler, 'handleRejectedStep');

      await handler.handlePendingStepVerification();

      expect(handleRejectedSpy).toHaveBeenCalledWith(verification);
    });
  });

  describe('handleVerifiedStep', () => {
    beforeEach(() => {
      mockRunner.pendingStepCompletion = {
        step: { number: 1, description: 'Test', startTime: Date.now() - 5000, complexity: 'simple' },
        response: 'Done',
      };
    });

    it('should advance planner step', async () => {
      await handler.handleVerifiedStep({ verified: true });

      expect(mockRunner.planner.advanceStep).toHaveBeenCalled();
    });

    it('should clear pending step completion', async () => {
      await handler.handleVerifiedStep({ verified: true });

      expect(mockRunner.pendingStepCompletion).toBeNull();
    });

    it('should reset step verification failures', async () => {
      mockRunner.stepVerificationFailures = 3;

      await handler.handleVerifiedStep({ verified: true });

      expect(mockRunner.stepVerificationFailures).toBe(0);
    });

    it('should record step execution metrics', async () => {
      await handler.handleVerifiedStep({ verified: true });

      expect(mockRunner.metrics.recordStepExecution).toHaveBeenCalledWith(
        1,
        'completed',
        expect.any(Number),
        { complexity: 'simple' }
      );
    });

    it('should emit step_complete progress event', async () => {
      const stepVerification = { verified: true };

      await handler.handleVerifiedStep(stepVerification);

      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'step_complete',
          step: expect.objectContaining({ number: 1 }),
          verification: stepVerification,
        })
      );
    });

    it('should record milestone in context manager', async () => {
      await handler.handleVerifiedStep({ verified: true });

      expect(mockRunner.contextManager.recordMilestone).toHaveBeenCalledWith(
        'Completed step 1: Test'
      );
    });

    it('should record adaptive metrics', async () => {
      await handler.handleVerifiedStep({ verified: true });

      expect(mockRunner.adaptiveOptimizer.classifyTask).toHaveBeenCalledWith('Test');
      expect(mockRunner.adaptiveOptimizer.recordTaskPerformance).toHaveBeenCalled();
    });

    it('should calculate zero duration when no startTime', async () => {
      mockRunner.pendingStepCompletion.step.startTime = null;

      await handler.handleVerifiedStep({ verified: true });

      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ duration: 0 })
      );
    });
  });

  describe('handleRejectedStep', () => {
    beforeEach(() => {
      mockRunner.pendingStepCompletion = {
        step: { number: 2, description: 'Failing step' },
        response: 'Done',
      };
    });

    it('should increment step verification failures', async () => {
      mockRunner.stepVerificationFailures = 1;

      await handler.handleRejectedStep({ reason: 'Not complete' });

      expect(mockRunner.stepVerificationFailures).toBe(2);
    });

    it('should clear pending step completion', async () => {
      await handler.handleRejectedStep({ reason: 'Not complete' });

      expect(mockRunner.pendingStepCompletion).toBeNull();
    });

    it('should record decision in context manager', async () => {
      await handler.handleRejectedStep({ reason: 'Test failed' });

      expect(mockRunner.contextManager.recordDecision).toHaveBeenCalledWith(
        'Rejected step 2 completion claim',
        'Test failed'
      );
    });

    it('should emit step_rejected progress event', async () => {
      mockRunner.stepVerificationFailures = 0;

      await handler.handleRejectedStep({ reason: 'Not complete' });

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'step_rejected',
        step: { number: 2, description: 'Failing step' },
        reason: 'Not complete',
        failures: 1,
      });
    });

    it('should continue conversation with rejection prompt', async () => {
      await handler.handleRejectedStep({ reason: 'Not done' });

      expect(mockRunner.client.continueConversation).toHaveBeenCalledWith(
        expect.stringContaining('Step 2')
      );
    });

    it('should track token usage from response', async () => {
      mockRunner.client.continueConversation.mockResolvedValue({ tokensIn: 50, tokensOut: 100 });

      await handler.handleRejectedStep({ reason: 'Not done' });

      expect(mockRunner.contextManager.trackTokenUsage).toHaveBeenCalledWith(50, 100);
    });
  });

  describe('handlePendingCompletion', () => {
    it('should return early if no pending completion', async () => {
      mockRunner.pendingCompletion = null;

      await handler.handlePendingCompletion();

      expect(mockRunner.verifier.verify).not.toHaveBeenCalled();
    });

    it('should emit verification_started progress event', async () => {
      mockRunner.pendingCompletion = { claim: 'Task complete' };
      mockRunner.verifier.verify.mockResolvedValue({ passed: true, layers: [] });

      await handler.handlePendingCompletion();

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'verification_started',
        claim: { claim: 'Task complete' },
      });
    });

    it('should call verifier with correct parameters', async () => {
      mockRunner.pendingCompletion = { claim: 'All done' };
      mockRunner.verifier.verify.mockResolvedValue({ passed: true, layers: [] });

      await handler.handlePendingCompletion();

      expect(mockRunner.verifier.verify).toHaveBeenCalledWith(
        'All done',
        '/test/dir',
        { completed: 1, total: 5, percentComplete: 20 }
      );
    });

    it('should call onVerification with results', async () => {
      mockRunner.pendingCompletion = { claim: 'Done' };
      mockRunner.verifier.verify.mockResolvedValue({ passed: true, layers: ['layer1'] });

      await handler.handlePendingCompletion();

      expect(mockRunner.onVerification).toHaveBeenCalledWith(
        expect.objectContaining({
          iteration: 1,
          claim: { claim: 'Done' },
          passed: true,
        })
      );
    });

    it('should handle verification passed', async () => {
      mockRunner.pendingCompletion = { claim: 'Complete' };
      mockRunner.verifier.verify.mockResolvedValue({ passed: true, layers: ['l1', 'l2'] });

      await handler.handlePendingCompletion();

      expect(mockRunner.shouldStop).toBe(true);
      expect(mockRunner.finalSummary).toEqual({
        summary: 'Complete',
        detectedCompletion: true,
        verified: true,
        verificationLayers: ['l1', 'l2'],
      });
      expect(mockRunner.pendingCompletion).toBeNull();
    });

    it('should handle verification failed', async () => {
      mockRunner.pendingCompletion = { claim: 'Done' };
      mockRunner.verifier.verify.mockResolvedValue({ passed: false, reason: 'Tests fail' });

      await handler.handlePendingCompletion();

      expect(mockRunner.verificationFailures).toBe(1);
      expect(mockRunner.pendingCompletion).toBeNull();
      expect(mockRunner.client.continueConversation).toHaveBeenCalledWith('Rejection prompt');
    });

    it('should escalate after max verification attempts', async () => {
      mockRunner.pendingCompletion = { claim: 'Done' };
      mockRunner.verificationFailures = 2;
      mockRunner.config.get.mockReturnValue({ maxAttempts: 3 });
      mockRunner.verifier.verify.mockResolvedValue({ passed: false });

      await handler.handlePendingCompletion();

      expect(mockRunner.onEscalation).toHaveBeenCalledWith({
        type: 'verification_limit',
        iteration: 1,
        failures: 3,
        message: 'Max false completion claims (3) reached',
      });
    });
  });

  describe('handleVerificationPassed', () => {
    beforeEach(() => {
      mockRunner.pendingCompletion = { claim: 'Task completed' };
    });

    it('should set shouldStop to true', () => {
      handler.handleVerificationPassed({ passed: true, layers: [] });

      expect(mockRunner.shouldStop).toBe(true);
    });

    it('should set finalSummary correctly', () => {
      handler.handleVerificationPassed({ passed: true, layers: ['code', 'tests'] });

      expect(mockRunner.finalSummary).toEqual({
        summary: 'Task completed',
        detectedCompletion: true,
        verified: true,
        verificationLayers: ['code', 'tests'],
      });
    });

    it('should clear pending completion', () => {
      handler.handleVerificationPassed({ passed: true, layers: [] });

      expect(mockRunner.pendingCompletion).toBeNull();
    });
  });

  describe('handleVerificationFailed', () => {
    beforeEach(() => {
      mockRunner.pendingCompletion = { claim: 'Done' };
    });

    it('should increment verification failures', async () => {
      mockRunner.verificationFailures = 1;

      await handler.handleVerificationFailed({}, {});

      expect(mockRunner.verificationFailures).toBe(2);
    });

    it('should clear pending completion', async () => {
      await handler.handleVerificationFailed({}, {});

      expect(mockRunner.pendingCompletion).toBeNull();
    });

    it('should use default maxAttempts of 3', async () => {
      mockRunner.verificationFailures = 2;

      await handler.handleVerificationFailed({}, {});

      expect(mockRunner.onEscalation).toHaveBeenCalled();
    });

    it('should not escalate before max attempts', async () => {
      mockRunner.verificationFailures = 0;

      await handler.handleVerificationFailed({}, { maxAttempts: 3 });

      expect(mockRunner.onEscalation).not.toHaveBeenCalled();
    });

    it('should generate rejection prompt and continue conversation', async () => {
      await handler.handleVerificationFailed({ reason: 'Failed' }, {});

      expect(mockRunner.verifier.generateRejectionPrompt).toHaveBeenCalledWith({ reason: 'Failed' });
      expect(mockRunner.client.continueConversation).toHaveBeenCalledWith('Rejection prompt');
    });
  });

  describe('verifyGoalAchievement', () => {
    it('should return null if planner is not complete', async () => {
      mockRunner.planner.isComplete.mockReturnValue(false);

      const result = await handler.verifyGoalAchievement(1);

      expect(result).toBeNull();
    });

    it('should return null if abort reason exists', async () => {
      mockRunner.planner.isComplete.mockReturnValue(true);
      mockRunner.abortReason = 'User cancelled';

      const result = await handler.verifyGoalAchievement(1);

      expect(result).toBeNull();
    });

    it('should emit final_verification_started event', async () => {
      mockRunner.planner.isComplete.mockReturnValue(true);
      mockRunner.supervisor.verifyGoalAchieved.mockResolvedValue({ achieved: true });

      await handler.verifyGoalAchievement(2);

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'final_verification_started',
        cycle: 2,
      });
    });

    it('should call supervisor verifyGoalAchieved with correct params', async () => {
      mockRunner.planner.isComplete.mockReturnValue(true);
      mockRunner.planner.plan.steps = [{ id: 1 }, { id: 2 }];
      mockRunner.supervisor.verifyGoalAchieved.mockResolvedValue({ achieved: true });

      await handler.verifyGoalAchievement(1);

      expect(mockRunner.supervisor.verifyGoalAchieved).toHaveBeenCalledWith(
        'Build a complete application',
        [{ id: 1 }, { id: 2 }],
        '/test/dir'
      );
    });

    it('should emit goal_verification_complete event', async () => {
      mockRunner.planner.isComplete.mockReturnValue(true);
      const goalVerification = { achieved: true };
      mockRunner.supervisor.verifyGoalAchieved.mockResolvedValue(goalVerification);

      await handler.verifyGoalAchievement(3);

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'goal_verification_complete',
        cycle: 3,
        result: goalVerification,
      });
    });
  });

  describe('processGoalVerification', () => {
    it('should return verification result object', () => {
      const goalVerification = { achieved: true };

      const result = handler.processGoalVerification(goalVerification, 1);

      expect(result).toEqual({
        goalVerification: { achieved: true },
        overallPassed: true,
        verificationInconclusive: false,
      });
    });

    it('should update finalSummary if it exists', () => {
      mockRunner.finalSummary = { summary: 'Test' };
      const goalVerification = { achieved: true };

      handler.processGoalVerification(goalVerification, 1);

      expect(mockRunner.finalSummary.goalVerification).toEqual(goalVerification);
      expect(mockRunner.finalSummary.fullyVerified).toBe(true);
    });

    it('should call recordGoalSuccess when passed', () => {
      const recordSuccessSpy = vi.spyOn(handler, 'recordGoalSuccess');
      const goalVerification = { achieved: true };

      handler.processGoalVerification(goalVerification, 2);

      expect(recordSuccessSpy).toHaveBeenCalledWith(2, goalVerification, false);
    });

    it('should call recordGoalFailure when not passed', () => {
      const recordFailureSpy = vi.spyOn(handler, 'recordGoalFailure');
      const goalVerification = { achieved: false, reason: 'Not done' };

      handler.processGoalVerification(goalVerification, 3);

      expect(recordFailureSpy).toHaveBeenCalledWith(
        3,
        goalVerification,
        false,
        { completed: 1, total: 5, percentComplete: 20 }
      );
    });

    it('should handle inconclusive verification with high completion', () => {
      mockRunner.planner.getProgress.mockReturnValue({ percentComplete: 80 });
      const goalVerification = { achieved: 'maybe' };

      const result = handler.processGoalVerification(goalVerification, 1);

      expect(result.overallPassed).toBe(true);
      expect(result.verificationInconclusive).toBe(true);
    });

    it('should handle inconclusive verification with low completion', () => {
      mockRunner.planner.getProgress.mockReturnValue({ percentComplete: 50 });
      const goalVerification = { achieved: 'unknown' };

      const result = handler.processGoalVerification(goalVerification, 1);

      expect(result.overallPassed).toBe(false);
      expect(result.verificationInconclusive).toBe(true);
    });
  });

  describe('recordGoalSuccess', () => {
    it('should record milestone with goal summary', () => {
      handler.recordGoalSuccess(1, { achieved: true }, false);

      expect(mockRunner.contextManager.recordMilestone).toHaveBeenCalledWith(
        'Goal achieved and verified: Build a complete application...'
      );
    });

    it('should add inconclusive suffix when applicable', () => {
      handler.recordGoalSuccess(1, { achieved: true }, true);

      expect(mockRunner.contextManager.recordMilestone).toHaveBeenCalledWith(
        expect.stringContaining('(verification inconclusive but most steps completed)')
      );
    });

    it('should emit final_verification_passed event', () => {
      const goalVerification = { achieved: true };

      handler.recordGoalSuccess(2, goalVerification, false);

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'final_verification_passed',
        cycle: 2,
        goalVerification,
        verificationInconclusive: false,
      });
    });
  });

  describe('recordGoalFailure', () => {
    it('should record decision with failure reason', () => {
      const stepProgress = { percentComplete: 40 };

      handler.recordGoalFailure(1, { reason: 'Tests fail' }, false, stepProgress);

      expect(mockRunner.contextManager.recordDecision).toHaveBeenCalledWith(
        'Verification failed - will retry',
        'Goal not achieved: Tests fail'
      );
    });

    it('should emit final_verification_failed event', () => {
      const goalVerification = { reason: 'Error' };
      const stepProgress = { percentComplete: 30 };

      handler.recordGoalFailure(3, goalVerification, false, stepProgress);

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'final_verification_failed',
        cycle: 3,
        goalVerification,
        verificationInconclusive: false,
        reason: 'Goal not achieved: Error',
        willRetry: true,
      });
    });

    it('should not retry if time expired', () => {
      mockRunner.phaseManager.isTimeExpired.mockReturnValue(true);
      const stepProgress = { percentComplete: 50 };

      handler.recordGoalFailure(1, {}, false, stepProgress);

      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ willRetry: false })
      );
    });

    it('should not retry after 10 cycles', () => {
      const stepProgress = { percentComplete: 50 };

      handler.recordGoalFailure(10, {}, false, stepProgress);

      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ willRetry: false })
      );
    });

    it('should use inconclusive failure reason when appropriate', () => {
      const stepProgress = { percentComplete: 45 };

      handler.recordGoalFailure(1, {}, true, stepProgress);

      expect(mockRunner.contextManager.recordDecision).toHaveBeenCalledWith(
        'Verification failed - will retry',
        'Verification inconclusive and steps incomplete (45%)'
      );
    });
  });
});
