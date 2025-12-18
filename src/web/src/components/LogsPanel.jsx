import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Search, Filter, Download, Trash2, ArrowDown, ArrowUp,
  Info, CheckCircle2, AlertTriangle, XCircle, Terminal, ChevronDown,
  Clock, Hash, Layers, X, Copy, Check, RefreshCw, Pause, Play,
  ChevronRight, Settings, Eye, EyeOff
} from 'lucide-react';

const levelIcons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  output: Terminal,
  debug: Hash,
};

const levelColors = {
  info: '#3b82f6',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  output: '#8b5cf6',
  debug: '#6b7280',
};

const levelPriority = {
  error: 4,
  warning: 3,
  success: 2,
  info: 1,
  output: 0,
  debug: -1,
};

export default function LogsPanel({ logs = [], onClearLogs }) {
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [levelFilter, setLevelFilter] = useState('all');
  const [minLevel, setMinLevel] = useState('debug');

  // View state
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState(new Set());
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [groupByIteration, setGroupByIteration] = useState(false);
  const [wrapText, setWrapText] = useState(true);

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [highlightedText, setHighlightedText] = useState('');

  // Refs
  const logsEndRef = useRef(null);
  const containerRef = useRef(null);
  const pausedLogsRef = useRef([]);

  // Store logs when paused
  useEffect(() => {
    if (!isPaused) {
      pausedLogsRef.current = logs;
    }
  }, [logs, isPaused]);

  const displayLogs = isPaused ? pausedLogsRef.current : logs;

  // Search with regex support
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

  // Filter logs
  const filteredLogs = useMemo(() => {
    return displayLogs.filter(log => {
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
  }, [displayLogs, levelFilter, minLevel, searchMatcher]);

  // Group logs by iteration
  const groupedLogs = useMemo(() => {
    if (!groupByIteration) return null;

    const groups = new Map();
    filteredLogs.forEach(log => {
      const iteration = log.iteration || 0;
      if (!groups.has(iteration)) {
        groups.set(iteration, []);
      }
      groups.get(iteration).push(log);
    });

    return Array.from(groups.entries()).sort((a, b) => b[0] - a[0]);
  }, [filteredLogs, groupByIteration]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && !isPaused && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLogs, autoScroll, isPaused]);

  // Detect manual scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  const toggleLogExpand = useCallback((logId) => {
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

  const copyLogContent = useCallback(async (log) => {
    const content = log.full || log.message;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(log.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  const downloadLogs = useCallback(() => {
    const content = filteredLogs.map(log =>
      `[${new Date(log.timestamp).toISOString()}] [${log.level.toUpperCase()}]${log.iteration ? ` [#${log.iteration}]` : ''} ${log.full || log.message}`
    ).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claude-runner-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredLogs]);

  const scrollToBottom = useCallback(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setAutoScroll(true);
  }, []);

  const scrollToTop = useCallback(() => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setAutoScroll(false);
  }, []);

  // Count by level
  const levelCounts = useMemo(() => {
    return displayLogs.reduce((acc, log) => {
      acc[log.level] = (acc[log.level] || 0) + 1;
      return acc;
    }, {});
  }, [displayLogs]);

  // Highlight search matches in text
  const highlightMatches = useCallback((text) => {
    if (!searchMatcher || !text) return text;

    const parts = [];
    let lastIndex = 0;
    let match;

    searchMatcher.lastIndex = 0;
    while ((match = searchMatcher.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      parts.push(
        <mark key={match.index} className="search-highlight">
          {match[0]}
        </mark>
      );
      lastIndex = match.index + match[0].length;

      // Prevent infinite loop with zero-length matches
      if (match[0].length === 0) {
        searchMatcher.lastIndex++;
      }
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  }, [searchMatcher]);

  // Render a single log entry
  const renderLogEntry = (log, index) => {
    const Icon = levelIcons[log.level] || Info;
    const isExpanded = expandedLogs.has(log.id);
    const hasFullContent = log.full && log.full !== log.message;
    const isCopied = copiedId === log.id;

    return (
      <div
        key={log.id}
        className={`log-entry ${log.level} ${isExpanded ? 'expanded' : ''}`}
      >
        <div className="log-header" onClick={() => hasFullContent && toggleLogExpand(log.id)}>
          {showLineNumbers && (
            <span className="log-line-number">{index + 1}</span>
          )}
          <Icon
            size={14}
            className="log-icon"
            style={{ color: levelColors[log.level] }}
          />
          {showTimestamps && (
            <span className="log-time">
              <Clock size={10} />
              {formatTime(log.timestamp)}
            </span>
          )}
          <span className="log-level" style={{ color: levelColors[log.level] }}>
            {log.level}
          </span>
          {log.iteration && (
            <span className="log-iteration">
              <Hash size={10} />
              {log.iteration}
            </span>
          )}
          <div className="log-actions">
            <button
              className="log-action-btn"
              onClick={(e) => { e.stopPropagation(); copyLogContent(log); }}
              title="Copy to clipboard"
            >
              {isCopied ? <Check size={12} /> : <Copy size={12} />}
            </button>
            {hasFullContent && (
              <ChevronDown
                size={14}
                className={`expand-icon ${isExpanded ? 'expanded' : ''}`}
              />
            )}
          </div>
        </div>
        <div className={`log-message ${wrapText ? 'wrap' : 'nowrap'}`}>
          {isExpanded && hasFullContent
            ? highlightMatches(log.full)
            : highlightMatches(log.message)}
        </div>
      </div>
    );
  };

  // Render grouped logs
  const renderGroupedLogs = () => {
    if (!groupedLogs) return null;

    return groupedLogs.map(([iteration, iterLogs]) => (
      <div key={iteration} className="log-group">
        <div className="log-group-header">
          <Layers size={14} />
          <span>Iteration {iteration || 'Initial'}</span>
          <span className="log-group-count">{iterLogs.length} logs</span>
        </div>
        <div className="log-group-content">
          {iterLogs.map((log, i) => renderLogEntry(log, i))}
        </div>
      </div>
    ));
  };

  return (
    <div className="logs-panel">
      {/* Toolbar */}
      <div className="logs-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder={useRegex ? "Search with regex..." : "Search logs..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search" onClick={() => setSearchQuery('')}>
              <X size={14} />
            </button>
          )}
          <div className="search-options">
            <button
              className={`search-option ${useRegex ? 'active' : ''}`}
              onClick={() => setUseRegex(!useRegex)}
              title="Use regular expression"
            >
              .*
            </button>
            <button
              className={`search-option ${caseSensitive ? 'active' : ''}`}
              onClick={() => setCaseSensitive(!caseSensitive)}
              title="Case sensitive"
            >
              Aa
            </button>
          </div>
        </div>

        <div className="level-filters">
          <button
            className={`level-btn ${levelFilter === 'all' ? 'active' : ''}`}
            onClick={() => setLevelFilter('all')}
          >
            All ({displayLogs.length})
          </button>
          {Object.entries(levelCounts)
            .sort((a, b) => (levelPriority[b[0]] || 0) - (levelPriority[a[0]] || 0))
            .map(([level, count]) => {
              const Icon = levelIcons[level] || Info;
              return (
                <button
                  key={level}
                  className={`level-btn ${levelFilter === level ? 'active' : ''}`}
                  onClick={() => setLevelFilter(levelFilter === level ? 'all' : level)}
                  style={{ '--level-color': levelColors[level] }}
                >
                  <Icon size={14} />
                  <span>{count}</span>
                </button>
              );
            })}
        </div>

        <div className="toolbar-actions">
          <button
            className={`toolbar-btn ${isPaused ? 'active' : ''}`}
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? "Resume live updates" : "Pause live updates"}
          >
            {isPaused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            className="toolbar-btn"
            onClick={scrollToTop}
            title="Scroll to top"
          >
            <ArrowUp size={16} />
          </button>
          <button
            className="toolbar-btn"
            onClick={scrollToBottom}
            title="Scroll to bottom"
          >
            <ArrowDown size={16} />
          </button>
          <button
            className="toolbar-btn"
            onClick={downloadLogs}
            title="Download logs"
          >
            <Download size={16} />
          </button>
          <button
            className={`toolbar-btn ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="logs-settings">
          <label className="setting-toggle">
            <input
              type="checkbox"
              checked={showTimestamps}
              onChange={(e) => setShowTimestamps(e.target.checked)}
            />
            <span>Show timestamps</span>
          </label>
          <label className="setting-toggle">
            <input
              type="checkbox"
              checked={showLineNumbers}
              onChange={(e) => setShowLineNumbers(e.target.checked)}
            />
            <span>Show line numbers</span>
          </label>
          <label className="setting-toggle">
            <input
              type="checkbox"
              checked={wrapText}
              onChange={(e) => setWrapText(e.target.checked)}
            />
            <span>Wrap long lines</span>
          </label>
          <label className="setting-toggle">
            <input
              type="checkbox"
              checked={groupByIteration}
              onChange={(e) => setGroupByIteration(e.target.checked)}
            />
            <span>Group by iteration</span>
          </label>
          <div className="setting-row">
            <span>Minimum level:</span>
            <select
              value={minLevel}
              onChange={(e) => setMinLevel(e.target.value)}
            >
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </select>
          </div>
        </div>
      )}

      {/* Stats Bar */}
      <div className="logs-stats">
        <span className="stat">
          Showing {filteredLogs.length} of {displayLogs.length} logs
        </span>
        {isPaused && (
          <span className="stat paused">
            <Pause size={12} /> Paused
          </span>
        )}
        {searchQuery && (
          <span className="stat search">
            {filteredLogs.length} matches
          </span>
        )}
      </div>

      {/* Logs Container */}
      <div
        className={`logs-container ${wrapText ? 'wrap-text' : ''}`}
        ref={containerRef}
        onScroll={handleScroll}
      >
        {filteredLogs.length === 0 ? (
          <div className="empty-logs">
            <Terminal size={48} className="empty-icon" />
            <p>{searchQuery ? 'No matching logs found' : 'No logs yet'}</p>
            {searchQuery && (
              <button className="clear-filter-btn" onClick={() => setSearchQuery('')}>
                Clear search
              </button>
            )}
          </div>
        ) : groupByIteration ? (
          renderGroupedLogs()
        ) : (
          filteredLogs.map((log, index) => renderLogEntry(log, index))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && !isPaused && filteredLogs.length > 0 && (
        <button className="autoscroll-btn" onClick={scrollToBottom}>
          <ArrowDown size={14} />
          New logs available - Click to scroll
        </button>
      )}
    </div>
  );
}

function formatTime(timestamp) {
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
