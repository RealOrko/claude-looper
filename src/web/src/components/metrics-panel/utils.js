/**
 * MetricsPanel Utility Functions
 */

// Re-export shared formatters
export { formatDuration, formatTime } from '../../utils/formatters.js';

/**
 * Parse duration string to milliseconds
 * @param {string} timeStr - Duration string (e.g., "1h", "30m", "45s")
 * @returns {number} Duration in milliseconds
 */
export function parseDuration(timeStr) {
  if (!timeStr) return 0;
  const match = timeStr.match(/^(\d+)([hms])$/);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'h': return value * 3600000;
    case 'm': return value * 60000;
    case 's': return value * 1000;
    default: return 0;
  }
}

/**
 * Calculate derived metrics from state
 * @param {Object} params - State and configuration
 * @returns {Object} Derived metrics object
 */
export function calculateDerivedMetrics({
  metrics, plan, errors, completedSteps, failedSteps,
  retryMode, timeElapsed, iteration, timeLimit
}) {
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
    : 0;

  // Error metrics
  const errorsPerIteration = iterations > 0
    ? ((errors?.length || 0) / iterations).toFixed(3)
    : 0;
  const errorRate = attemptedSteps > 0
    ? ((failed / attemptedSteps) * 100).toFixed(1)
    : 0;

  // Supervision metrics
  const interventionRate = metrics?.supervisionChecks > 0
    ? ((metrics?.interventions / metrics?.supervisionChecks) * 100).toFixed(1)
    : 0;

  // Retry metrics
  const retryAttempts = retryMode?.attempts?.length || 0;
  const retrySuccessRate = retryAttempts > 0
    ? ((retryMode?.attempts?.filter(a => a.confidence === 'HIGH').length / retryAttempts) * 100).toFixed(0)
    : 0;

  // Time efficiency
  const timeUsedPercent = timeLimit && elapsed > 0
    ? Math.min(100, (elapsed / parseDuration(timeLimit)) * 100).toFixed(1)
    : 0;

  return {
    completionRate: totalSteps > 0 ? ((completed / totalSteps) * 100).toFixed(1) : 0,
    failureRate: errorRate,
    successRate,
    avgStepTime,
    estimatedRemaining,
    stepsPerHour,
    iterationsPerMinute,
    errorsPerIteration,
    interventionRate,
    retryAttempts,
    retrySuccessRate,
    timeUsedPercent,
    totalSteps,
    completed,
    failed,
    pending: totalSteps - completed - failed,
  };
}

/**
 * Calculate step timing data for chart
 * @param {Array} completedSteps - Array of completed steps
 * @returns {Array} Step timing data
 */
export function calculateStepTimings(completedSteps) {
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
}

/**
 * Calculate complexity statistics
 * @param {Array} completedSteps - Array of completed steps
 * @returns {Array} Complexity statistics
 */
export function calculateComplexityStats(completedSteps) {
  if (!completedSteps || completedSteps.length === 0) return [];

  const stats = { low: [], medium: [], high: [] };
  completedSteps.forEach(s => {
    if (s.duration && s.complexity) {
      stats[s.complexity]?.push(s.duration / 1000);
    }
  });

  return Object.entries(stats).map(([complexity, durations]) => ({
    complexity,
    count: durations.length,
    avgTime: durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0,
    maxTime: durations.length > 0 ? Math.round(Math.max(...durations)) : 0,
    minTime: durations.length > 0 ? Math.round(Math.min(...durations)) : 0,
  }));
}

/**
 * Calculate retry history data
 * @param {Object} retryMode - Retry mode state
 * @returns {Array} Retry history data
 */
export function calculateRetryHistory(retryMode) {
  if (!retryMode?.attempts || retryMode.attempts.length === 0) return [];
  return retryMode.attempts.map(attempt => ({
    number: attempt.number,
    confidence: attempt.confidence,
    duration: Math.round((attempt.duration || 0) / 1000),
    completedSteps: attempt.completedSteps || 0,
    failedSteps: attempt.failedSteps || 0,
  }));
}
