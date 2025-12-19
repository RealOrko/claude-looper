/**
 * LogsPanel Component
 * Main component that composes all log display functionality
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Terminal, ArrowDown, Pause } from 'lucide-react';
import LogsToolbar from './LogsToolbar.jsx';
import LogsSettings from './LogsSettings.jsx';
import LogEntry from './LogEntry.jsx';
import LogGroup from './LogGroup.jsx';
import {
  createSearchMatcher, filterLogs, groupLogsByIteration,
  countByLevel, formatLogsForDownload
} from './utils.js';

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

  // Search matcher
  const searchMatcher = useMemo(
    () => createSearchMatcher(searchQuery, useRegex, caseSensitive),
    [searchQuery, useRegex, caseSensitive]
  );

  // Filter logs
  const filteredLogs = useMemo(
    () => filterLogs(displayLogs, levelFilter, minLevel, searchMatcher),
    [displayLogs, levelFilter, minLevel, searchMatcher]
  );

  // Group logs by iteration
  const groupedLogs = useMemo(() => {
    if (!groupByIteration) return null;
    return groupLogsByIteration(filteredLogs);
  }, [filteredLogs, groupByIteration]);

  // Count by level
  const levelCounts = useMemo(() => countByLevel(displayLogs), [displayLogs]);

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
      if (next.has(logId)) next.delete(logId);
      else next.add(logId);
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
    const content = formatLogsForDownload(filteredLogs);
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

  // Highlight search matches
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
        <mark key={match.index} className="search-highlight">{match[0]}</mark>
      );
      lastIndex = match.index + match[0].length;
      if (match[0].length === 0) searchMatcher.lastIndex++;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  }, [searchMatcher]);

  return (
    <div className="logs-panel">
      <LogsToolbar
        searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        useRegex={useRegex} setUseRegex={setUseRegex}
        caseSensitive={caseSensitive} setCaseSensitive={setCaseSensitive}
        levelFilter={levelFilter} setLevelFilter={setLevelFilter}
        levelCounts={levelCounts} displayLogsLength={displayLogs.length}
        isPaused={isPaused} setIsPaused={setIsPaused}
        scrollToTop={scrollToTop} scrollToBottom={scrollToBottom}
        downloadLogs={downloadLogs} showSettings={showSettings} setShowSettings={setShowSettings}
      />

      {showSettings && (
        <LogsSettings
          showTimestamps={showTimestamps} setShowTimestamps={setShowTimestamps}
          showLineNumbers={showLineNumbers} setShowLineNumbers={setShowLineNumbers}
          wrapText={wrapText} setWrapText={setWrapText}
          groupByIteration={groupByIteration} setGroupByIteration={setGroupByIteration}
          minLevel={minLevel} setMinLevel={setMinLevel}
        />
      )}

      <div className="logs-stats">
        <span className="stat">Showing {filteredLogs.length} of {displayLogs.length} logs</span>
        {isPaused && <span className="stat paused"><Pause size={12} /> Paused</span>}
        {searchQuery && <span className="stat search">{filteredLogs.length} matches</span>}
      </div>

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
          groupedLogs.map(([iteration, iterLogs]) => (
            <LogGroup
              key={iteration}
              iteration={iteration}
              logs={iterLogs}
              expandedLogs={expandedLogs}
              copiedId={copiedId}
              showTimestamps={showTimestamps}
              showLineNumbers={showLineNumbers}
              wrapText={wrapText}
              onToggleExpand={toggleLogExpand}
              onCopy={copyLogContent}
              highlightMatches={highlightMatches}
            />
          ))
        ) : (
          filteredLogs.map((log, index) => (
            <LogEntry
              key={log.id}
              log={log}
              index={index}
              isExpanded={expandedLogs.has(log.id)}
              isCopied={copiedId === log.id}
              showTimestamps={showTimestamps}
              showLineNumbers={showLineNumbers}
              wrapText={wrapText}
              onToggleExpand={toggleLogExpand}
              onCopy={copyLogContent}
              highlightMatches={highlightMatches}
            />
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {!autoScroll && !isPaused && filteredLogs.length > 0 && (
        <button className="autoscroll-btn" onClick={scrollToBottom}>
          <ArrowDown size={14} />
          New logs available - Click to scroll
        </button>
      )}
    </div>
  );
}
