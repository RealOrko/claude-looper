/**
 * Iteration Handler
 * Handles individual iteration execution with error recovery and parallel execution
 */

import { RecoveryStrategy } from './error-recovery.js';

export class IterationHandler {
  constructor(runner) {
    this.runner = runner;
  }

  /**
   * Execute a single iteration with error recovery
   */
  async executeIteration() {
    const r = this.runner;
    const currentStep = r.planner.getCurrentStep();

    // Check for step decomposition
    await r.planManager.checkStepDecomposition(currentStep);

    // Check for parallel execution
    if (await this.tryParallelExecution()) {
      return;
    }

    // Start iteration tracking
    r.metrics.startIteration();

    // Run iteration with error recovery
    const operationId = `iteration_${r.iterationCount}_step_${currentStep?.number || 0}`;
    let iterationResult;

    try {
      iterationResult = await r.errorRecovery.executeWithRetry(
        () => r.executionEngine.runIteration(),
        {
          operationId,
          maxRetries: r.config.get('maxRetries'),
          onError: ({ error, recovery }) => {
            r.metrics.recordError('iteration_error', recovery.shouldRetry);
            r.onError({
              type: 'iteration_error',
              error: error.message,
              category: recovery.category,
              strategy: recovery.strategy,
              retryCount: recovery.retryCount,
              delay: recovery.delay,
              willRetry: recovery.shouldRetry,
            });
          },
          onContextAction: async (action) => {
            await this.handleContextAction(action);
          },
        }
      );
    } catch (recoveryError) {
      iterationResult = await this.handleRecoveryError(recoveryError, currentStep);
      if (!iterationResult) return;
    }

    r.metrics.endIteration();

    // Check for adaptive strategy adjustments
    await this.checkStrategyAdjustments();

    // Emit progress
    r.onProgress({
      type: 'iteration_complete',
      ...iterationResult,
      time: r.phaseManager.getTimeStatus(),
    });

    // Handle pending verifications
    await r.verificationHandler.handlePendingStepVerification();
    await r.planManager.handlePendingSubPlan();
    await r.verificationHandler.handlePendingCompletion();

    if (r.goalTracker.isComplete()) {
      r.shouldStop = true;
    }

    // Adaptive delay
    const iterationSuccess = !iterationResult?.supervision ||
      iterationResult.supervision.action === 'CONTINUE';
    const delay = r.getAdaptiveDelay(iterationSuccess);
    await r.sleep(delay);
  }

  /**
   * Try parallel execution if possible
   */
  async tryParallelExecution() {
    const r = this.runner;
    const parallelConfig = r.config.get('parallelExecution') || {};
    if (parallelConfig.enabled === false || r.parallelWorkerClients.length === 0) {
      return false;
    }

    const parallelBatch = r.planner.getNextExecutableBatch();
    if (parallelBatch.length <= 1) {
      return false;
    }

    const allClients = [r.client, ...r.parallelWorkerClients];
    const batchResults = await r.parallelExecutor.executeBatch(
      parallelBatch,
      allClients.slice(0, parallelBatch.length)
    );

    r.metrics.recordParallelExecution(parallelBatch.length, batchResults);

    const unclearResults = batchResults.filter(result => result.unclear);
    if (unclearResults.length > 0) {
      r.onProgress({
        type: 'parallel_steps_unclear',
        steps: unclearResults.map(result => result.step?.number),
      });
    }

    const allComplete = batchResults.every(result => result.success || result.blocked);
    if (allComplete) {
      const delay = r.getAdaptiveDelay(true);
      await r.sleep(delay);
      return true;
    }

    return false;
  }

  /**
   * Handle context recovery actions
   */
  async handleContextAction(action) {
    const r = this.runner;
    if (action.action === 'reset') {
      r.contextManager.reset();
      r.onProgress({ type: 'context_reset', reason: 'error_recovery' });
    } else if (action.action === 'trim') {
      r.contextManager.trimToRecent(action.keepRecent || 5);
      r.onProgress({
        type: 'context_trimmed',
        reason: 'error_recovery',
        keepRecent: action.keepRecent,
      });
    }
  }

  /**
   * Handle recovery error
   */
  async handleRecoveryError(recoveryError, currentStep) {
    const r = this.runner;

    if (recoveryError.strategy === RecoveryStrategy.SKIP_STEP && currentStep) {
      r.onProgress({
        type: 'step_skipped',
        step: currentStep,
        reason: 'error_recovery',
        error: recoveryError.originalError?.message || recoveryError.message,
      });
      r.planner.skipStep(currentStep.number);
      r.metrics.recordStepExecution(currentStep.number, 'skipped', 0, {
        reason: 'error_recovery',
      });
      return null;
    } else if (recoveryError.strategy === RecoveryStrategy.ESCALATE) {
      r.onEscalation({
        type: 'error_escalation',
        error: recoveryError.originalError?.message || recoveryError.message,
        category: recoveryError.category,
        recovery: recoveryError.recovery,
        errorTrends: r.errorRecovery.getErrorTrends(),
      });
      return { response: `Error escalated: ${recoveryError.message}`, escalated: true };
    } else if (recoveryError.strategy === RecoveryStrategy.ABORT) {
      const backoffDelay = Math.min(60000, 5000 * Math.pow(2, r.consecutiveAbortErrors || 0));
      r.consecutiveAbortErrors = (r.consecutiveAbortErrors || 0) + 1;

      r.onProgress({
        type: 'abort_recovery',
        error: recoveryError.originalError?.message || recoveryError.message,
        category: recoveryError.category,
        backoffDelay,
        consecutiveErrors: r.consecutiveAbortErrors,
        reason: 'Loop is bulletproof - waiting and retrying instead of aborting',
      });

      await r.sleep(backoffDelay);
      r.client.reset();
      return { response: `Recovered from abort: ${recoveryError.message}`, recovered: true };
    }

    r.onProgress({
      type: 'unknown_recovery_strategy',
      strategy: recoveryError.strategy,
      error: recoveryError.originalError?.message || recoveryError.message,
    });
    return { response: `Unknown recovery strategy: ${recoveryError.strategy}`, recovered: true };
  }

  /**
   * Check for adaptive strategy adjustments
   */
  async checkStrategyAdjustments() {
    const r = this.runner;
    if (r.iterationCount % 5 !== 0 || !r.currentExecutionProfile) return;

    const currentMetrics = {
      recentErrorRate: r.errorRecovery.getErrorTrends().lastMinute / Math.max(1, 5),
      avgIterationTime: r.metrics.efficiency.avgStepTime,
      stuckIterations: r.getStuckIterationCount(),
      supervisionScore: r.getAverageSupervisionScore(),
    };

    const adjustments = r.adaptiveOptimizer.adjustStrategy(currentMetrics);
    if (adjustments?.length > 0) {
      r.onProgress({
        type: 'strategy_adjusted',
        adjustments,
        newProfile: r.currentExecutionProfile,
      });
    }
  }
}

export default IterationHandler;
