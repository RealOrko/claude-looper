/**
 * Shared formatting utilities for web components
 */

/**
 * Format milliseconds to human-readable duration
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string
 */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Format milliseconds to compact duration (for UI)
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Compact duration string
 */
export function formatDurationCompact(ms) {
  if (!ms || ms < 0) return '0:00';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Format timestamp to time string
 * @param {number} timestamp - Timestamp in milliseconds
 * @returns {string} Formatted time string (HH:MM:SS)
 */
export function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Truncate text to specified length with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
export function truncateText(text, maxLength = 50) {
  if (!text || text.length <= maxLength) return text || '';
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Format percentage with one decimal place
 * @param {number} value - Value to format
 * @returns {string} Formatted percentage
 */
export function formatPercent(value) {
  if (value === null || value === undefined || isNaN(value)) return '0%';
  return `${value.toFixed(1)}%`;
}

/**
 * Format number with thousand separators
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
export function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return num.toLocaleString();
}
