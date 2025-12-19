/**
 * Goal Progress Utility Functions
 */

// Re-export from shared formatters
export { formatDuration } from '../../utils/formatters.js';

/**
 * Gets progress bar color based on percentage
 * @param {number} percent - Progress percentage
 * @returns {string} CSS color value
 */
export function getProgressColor(percent) {
  if (percent >= 80) return '#22c55e';
  if (percent >= 50) return '#f59e0b';
  if (percent >= 20) return '#3b82f6';
  return '#6b7280';
}

/**
 * Formats large numbers with K/M suffixes
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
export function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

/**
 * Calculates step breakdown by status
 * @param {Object} plan - Plan object with steps
 * @returns {Object} Breakdown counts by status
 */
export function calculateStepBreakdown(plan) {
  if (!plan?.steps) return { pending: 0, in_progress: 0, completed: 0, failed: 0, blocked: 0 };
  return plan.steps.reduce((acc, step) => {
    const status = step.status || 'pending';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, { pending: 0, in_progress: 0, completed: 0, failed: 0, blocked: 0 });
}

/**
 * Calculates step breakdown by complexity
 * @param {Object} plan - Plan object with steps
 * @returns {Object} Breakdown counts by complexity
 */
export function calculateComplexityBreakdown(plan) {
  if (!plan?.steps) return { low: 0, medium: 0, high: 0 };
  return plan.steps.reduce((acc, step) => {
    const complexity = step.complexity || 'medium';
    acc[complexity] = (acc[complexity] || 0) + 1;
    return acc;
  }, { low: 0, medium: 0, high: 0 });
}
