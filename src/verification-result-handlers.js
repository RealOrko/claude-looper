/**
 * Verification Result Handlers
 * Helper functions for processing verification results and recording metrics
 */

/**
 * Record step completion metrics and state
 * @param {Object} runner - The runner instance
 * @param {Object} completedStep - The completed step
 * @param {number} stepDuration - Duration in milliseconds
 */
export function recordStepCompletion(runner, completedStep, stepDuration) {
  runner.metrics.recordStepExecution(
    completedStep.number,
    'completed',
    stepDuration,
    { complexity: completedStep.complexity }
  );
}

/**
 * Persist step progress to storage
 * @param {Object} runner - The runner instance
 * @param {Object} completedStep - The completed step
 * @param {number} stepDuration - Duration in milliseconds
 */
export async function persistStepProgress(runner, completedStep, stepDuration) {
  if (!runner.enablePersistence) return;

  await runner.statePersistence.updateStepProgress(
    completedStep.number,
    'completed',
    { duration: stepDuration }
  );

  const progress = runner.planner.getProgress();
  if (progress.completed % 3 === 0) {
    await runner.statePersistence.createCheckpoint(
      `step_${completedStep.number}_complete`,
      runner.planner.plan
    );
  }
}

/**
 * Record adaptive optimizer metrics for completed step
 * @param {Object} runner - The runner instance
 * @param {Object} completedStep - The completed step
 * @param {number} stepDuration - Duration in milliseconds
 */
export function recordAdaptiveMetrics(runner, completedStep, stepDuration) {
  const taskType = runner.adaptiveOptimizer.classifyTask(completedStep.description);
  runner.adaptiveOptimizer.recordTaskPerformance(taskType, {
    duration: stepDuration,
    success: true,
    iterations: 1,
  });

  if (runner.currentExecutionProfile) {
    runner.adaptiveOptimizer.recordStrategyEffectiveness(
      runner.currentExecutionProfile.primaryStrategy,
      true,
      { duration: stepDuration }
    );
  }
}

/**
 * Generate rejection prompt for step verification failure
 * @param {Object} rejectedStep - The rejected step
 * @param {Object} stepVerification - The verification result
 * @returns {string} The rejection prompt
 */
export function generateStepRejectionPrompt(rejectedStep, stepVerification) {
  return `## Step Not Complete

Your claim that Step ${rejectedStep.number} ("${rejectedStep.description}") is complete was not verified.

Reason: ${stepVerification.reason}

Please continue working on this step and say "STEP COMPLETE" only when it is truly finished.`;
}

/**
 * Track token usage from a result
 * @param {Object} runner - The runner instance
 * @param {Object} result - Result with token info
 */
export function trackTokenUsage(runner, result) {
  if (result.tokensIn || result.tokensOut) {
    runner.contextManager.trackTokenUsage(
      result.tokensIn || 0,
      result.tokensOut || 0
    );
  }
}

/**
 * Determine if goal verification passed based on achievement status
 * @param {*} achieved - The achieved value (truthy/falsy/inconclusive)
 * @param {number} percentComplete - Percentage of steps completed
 * @param {Function} isTruthy - Truthy check function
 * @param {Function} isFalsy - Falsy check function
 * @returns {boolean} Whether verification passed
 */
export function determineGoalVerificationPassed(achieved, percentComplete, isTruthy, isFalsy) {
  if (isTruthy(achieved)) {
    return true;
  }
  if (isFalsy(achieved)) {
    return false;
  }
  // Inconclusive - pass if most steps completed
  return percentComplete >= 70;
}

/**
 * Build goal verification failure reason
 * @param {boolean} verificationInconclusive - Whether verification was inconclusive
 * @param {number} percentComplete - Percentage of steps completed
 * @param {string} goalReason - Reason from goal verification
 * @returns {string} The failure reason
 */
export function buildGoalFailureReason(verificationInconclusive, percentComplete, goalReason) {
  if (verificationInconclusive) {
    return `Verification inconclusive and steps incomplete (${percentComplete}%)`;
  }
  return `Goal not achieved: ${goalReason}`;
}
