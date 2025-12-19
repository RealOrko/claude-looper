/**
 * useMetrics hook - Calculate derived metrics from state
 */

import { useMemo } from 'react';

// Re-export shared formatter
export { formatDuration } from '../utils/formatters.js';

/**
 * Parse duration string to milliseconds
 * @param {string} duration - Duration string (e.g., "30m", "2h")
 * @returns {number} Duration in milliseconds
 */
export function parseDuration(duration) {
  if (!duration) return 0;
  if (typeof duration === 'number') return duration;

  const match = duration.match(/^(\d+)(s|m|h|d)?$/);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2] || 'h';
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * (multipliers[unit] || multipliers.h);
}

/**
 * Custom hook for calculating derived metrics
 * @param {object} state - Application state
 * @returns {object} Derived metrics
 */
export function useMetrics(state) {
  const {
    metrics = {},
    plan,
    errors = [],
    completedSteps = [],
    failedSteps = [],
    retryMode = {},
    timeElapsed = 0,
    timeLimit,
    iteration = 0,
  } = state || {};

  // Calculate derived metrics
  const derivedMetrics = useMemo(() => {
    const totalSteps = plan?.steps?.length || 0;
    const completed = metrics?.stepsCompleted || completedSteps?.length || 0;
    const failed = metrics?.stepsFailed || failedSteps?.length || 0;
    const elapsed = metrics?.elapsedTime || timeElapsed || 0;
    const iterations = metrics?.iterations || iteration || 0;

    // Calculate success rate
    const attemptedSteps = completed + failed;
    const successRate = attemptedSteps > 0 ? ((completed / attemptedSteps) * 100).toFixed(1) : 100;

    // Time calculations
    const avgStepTime = completed > 0 ? Math.round(elapsed / completed / 1000) : 0;
    const estimatedRemaining = totalSteps > completed
      ? avgStepTime * (totalSteps - completed) * 1000
      : 0;

    // Throughput
    const stepsPerHour = elapsed > 0
      ? Math.round((completed / (elapsed / 3600000)) * 10) / 10
      : 0;
    const iterationsPerMinute = elapsed > 0
      ? ((iterations / (elapsed / 60000))).toFixed(2)
      : '0.00';

    // Error metrics
    const errorsPerIteration = iterations > 0
      ? ((errors?.length || 0) / iterations).toFixed(3)
      : '0.000';
    const errorRate = attemptedSteps > 0
      ? ((failed / attemptedSteps) * 100).toFixed(1)
      : '0.0';

    // Supervision metrics
    const interventionRate = metrics?.supervisionChecks > 0
      ? ((metrics?.interventions / metrics?.supervisionChecks) * 100).toFixed(1)
      : '0.0';

    // Retry metrics
    const retryAttempts = retryMode?.attempts?.length || 0;
    const retrySuccessRate = retryAttempts > 0
      ? ((retryMode?.attempts?.filter(a => a.confidence === 'HIGH').length / retryAttempts) * 100).toFixed(0)
      : '0';

    // Time efficiency
    const timeUsedPercent = timeLimit && elapsed > 0
      ? Math.min(100, (elapsed / parseDuration(timeLimit)) * 100).toFixed(1)
      : '0.0';

    return {
      // Completion metrics
      completionRate: totalSteps > 0 ? ((completed / totalSteps) * 100).toFixed(1) : '0.0',
      successRate,
      failureRate: errorRate,

      // Step counts
      totalSteps,
      completed,
      failed,
      pending: totalSteps - completed - failed,

      // Time metrics
      avgStepTime,
      avgStepTimeFormatted: formatDuration(avgStepTime * 1000),
      estimatedRemaining,
      estimatedRemainingFormatted: formatDuration(estimatedRemaining),
      elapsedFormatted: formatDuration(elapsed),
      timeUsedPercent,

      // Throughput
      stepsPerHour,
      iterationsPerMinute,
      iterations,

      // Error metrics
      errorCount: errors?.length || 0,
      errorsPerIteration,

      // Supervision
      supervisionChecks: metrics?.supervisionChecks || 0,
      interventions: metrics?.interventions || 0,
      interventionRate,

      // Retry
      retryAttempts,
      retrySuccessRate,
    };
  }, [metrics, plan, errors, completedSteps, failedSteps, retryMode, timeElapsed, iteration, timeLimit]);

  // Step timing data for charts
  const stepTimings = useMemo(() => {
    if (!completedSteps || completedSteps.length === 0) return [];
    return completedSteps
      .filter(s => s.duration)
      .map(s => ({
        step: s.number,
        duration: s.duration / 1000,
        complexity: s.complexity,
        description: s.description,
      }))
      .slice(-10);
  }, [completedSteps]);

  // Error distribution
  const errorDistribution = useMemo(() => {
    if (!errors || errors.length === 0) return {};

    const distribution = {};
    errors.forEach(e => {
      const type = e.type || 'unknown';
      distribution[type] = (distribution[type] || 0) + 1;
    });
    return distribution;
  }, [errors]);

  return {
    ...derivedMetrics,
    stepTimings,
    errorDistribution,
    raw: metrics,
  };
}

export default useMetrics;
