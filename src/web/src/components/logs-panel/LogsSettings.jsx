/**
 * LogsSettings Component
 * Settings panel for log display options
 */
import React from 'react';

export default function LogsSettings({
  showTimestamps, setShowTimestamps,
  showLineNumbers, setShowLineNumbers,
  wrapText, setWrapText,
  groupByIteration, setGroupByIteration,
  minLevel, setMinLevel
}) {
  return (
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
        <select value={minLevel} onChange={(e) => setMinLevel(e.target.value)}>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </select>
      </div>
    </div>
  );
}
