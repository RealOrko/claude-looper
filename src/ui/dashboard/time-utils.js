/**
 * Dashboard Time Utilities - Time parsing and calculation
 */

/**
 * Parse time limit string to milliseconds
 * @param {string} str - Time limit string (e.g., "30m", "2h", "1d")
 * @returns {number} Time in milliseconds
 */
export function parseTimeLimit(str) {
  const match = str.match(/^(\d+)(m|h|d)?$/);
  if (!match) return 2 * 60 * 60 * 1000; // default 2h

  const value = parseInt(match[1], 10);
  const unit = match[2] || 'h';
  const multipliers = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * multipliers[unit];
}

/**
 * Format duration in ms to human-readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
export function formatDuration(ms) {
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
}

/**
 * Calculate time information for progress display
 * @param {number} elapsed - Elapsed time in ms
 * @param {string} timeLimitStr - Time limit string
 * @returns {object} Time info object
 */
export function calculateTimeInfo(elapsed, timeLimitStr) {
  const timeLimitMs = parseTimeLimit(timeLimitStr);
  const remaining = Math.max(0, timeLimitMs - elapsed);
  const percentRemaining = (remaining / timeLimitMs) * 100;

  return {
    elapsed: formatDuration(elapsed),
    remaining: formatDuration(remaining),
    percentUsed: Math.round((elapsed / timeLimitMs) * 100),
    percentRemaining: Math.round(percentRemaining),
  };
}

/**
 * Get time color based on remaining percentage
 * @param {number} percentRemaining - Percentage of time remaining
 * @returns {string} Color name
 */
export function getTimeColor(percentRemaining) {
  if (percentRemaining > 20) return 'green';
  if (percentRemaining > 5) return 'yellow';
  return 'red';
}

export default { parseTimeLimit, formatDuration, calculateTimeInfo, getTimeColor };
