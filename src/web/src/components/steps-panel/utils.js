/**
 * StepsPanel Utility Functions
 */

// Re-export from shared formatters
export { formatDuration, truncateText } from '../../utils/formatters.js';

/**
 * Calculate step statistics from steps array
 * @param {Array} steps - Array of step objects
 * @returns {Object} Statistics object
 */
export function calculateStepStats(steps) {
  return {
    completed: steps.filter(s => s.status === 'completed').length,
    failed: steps.filter(s => s.status === 'failed' || s.status === 'blocked').length,
    inProgress: steps.filter(s => s.status === 'in_progress').length,
    pending: steps.filter(s => s.status === 'pending' || !s.status).length,
  };
}
