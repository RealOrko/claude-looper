/**
 * LogsToolbar Component
 * Search, filter, and action controls for logs
 */
import React from 'react';
import {
  Search, X, ArrowDown, ArrowUp, Download, Settings, Pause, Play
} from 'lucide-react';
import { levelIconComponents } from './icons.js';
import { levelColors, levelPriority } from './constants.js';

export default function LogsToolbar({
  searchQuery, setSearchQuery, useRegex, setUseRegex,
  caseSensitive, setCaseSensitive, levelFilter, setLevelFilter,
  levelCounts, displayLogsLength, isPaused, setIsPaused,
  scrollToTop, scrollToBottom, downloadLogs, showSettings, setShowSettings
}) {
  return (
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
          All ({displayLogsLength})
        </button>
        {Object.entries(levelCounts)
          .sort((a, b) => (levelPriority[b[0]] || 0) - (levelPriority[a[0]] || 0))
          .map(([level, count]) => {
            const Icon = levelIconComponents[level] || levelIconComponents.info;
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
        <button className="toolbar-btn" onClick={scrollToTop} title="Scroll to top">
          <ArrowUp size={16} />
        </button>
        <button className="toolbar-btn" onClick={scrollToBottom} title="Scroll to bottom">
          <ArrowDown size={16} />
        </button>
        <button className="toolbar-btn" onClick={downloadLogs} title="Download logs">
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
  );
}
