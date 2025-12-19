/**
 * LogsPanel Utility Functions
 */
import { levelPriority } from './constants.js';

/**
 * Format timestamp to time string with milliseconds
 * @param {number} timestamp - Timestamp in milliseconds
 * @returns {string} Formatted time string
 */
export function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  });
}

/**
 * Create search regex from query
 * @param {string} query - Search query
 * @param {boolean} useRegex - Whether to use regex mode
 * @param {boolean} caseSensitive - Whether search is case sensitive
 * @returns {RegExp|null} Compiled regex or null
 */
export function createSearchMatcher(query, useRegex, caseSensitive) {
  if (!query) return null;

  try {
    if (useRegex) {
      return new RegExp(query, caseSensitive ? 'g' : 'gi');
    } else {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(escaped, caseSensitive ? 'g' : 'gi');
    }
  } catch {
    return null;
  }
}

/**
 * Filter logs based on level and search criteria
 * @param {Array} logs - Array of log entries
 * @param {string} levelFilter - Specific level or 'all'
 * @param {string} minLevel - Minimum level to show
 * @param {RegExp|null} searchMatcher - Search regex
 * @returns {Array} Filtered logs
 */
export function filterLogs(logs, levelFilter, minLevel, searchMatcher) {
  return logs.filter(log => {
    // Level filter (specific level or minimum)
    if (levelFilter !== 'all') {
      if (log.level !== levelFilter) return false;
    } else if (minLevel !== 'debug') {
      const logPriority = levelPriority[log.level] ?? 0;
      const minPriority = levelPriority[minLevel] ?? 0;
      if (logPriority < minPriority) return false;
    }

    // Search filter
    if (searchMatcher) {
      const searchText = `${log.message} ${log.full || ''}`;
      if (!searchMatcher.test(searchText)) return false;
      searchMatcher.lastIndex = 0; // Reset regex state
    }

    return true;
  });
}

/**
 * Group logs by iteration
 * @param {Array} logs - Array of log entries
 * @returns {Array} Array of [iteration, logs] tuples sorted by iteration descending
 */
export function groupLogsByIteration(logs) {
  const groups = new Map();
  logs.forEach(log => {
    const iteration = log.iteration || 0;
    if (!groups.has(iteration)) {
      groups.set(iteration, []);
    }
    groups.get(iteration).push(log);
  });

  return Array.from(groups.entries()).sort((a, b) => b[0] - a[0]);
}

/**
 * Count logs by level
 * @param {Array} logs - Array of log entries
 * @returns {Object} Object with level counts
 */
export function countByLevel(logs) {
  return logs.reduce((acc, log) => {
    acc[log.level] = (acc[log.level] || 0) + 1;
    return acc;
  }, {});
}

/**
 * Format logs for download
 * @param {Array} logs - Array of log entries
 * @returns {string} Formatted log content
 */
export function formatLogsForDownload(logs) {
  return logs.map(log =>
    `[${new Date(log.timestamp).toISOString()}] [${log.level.toUpperCase()}]${log.iteration ? ` [#${log.iteration}]` : ''} ${log.full || log.message}`
  ).join('\n');
}
