/**
 * LogEntry Component
 * Single log entry display with expand/copy functionality
 */
import React from 'react';
import { Clock, Hash, Copy, Check, ChevronDown } from 'lucide-react';
import { levelIconComponents } from './icons.js';
import { levelColors } from './constants.js';
import { formatTime } from './utils.js';

export default function LogEntry({
  log, index, isExpanded, isCopied, showTimestamps, showLineNumbers,
  wrapText, onToggleExpand, onCopy, highlightMatches
}) {
  const Icon = levelIconComponents[log.level] || levelIconComponents.info;
  const hasFullContent = log.full && log.full !== log.message;

  return (
    <div className={`log-entry ${log.level} ${isExpanded ? 'expanded' : ''}`}>
      <div className="log-header" onClick={() => hasFullContent && onToggleExpand(log.id)}>
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
            onClick={(e) => { e.stopPropagation(); onCopy(log); }}
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
}
