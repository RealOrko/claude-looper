/**
 * Log Components - Log entry and log viewer components
 */

import React from 'react';
import { Box, Text } from 'ink';
import { LOG_CONFIGS } from './utils.js';

const e = React.createElement;

/**
 * Single log entry component
 * @param {object} props - Component props
 * @param {string} props.type - Log type (info, success, warning, error, supervision)
 * @param {string} props.message - Log message
 * @param {number} props.timestamp - Timestamp of the log entry
 */
export const LogEntry = ({ type, message, timestamp }) => {
  const config = LOG_CONFIGS[type] || { color: 'white', icon: '•' };

  return e(Box, null,
    e(Text, { color: 'gray' }, `${new Date(timestamp).toLocaleTimeString()} `),
    e(Text, { color: config.color }, `${config.icon} ${message}`)
  );
};

/**
 * Scrollbar component for log viewer
 * @param {object} props - Component props
 * @param {number} props.total - Total number of items
 * @param {number} props.visible - Number of visible items
 * @param {number} props.height - Height of scrollbar
 */
export const Scrollbar = ({ total, visible, height }) => {
  if (total <= visible) {
    return e(Box, { flexDirection: 'column' },
      ...Array(height).fill(null).map((_, i) =>
        e(Text, { key: i, color: 'gray' }, '│')
      )
    );
  }

  const scrollPos = Math.floor((total - visible) / Math.max(1, total - visible) * (height - 2));

  return e(Box, { flexDirection: 'column' },
    ...Array(height).fill(null).map((_, i) => {
      if (i >= scrollPos && i < scrollPos + 2) {
        return e(Text, { key: i, color: 'cyan' }, '█');
      }
      return e(Text, { key: i, color: 'gray' }, '░');
    })
  );
};

/**
 * Log viewer component with scrollbar
 * @param {object} props - Component props
 * @param {Array} props.logs - Array of log entries
 * @param {number} props.maxVisible - Maximum visible entries
 * @param {number} props.height - Height of the log viewer
 */
export const LogViewer = ({ logs, maxVisible = 6, height = 8 }) => {
  const visible = logs.slice(-maxVisible);
  const entries = visible.map((log, index) =>
    e(LogEntry, { key: index, ...log })
  );

  // Pad with empty lines if fewer than maxVisible entries
  while (entries.length < maxVisible) {
    entries.push(e(Text, { key: `empty-${entries.length}` }, ' '));
  }

  return e(Box, { borderStyle: 'single', borderColor: 'gray', flexDirection: 'row', height },
    e(Box, { flexDirection: 'column', flexGrow: 1, paddingX: 1, overflow: 'hidden' },
      e(Text, { color: 'cyan', bold: true }, '─ Recent Activity ─'),
      ...entries
    ),
    e(Box, { flexDirection: 'column', width: 1 },
      e(Scrollbar, { total: logs.length, visible: maxVisible, height: maxVisible })
    )
  );
};

export default { LogEntry, Scrollbar, LogViewer };
