import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IterationHandler } from '../iteration-handler.js';
import { RecoveryStrategy } from '../error-recovery.js';

describe('IterationHandler', () => {
  let handler;
  let mockRunner;

  beforeEach(() => {
    mockRunner = {
      iterationCount: 1,
      shouldStop: false,
      consecutiveAbortErrors: 0,
      currentExecutionProfile: null,
      planner: {
        getCurrentStep: vi.fn().mockReturnValue({ number: 1, description: 'Test step' }),
        getNextExecutableBatch: vi.fn().mockReturnValue([]),
        skipStep: vi.fn(),
      },
      planManager: {
        checkStepDecomposition: vi.fn().mockResolvedValue(undefined),
        handlePendingSubPlan: vi.fn().mockResolvedValue(undefined),
      },
      config: {
        get: vi.fn().mockReturnValue({}),
      },
      parallelWorkerClients: [],
      client: {
        reset: vi.fn(),
      },
      metrics: {
        startIteration: vi.fn(),
        endIteration: vi.fn(),
        recordError: vi.fn(),
        recordStepExecution: vi.fn(),
        recordParallelExecution: vi.fn(),
        efficiency: { avgStepTime: 1000 },
      },
      errorRecovery: {
        executeWithRetry: vi.fn(),
        getErrorTrends: vi.fn().mockReturnValue({ lastMinute: 0 }),
      },
      executionEngine: {
        runIteration: vi.fn().mockResolvedValue({ response: 'Done' }),
      },
      adaptiveOptimizer: {
        adjustStrategy: vi.fn().mockReturnValue([]),
      },
      phaseManager: {
        getTimeStatus: vi.fn().mockReturnValue({ remaining: 60000 }),
      },
      verificationHandler: {
        handlePendingStepVerification: vi.fn().mockResolvedValue(undefined),
        handlePendingCompletion: vi.fn().mockResolvedValue(undefined),
      },
      goalTracker: {
        isComplete: vi.fn().mockReturnValue(false),
      },
      contextManager: {
        reset: vi.fn(),
        trimToRecent: vi.fn(),
      },
      onProgress: vi.fn(),
      onError: vi.fn(),
      onEscalation: vi.fn(),
      getAdaptiveDelay: vi.fn().mockReturnValue(100),
      sleep: vi.fn().mockResolvedValue(undefined),
      getStuckIterationCount: vi.fn().mockReturnValue(0),
      getAverageSupervisionScore: vi.fn().mockReturnValue(0.8),
      parallelExecutor: {
        executeBatch: vi.fn().mockResolvedValue([]),
      },
    };
    handler = new IterationHandler(mockRunner);
  });

  describe('constructor', () => {
    it('should store runner reference', () => {
      expect(handler.runner).toBe(mockRunner);
    });
  });

  describe('executeIteration', () => {
    beforeEach(() => {
      mockRunner.errorRecovery.executeWithRetry.mockImplementation(fn => fn());
    });

    it('should check step decomposition first', async () => {
      const step = { number: 2 };
      mockRunner.planner.getCurrentStep.mockReturnValue(step);

      await handler.executeIteration();

      expect(mockRunner.planManager.checkStepDecomposition).toHaveBeenCalledWith(step);
    });

    it('should try parallel execution', async () => {
      const tryParallelSpy = vi.spyOn(handler, 'tryParallelExecution').mockResolvedValue(false);

      await handler.executeIteration();

      expect(tryParallelSpy).toHaveBeenCalled();
    });

    it('should return early if parallel execution succeeds', async () => {
      vi.spyOn(handler, 'tryParallelExecution').mockResolvedValue(true);

      await handler.executeIteration();

      expect(mockRunner.metrics.startIteration).not.toHaveBeenCalled();
    });

    it('should start and end iteration metrics', async () => {
      await handler.executeIteration();

      expect(mockRunner.metrics.startIteration).toHaveBeenCalled();
      expect(mockRunner.metrics.endIteration).toHaveBeenCalled();
    });

    it('should execute with retry using error recovery', async () => {
      mockRunner.config.get.mockReturnValue(3);
      mockRunner.planner.getCurrentStep.mockReturnValue({ number: 5 });

      await handler.executeIteration();

      expect(mockRunner.errorRecovery.executeWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          operationId: 'iteration_1_step_5',
          maxRetries: 3,
        })
      );
    });

    it('should call runIteration inside retry function', async () => {
      let capturedFn;
      mockRunner.errorRecovery.executeWithRetry.mockImplementation(fn => {
        capturedFn = fn;
        return fn();
      });

      await handler.executeIteration();

      expect(mockRunner.executionEngine.runIteration).toHaveBeenCalled();
    });

    it('should handle onError callback', async () => {
      let onErrorCallback;
      mockRunner.errorRecovery.executeWithRetry.mockImplementation((fn, opts) => {
        onErrorCallback = opts.onError;
        return fn();
      });

      await handler.executeIteration();

      onErrorCallback({
        error: new Error('Test error'),
        recovery: {
          shouldRetry: true,
          category: 'network',
          strategy: 'retry',
          retryCount: 1,
          delay: 1000,
        },
      });

      expect(mockRunner.metrics.recordError).toHaveBeenCalledWith('iteration_error', true);
      expect(mockRunner.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'iteration_error',
          error: 'Test error',
          willRetry: true,
        })
      );
    });

    it('should handle onContextAction callback', async () => {
      let onContextActionCallback;
      mockRunner.errorRecovery.executeWithRetry.mockImplementation((fn, opts) => {
        onContextActionCallback = opts.onContextAction;
        return fn();
      });

      await handler.executeIteration();

      await onContextActionCallback({ action: 'reset' });

      expect(mockRunner.contextManager.reset).toHaveBeenCalled();
    });

    it('should check strategy adjustments', async () => {
      const checkStrategySpy = vi.spyOn(handler, 'checkStrategyAdjustments');

      await handler.executeIteration();

      expect(checkStrategySpy).toHaveBeenCalled();
    });

    it('should emit iteration_complete progress', async () => {
      mockRunner.executionEngine.runIteration.mockResolvedValue({ response: 'Completed' });

      await handler.executeIteration();

      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'iteration_complete',
          response: 'Completed',
        })
      );
    });

    it('should handle pending verifications', async () => {
      await handler.executeIteration();

      expect(mockRunner.verificationHandler.handlePendingStepVerification).toHaveBeenCalled();
      expect(mockRunner.planManager.checkStepDecomposition).toHaveBeenCalled();
      expect(mockRunner.verificationHandler.handlePendingCompletion).toHaveBeenCalled();
    });

    it('should set shouldStop when goal is complete', async () => {
      mockRunner.goalTracker.isComplete.mockReturnValue(true);

      await handler.executeIteration();

      expect(mockRunner.shouldStop).toBe(true);
    });

    it('should apply adaptive delay', async () => {
      mockRunner.getAdaptiveDelay.mockReturnValue(200);

      await handler.executeIteration();

      expect(mockRunner.getAdaptiveDelay).toHaveBeenCalledWith(true);
      expect(mockRunner.sleep).toHaveBeenCalledWith(200);
    });

    it('should handle recovery error by calling handleRecoveryError', async () => {
      const recoveryError = new Error('Recovery failed');
      recoveryError.strategy = RecoveryStrategy.SKIP_STEP;
      mockRunner.errorRecovery.executeWithRetry.mockRejectedValue(recoveryError);

      const handleSpy = vi.spyOn(handler, 'handleRecoveryError').mockResolvedValue(null);

      await handler.executeIteration();

      expect(handleSpy).toHaveBeenCalled();
    });
  });

  describe('tryParallelExecution', () => {
    it('should return false when parallel disabled', async () => {
      mockRunner.config.get.mockReturnValue({ enabled: false });

      const result = await handler.tryParallelExecution();

      expect(result).toBe(false);
    });

    it('should return false when no worker clients', async () => {
      mockRunner.parallelWorkerClients = [];
      mockRunner.config.get.mockReturnValue({ enabled: true });

      const result = await handler.tryParallelExecution();

      expect(result).toBe(false);
    });

    it('should return false when batch has 1 or fewer steps', async () => {
      mockRunner.parallelWorkerClients = [{}];
      mockRunner.config.get.mockReturnValue({ enabled: true });
      mockRunner.planner.getNextExecutableBatch.mockReturnValue([{ number: 1 }]);

      const result = await handler.tryParallelExecution();

      expect(result).toBe(false);
    });

    it('should execute parallel batch', async () => {
      mockRunner.parallelWorkerClients = [{ id: 'worker1' }];
      mockRunner.config.get.mockReturnValue({ enabled: true });
      mockRunner.planner.getNextExecutableBatch.mockReturnValue([{ number: 1 }, { number: 2 }]);
      mockRunner.parallelExecutor.executeBatch.mockResolvedValue([
        { success: true },
        { success: true },
      ]);

      const result = await handler.tryParallelExecution();

      expect(mockRunner.parallelExecutor.executeBatch).toHaveBeenCalled();
      expect(mockRunner.metrics.recordParallelExecution).toHaveBeenCalledWith(2, expect.any(Array));
      expect(result).toBe(true);
    });

    it('should emit parallel_steps_unclear for unclear results', async () => {
      mockRunner.parallelWorkerClients = [{}];
      mockRunner.config.get.mockReturnValue({ enabled: true });
      mockRunner.planner.getNextExecutableBatch.mockReturnValue([{ number: 1 }, { number: 2 }]);
      mockRunner.parallelExecutor.executeBatch.mockResolvedValue([
        { success: true, unclear: true, step: { number: 1 } },
        { success: true },
      ]);

      await handler.tryParallelExecution();

      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'parallel_steps_unclear',
        steps: [1],
      });
    });

    it('should return false if not all steps complete', async () => {
      mockRunner.parallelWorkerClients = [{}];
      mockRunner.config.get.mockReturnValue({ enabled: true });
      mockRunner.planner.getNextExecutableBatch.mockReturnValue([{ number: 1 }, { number: 2 }]);
      mockRunner.parallelExecutor.executeBatch.mockResolvedValue([
        { success: false, blocked: false },
        { success: true },
      ]);

      const result = await handler.tryParallelExecution();

      expect(result).toBe(false);
    });
  });

  describe('handleContextAction', () => {
    it('should reset context on reset action', async () => {
      await handler.handleContextAction({ action: 'reset' });

      expect(mockRunner.contextManager.reset).toHaveBeenCalled();
      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'context_reset',
        reason: 'error_recovery',
      });
    });

    it('should trim context on trim action', async () => {
      await handler.handleContextAction({ action: 'trim', keepRecent: 3 });

      expect(mockRunner.contextManager.trimToRecent).toHaveBeenCalledWith(3);
      expect(mockRunner.onProgress).toHaveBeenCalledWith({
        type: 'context_trimmed',
        reason: 'error_recovery',
        keepRecent: 3,
      });
    });

    it('should use default keepRecent of 5', async () => {
      await handler.handleContextAction({ action: 'trim' });

      expect(mockRunner.contextManager.trimToRecent).toHaveBeenCalledWith(5);
    });

    it('should ignore unknown actions', async () => {
      await handler.handleContextAction({ action: 'unknown' });

      expect(mockRunner.contextManager.reset).not.toHaveBeenCalled();
      expect(mockRunner.contextManager.trimToRecent).not.toHaveBeenCalled();
    });
  });

  describe('handleRecoveryError', () => {
    it('should skip step on SKIP_STEP strategy', async () => {
      const error = {
        strategy: RecoveryStrategy.SKIP_STEP,
        originalError: new Error('Failed'),
      };
      const step = { number: 3 };

      const result = await handler.handleRecoveryError(error, step);

      expect(mockRunner.planner.skipStep).toHaveBeenCalledWith(3);
      expect(mockRunner.metrics.recordStepExecution).toHaveBeenCalledWith(3, 'skipped', 0, { reason: 'error_recovery' });
      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'step_skipped', step })
      );
      expect(result).toBeNull();
    });

    it('should escalate on ESCALATE strategy', async () => {
      const error = {
        strategy: RecoveryStrategy.ESCALATE,
        originalError: new Error('Critical error'),
        category: 'system',
        recovery: {},
      };

      const result = await handler.handleRecoveryError(error, { number: 1 });

      expect(mockRunner.onEscalation).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error_escalation' })
      );
      expect(result.escalated).toBe(true);
    });

    it('should handle ABORT strategy with backoff', async () => {
      const error = {
        strategy: RecoveryStrategy.ABORT,
        originalError: new Error('Abort error'),
        category: 'fatal',
      };

      const result = await handler.handleRecoveryError(error, { number: 1 });

      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'abort_recovery' })
      );
      expect(mockRunner.sleep).toHaveBeenCalled();
      expect(mockRunner.client.reset).toHaveBeenCalled();
      expect(result.recovered).toBe(true);
    });

    it('should increase consecutive abort errors', async () => {
      mockRunner.consecutiveAbortErrors = 2;
      const error = { strategy: RecoveryStrategy.ABORT };

      await handler.handleRecoveryError(error, { number: 1 });

      expect(mockRunner.consecutiveAbortErrors).toBe(3);
    });

    it('should handle unknown recovery strategy', async () => {
      const error = {
        strategy: 'UNKNOWN',
        originalError: new Error('Unknown error'),
      };

      const result = await handler.handleRecoveryError(error, { number: 1 });

      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'unknown_recovery_strategy', strategy: 'UNKNOWN' })
      );
      expect(result.recovered).toBe(true);
    });

    it('should not skip step if current step is null', async () => {
      const error = { strategy: RecoveryStrategy.SKIP_STEP };

      const result = await handler.handleRecoveryError(error, null);

      expect(mockRunner.planner.skipStep).not.toHaveBeenCalled();
    });
  });

  describe('checkStrategyAdjustments', () => {
    it('should only run every 5 iterations', async () => {
      mockRunner.iterationCount = 3;

      await handler.checkStrategyAdjustments();

      expect(mockRunner.adaptiveOptimizer.adjustStrategy).not.toHaveBeenCalled();
    });

    it('should only run with execution profile', async () => {
      mockRunner.iterationCount = 5;
      mockRunner.currentExecutionProfile = null;

      await handler.checkStrategyAdjustments();

      expect(mockRunner.adaptiveOptimizer.adjustStrategy).not.toHaveBeenCalled();
    });

    it('should adjust strategy every 5 iterations', async () => {
      mockRunner.iterationCount = 5;
      mockRunner.currentExecutionProfile = { primaryStrategy: 'default' };

      await handler.checkStrategyAdjustments();

      expect(mockRunner.adaptiveOptimizer.adjustStrategy).toHaveBeenCalledWith(
        expect.objectContaining({
          recentErrorRate: expect.any(Number),
          avgIterationTime: 1000,
          stuckIterations: 0,
          supervisionScore: 0.8,
        })
      );
    });

    it('should emit strategy_adjusted when adjustments made', async () => {
      mockRunner.iterationCount = 10;
      mockRunner.currentExecutionProfile = { primaryStrategy: 'test' };
      mockRunner.adaptiveOptimizer.adjustStrategy.mockReturnValue(['adjustment1']);

      await handler.checkStrategyAdjustments();

      expect(mockRunner.onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'strategy_adjusted',
          adjustments: ['adjustment1'],
        })
      );
    });

    it('should not emit when no adjustments', async () => {
      mockRunner.iterationCount = 5;
      mockRunner.currentExecutionProfile = {};
      mockRunner.adaptiveOptimizer.adjustStrategy.mockReturnValue([]);

      await handler.checkStrategyAdjustments();

      expect(mockRunner.onProgress).not.toHaveBeenCalled();
    });
  });
});
