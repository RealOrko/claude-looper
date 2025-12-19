/**
 * Base UI Components - Small reusable Ink/React components
 */

import React from 'react';
import { Box, Text } from 'ink';
import { STATUS_CONFIGS, getProgressColor, getScoreColor } from './utils.js';

const e = React.createElement;

/**
 * Progress bar component
 * @param {object} props - Component props
 * @param {number} props.percent - Progress percentage (0-100)
 * @param {number} props.width - Width of the progress bar in characters
 */
export const ProgressBar = ({ percent = 0, width = 30 }) => {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const color = getProgressColor(percent);

  return e(Text, null,
    e(Text, { color }, bar),
    e(Text, { color: 'gray' }, ` ${percent}%`)
  );
};

/**
 * Status badge component
 * @param {object} props - Component props
 * @param {string} props.status - Status value
 */
export const StatusBadge = ({ status }) => {
  const config = STATUS_CONFIGS[status] || STATUS_CONFIGS.initializing;

  return e(Text, { backgroundColor: config.color, color: 'white', bold: true },
    ` ${config.label} `
  );
};

/**
 * Score display component
 * @param {object} props - Component props
 * @param {number|null} props.score - Score value (0-100) or null
 */
export const ScoreDisplay = ({ score }) => {
  if (score === null || score === undefined) {
    return e(Text, { color: 'gray' }, '--');
  }
  const color = getScoreColor(score);
  return e(Text, { color, bold: true }, `${score}/100`);
};

export default { ProgressBar, StatusBadge, ScoreDisplay };
