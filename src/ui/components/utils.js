/**
 * Dashboard utility functions
 */

/**
 * Format duration from milliseconds to human readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string
 */
export const formatDuration = (ms) => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
};

/**
 * Status configuration for status badges
 */
export const STATUS_CONFIGS = {
  initializing: { color: 'gray', label: 'INIT' },
  initialized: { color: 'gray', label: 'INIT' },
  planning: { color: 'magenta', label: 'PLANNING' },
  running: { color: 'cyan', label: 'RUNNING' },
  verifying: { color: 'yellow', label: 'VERIFYING' },
  completed: { color: 'green', label: 'COMPLETE' },
  error: { color: 'red', label: 'ERROR' },
  aborted: { color: 'red', label: 'ABORTED' },
  stopped: { color: 'yellow', label: 'STOPPED' },
};

/**
 * Log type configurations
 */
export const LOG_CONFIGS = {
  info: { color: 'cyan', icon: 'i' },
  success: { color: 'green', icon: '✓' },
  warning: { color: 'yellow', icon: '⚠' },
  error: { color: 'red', icon: '✖' },
  supervision: { color: 'magenta', icon: '◎' },
};

/**
 * Get progress bar color based on percentage
 * @param {number} percent - Progress percentage
 * @returns {string} Color name
 */
export const getProgressColor = (percent) => {
  if (percent >= 70) return 'green';
  if (percent >= 40) return 'yellow';
  return 'cyan';
};

/**
 * Get score color based on value
 * @param {number} score - Score value
 * @returns {string} Color name
 */
export const getScoreColor = (score) => {
  if (score >= 70) return 'green';
  if (score >= 40) return 'yellow';
  return 'red';
};

export default { formatDuration, STATUS_CONFIGS, LOG_CONFIGS, getProgressColor, getScoreColor };
