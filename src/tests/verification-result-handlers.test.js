import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recordStepCompletion,
  persistStepProgress,
  recordAdaptiveMetrics,
  generateStepRejectionPrompt,
  trackTokenUsage,
  determineGoalVerificationPassed,
  buildGoalFailureReason,
} from '../verification-result-handlers.js';

describe('verification-result-handlers', () => {
  describe('recordStepCompletion', () => {
    it('should record step execution with correct parameters', () => {
      const runner = {
        metrics: {
          recordStepExecution: vi.fn(),
        },
      };
      const completedStep = { number: 3, complexity: 'medium' };
      const stepDuration = 5000;

      recordStepCompletion(runner, completedStep, stepDuration);

      expect(runner.metrics.recordStepExecution).toHaveBeenCalledWith(
        3,
        'completed',
        5000,
        { complexity: 'medium' }
      );
    });

    it('should handle step without complexity', () => {
      const runner = {
        metrics: {
          recordStepExecution: vi.fn(),
        },
      };
      const completedStep = { number: 1 };
      const stepDuration = 1000;

      recordStepCompletion(runner, completedStep, stepDuration);

      expect(runner.metrics.recordStepExecution).toHaveBeenCalledWith(
        1,
        'completed',
        1000,
        { complexity: undefined }
      );
    });
  });

  describe('persistStepProgress', () => {
    it('should not persist if persistence is disabled', async () => {
      const runner = {
        enablePersistence: false,
        statePersistence: {
          updateStepProgress: vi.fn(),
        },
      };

      await persistStepProgress(runner, { number: 1 }, 1000);

      expect(runner.statePersistence.updateStepProgress).not.toHaveBeenCalled();
    });

    it('should update step progress when persistence enabled', async () => {
      const runner = {
        enablePersistence: true,
        statePersistence: {
          updateStepProgress: vi.fn().mockResolvedValue(undefined),
          createCheckpoint: vi.fn().mockResolvedValue(undefined),
        },
        planner: {
          getProgress: () => ({ completed: 1 }),
          plan: { steps: [] },
        },
      };

      await persistStepProgress(runner, { number: 1 }, 2000);

      expect(runner.statePersistence.updateStepProgress).toHaveBeenCalledWith(
        1,
        'completed',
        { duration: 2000 }
      );
    });

    it('should create checkpoint every 3 completed steps', async () => {
      const runner = {
        enablePersistence: true,
        statePersistence: {
          updateStepProgress: vi.fn().mockResolvedValue(undefined),
          createCheckpoint: vi.fn().mockResolvedValue(undefined),
        },
        planner: {
          getProgress: () => ({ completed: 3 }),
          plan: { steps: [1, 2, 3] },
        },
      };

      await persistStepProgress(runner, { number: 3 }, 3000);

      expect(runner.statePersistence.createCheckpoint).toHaveBeenCalledWith(
        'step_3_complete',
        { steps: [1, 2, 3] }
      );
    });

    it('should not create checkpoint if not divisible by 3', async () => {
      const runner = {
        enablePersistence: true,
        statePersistence: {
          updateStepProgress: vi.fn().mockResolvedValue(undefined),
          createCheckpoint: vi.fn().mockResolvedValue(undefined),
        },
        planner: {
          getProgress: () => ({ completed: 2 }),
          plan: { steps: [] },
        },
      };

      await persistStepProgress(runner, { number: 2 }, 2000);

      expect(runner.statePersistence.createCheckpoint).not.toHaveBeenCalled();
    });
  });

  describe('recordAdaptiveMetrics', () => {
    it('should record task performance with adaptive optimizer', () => {
      const runner = {
        adaptiveOptimizer: {
          classifyTask: vi.fn().mockReturnValue('coding'),
          recordTaskPerformance: vi.fn(),
          recordStrategyEffectiveness: vi.fn(),
        },
        currentExecutionProfile: null,
      };
      const completedStep = { description: 'Write unit tests' };
      const stepDuration = 4000;

      recordAdaptiveMetrics(runner, completedStep, stepDuration);

      expect(runner.adaptiveOptimizer.classifyTask).toHaveBeenCalledWith('Write unit tests');
      expect(runner.adaptiveOptimizer.recordTaskPerformance).toHaveBeenCalledWith('coding', {
        duration: 4000,
        success: true,
        iterations: 1,
      });
    });

    it('should record strategy effectiveness when execution profile exists', () => {
      const runner = {
        adaptiveOptimizer: {
          classifyTask: vi.fn().mockReturnValue('debugging'),
          recordTaskPerformance: vi.fn(),
          recordStrategyEffectiveness: vi.fn(),
        },
        currentExecutionProfile: {
          primaryStrategy: 'iterative',
        },
      };
      const completedStep = { description: 'Fix bug' };
      const stepDuration = 3000;

      recordAdaptiveMetrics(runner, completedStep, stepDuration);

      expect(runner.adaptiveOptimizer.recordStrategyEffectiveness).toHaveBeenCalledWith(
        'iterative',
        true,
        { duration: 3000 }
      );
    });

    it('should not record strategy effectiveness without execution profile', () => {
      const runner = {
        adaptiveOptimizer: {
          classifyTask: vi.fn().mockReturnValue('coding'),
          recordTaskPerformance: vi.fn(),
          recordStrategyEffectiveness: vi.fn(),
        },
        currentExecutionProfile: null,
      };

      recordAdaptiveMetrics(runner, { description: 'Test' }, 1000);

      expect(runner.adaptiveOptimizer.recordStrategyEffectiveness).not.toHaveBeenCalled();
    });
  });

  describe('generateStepRejectionPrompt', () => {
    it('should generate rejection prompt with step details', () => {
      const rejectedStep = { number: 5, description: 'Implement feature X' };
      const stepVerification = { reason: 'Feature X is not working correctly' };

      const prompt = generateStepRejectionPrompt(rejectedStep, stepVerification);

      expect(prompt).toContain('Step 5');
      expect(prompt).toContain('Implement feature X');
      expect(prompt).toContain('Feature X is not working correctly');
      expect(prompt).toContain('STEP COMPLETE');
    });

    it('should format prompt correctly', () => {
      const rejectedStep = { number: 1, description: 'Test step' };
      const stepVerification = { reason: 'Not done' };

      const prompt = generateStepRejectionPrompt(rejectedStep, stepVerification);

      expect(prompt).toMatch(/## Step Not Complete/);
      expect(prompt).toMatch(/Your claim that Step 1/);
    });
  });

  describe('trackTokenUsage', () => {
    it('should track tokens when both tokensIn and tokensOut are present', () => {
      const runner = {
        contextManager: {
          trackTokenUsage: vi.fn(),
        },
      };
      const result = { tokensIn: 100, tokensOut: 50 };

      trackTokenUsage(runner, result);

      expect(runner.contextManager.trackTokenUsage).toHaveBeenCalledWith(100, 50);
    });

    it('should track tokens when only tokensIn is present', () => {
      const runner = {
        contextManager: {
          trackTokenUsage: vi.fn(),
        },
      };
      const result = { tokensIn: 100 };

      trackTokenUsage(runner, result);

      expect(runner.contextManager.trackTokenUsage).toHaveBeenCalledWith(100, 0);
    });

    it('should track tokens when only tokensOut is present', () => {
      const runner = {
        contextManager: {
          trackTokenUsage: vi.fn(),
        },
      };
      const result = { tokensOut: 50 };

      trackTokenUsage(runner, result);

      expect(runner.contextManager.trackTokenUsage).toHaveBeenCalledWith(0, 50);
    });

    it('should not track tokens when neither is present', () => {
      const runner = {
        contextManager: {
          trackTokenUsage: vi.fn(),
        },
      };
      const result = {};

      trackTokenUsage(runner, result);

      expect(runner.contextManager.trackTokenUsage).not.toHaveBeenCalled();
    });

    it('should handle null/undefined values as 0', () => {
      const runner = {
        contextManager: {
          trackTokenUsage: vi.fn(),
        },
      };
      const result = { tokensIn: null, tokensOut: undefined };

      trackTokenUsage(runner, result);

      expect(runner.contextManager.trackTokenUsage).not.toHaveBeenCalled();
    });
  });

  describe('determineGoalVerificationPassed', () => {
    const isTruthy = (val) => val === true || val === 'true' || val === 'yes';
    const isFalsy = (val) => val === false || val === 'false' || val === 'no';

    it('should return true when achieved is truthy', () => {
      expect(determineGoalVerificationPassed(true, 50, isTruthy, isFalsy)).toBe(true);
      expect(determineGoalVerificationPassed('yes', 50, isTruthy, isFalsy)).toBe(true);
    });

    it('should return false when achieved is falsy', () => {
      expect(determineGoalVerificationPassed(false, 80, isTruthy, isFalsy)).toBe(false);
      expect(determineGoalVerificationPassed('no', 80, isTruthy, isFalsy)).toBe(false);
    });

    it('should return true when inconclusive and most steps completed (>=70%)', () => {
      expect(determineGoalVerificationPassed('maybe', 70, isTruthy, isFalsy)).toBe(true);
      expect(determineGoalVerificationPassed('unknown', 85, isTruthy, isFalsy)).toBe(true);
      expect(determineGoalVerificationPassed(null, 100, isTruthy, isFalsy)).toBe(true);
    });

    it('should return false when inconclusive and steps incomplete (<70%)', () => {
      expect(determineGoalVerificationPassed('maybe', 69, isTruthy, isFalsy)).toBe(false);
      expect(determineGoalVerificationPassed('unknown', 50, isTruthy, isFalsy)).toBe(false);
      expect(determineGoalVerificationPassed(null, 0, isTruthy, isFalsy)).toBe(false);
    });

    it('should handle edge cases at 70% boundary', () => {
      expect(determineGoalVerificationPassed('inconclusive', 70, isTruthy, isFalsy)).toBe(true);
      expect(determineGoalVerificationPassed('inconclusive', 69.9, isTruthy, isFalsy)).toBe(false);
    });
  });

  describe('buildGoalFailureReason', () => {
    it('should return inconclusive message when verification is inconclusive', () => {
      const reason = buildGoalFailureReason(true, 45, 'Some reason');

      expect(reason).toBe('Verification inconclusive and steps incomplete (45%)');
    });

    it('should return goal reason when verification is conclusive', () => {
      const reason = buildGoalFailureReason(false, 80, 'Tests are failing');

      expect(reason).toBe('Goal not achieved: Tests are failing');
    });

    it('should handle empty goal reason', () => {
      const reason = buildGoalFailureReason(false, 50, '');

      expect(reason).toBe('Goal not achieved: ');
    });

    it('should include percentage in inconclusive message', () => {
      const reason = buildGoalFailureReason(true, 0, 'Any reason');

      expect(reason).toContain('0%');
    });
  });
});
