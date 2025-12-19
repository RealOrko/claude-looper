/**
 * LogGroup Component
 * Group of logs for a single iteration
 */
import React from 'react';
import { Layers } from 'lucide-react';
import LogEntry from './LogEntry.jsx';

export default function LogGroup({
  iteration, logs, expandedLogs, copiedId, showTimestamps, showLineNumbers,
  wrapText, onToggleExpand, onCopy, highlightMatches
}) {
  return (
    <div className="log-group">
      <div className="log-group-header">
        <Layers size={14} />
        <span>Iteration {iteration || 'Initial'}</span>
        <span className="log-group-count">{logs.length} logs</span>
      </div>
      <div className="log-group-content">
        {logs.map((log, i) => (
          <LogEntry
            key={log.id}
            log={log}
            index={i}
            isExpanded={expandedLogs.has(log.id)}
            isCopied={copiedId === log.id}
            showTimestamps={showTimestamps}
            showLineNumbers={showLineNumbers}
            wrapText={wrapText}
            onToggleExpand={onToggleExpand}
            onCopy={onCopy}
            highlightMatches={highlightMatches}
          />
        ))}
      </div>
    </div>
  );
}
