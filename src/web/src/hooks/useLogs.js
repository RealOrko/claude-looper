/**
 * useLogs hook - Log filtering, searching, and management
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';

/**
 * Log level configuration
 */
export const LOG_LEVELS = {
  icons: {
    info: 'Info',
    success: 'CheckCircle2',
    warning: 'AlertTriangle',
    error: 'XCircle',
    output: 'Terminal',
    debug: 'Hash',
  },
  colors: {
    info: '#3b82f6',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    output: '#8b5cf6',
    debug: '#6b7280',
  },
  priority: {
    error: 4,
    warning: 3,
    success: 2,
    info: 1,
    output: 0,
    debug: -1,
  },
};

/**
 * Custom hook for log management with filtering and search
 * @param {Array} logs - Array of log entries
 * @param {object} options - Configuration options
 * @returns {object} Log management state and utilities
 */
export function useLogs(logs = [], options = {}) {
  const { maxLogs = 1000 } = options;

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [levelFilter, setLevelFilter] = useState('all');
  const [minLevel, setMinLevel] = useState('debug');

  // View state
  const [isPaused, setIsPaused] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState(new Set());

  // Paused logs cache
  const pausedLogsRef = useRef([]);

  // Store logs when paused
  useEffect(() => {
    if (!isPaused) {
      pausedLogsRef.current = logs;
    }
  }, [logs, isPaused]);

  const displayLogs = isPaused ? pausedLogsRef.current : logs;

  // Search matcher with regex support
  const searchMatcher = useMemo(() => {
    if (!searchQuery) return null;

    try {
      if (useRegex) {
        return new RegExp(searchQuery, caseSensitive ? 'g' : 'gi');
      } else {
        const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escaped, caseSensitive ? 'g' : 'gi');
      }
    } catch {
      return null;
    }
  }, [searchQuery, useRegex, caseSensitive]);

  // Filter logs by level and search query
  const filteredLogs = useMemo(() => {
    return displayLogs.filter(log => {
      // Level filter (specific level or minimum)
      if (levelFilter !== 'all') {
        if (log.level !== levelFilter) return false;
      } else if (minLevel !== 'debug') {
        const logPriority = LOG_LEVELS.priority[log.level] ?? 0;
        const minPriority = LOG_LEVELS.priority[minLevel] ?? 0;
        if (logPriority < minPriority) return false;
      }

      // Search filter
      if (searchMatcher) {
        const message = log.message || '';
        const full = log.full || '';
        return searchMatcher.test(message) || searchMatcher.test(full);
      }

      return true;
    }).slice(-maxLogs);
  }, [displayLogs, levelFilter, minLevel, searchMatcher, maxLogs]);

  // Group logs by iteration
  const groupedLogs = useMemo(() => {
    const groups = new Map();

    filteredLogs.forEach(log => {
      const key = log.iteration ?? 'unknown';
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(log);
    });

    return groups;
  }, [filteredLogs]);

  // Toggle log expansion
  const toggleExpanded = useCallback((logId) => {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  }, []);

  // Check if log is expanded
  const isExpanded = useCallback((logId) => {
    return expandedLogs.has(logId);
  }, [expandedLogs]);

  // Expand all logs
  const expandAll = useCallback(() => {
    setExpandedLogs(new Set(filteredLogs.map(log => log.id)));
  }, [filteredLogs]);

  // Collapse all logs
  const collapseAll = useCallback(() => {
    setExpandedLogs(new Set());
  }, []);

  // Clear search
  const clearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  // Reset filters
  const resetFilters = useCallback(() => {
    setSearchQuery('');
    setLevelFilter('all');
    setMinLevel('debug');
    setUseRegex(false);
    setCaseSensitive(false);
  }, []);

  // Get log statistics
  const stats = useMemo(() => {
    const counts = { total: displayLogs.length, filtered: filteredLogs.length };
    Object.keys(LOG_LEVELS.priority).forEach(level => {
      counts[level] = displayLogs.filter(log => log.level === level).length;
    });
    return counts;
  }, [displayLogs, filteredLogs]);

  return {
    // Filtered data
    filteredLogs,
    groupedLogs,
    stats,

    // Search state
    searchQuery,
    setSearchQuery,
    useRegex,
    setUseRegex,
    caseSensitive,
    setCaseSensitive,
    searchMatcher,
    clearSearch,

    // Filter state
    levelFilter,
    setLevelFilter,
    minLevel,
    setMinLevel,
    resetFilters,

    // Pause state
    isPaused,
    setIsPaused,
    togglePause: () => setIsPaused(p => !p),

    // Expansion state
    expandedLogs,
    toggleExpanded,
    isExpanded,
    expandAll,
    collapseAll,
  };
}

export default useLogs;
