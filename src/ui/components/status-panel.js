/**
 * Status Panel Component - Main status display with spinner, badge, and stats
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { ProgressBar, StatusBadge, ScoreDisplay } from './base-components.js';

const e = React.createElement;

/**
 * Status panel component showing current execution status
 * @param {object} props - Component props
 * @param {string} props.status - Current status
 * @param {number} props.progress - Progress percentage
 * @param {number} props.iteration - Current iteration
 * @param {string} props.remaining - Remaining time string
 * @param {number|null} props.score - Current score
 * @param {number} props.consecutiveIssues - Number of consecutive issues
 */
export const StatusPanel = ({
  status = 'initializing',
  progress = 0,
  iteration = 0,
  remaining = '--',
  score = null,
  consecutiveIssues = 0,
}) => {
  return e(Box, { borderStyle: 'single', borderColor: 'gray', paddingX: 1, paddingY: 0 },
    e(Box, { alignItems: 'center' },
      e(Box, { marginRight: 1 },
        status === 'running'
          ? e(Text, { color: 'cyan' }, e(Spinner, { type: 'dots' }))
          : e(Text, null, ' ')
      ),
      e(StatusBadge, { status }),
      e(Box, { marginLeft: 2, flexDirection: 'column' },
        e(Box, null,
          e(Text, { color: 'gray' }, 'Progress: '),
          e(ProgressBar, { percent: progress, width: 20 }),
          e(Text, null, '  '),
          e(Text, { color: 'gray' }, 'Iter: '),
          e(Text, { color: 'white' }, String(iteration)),
          e(Text, null, '  '),
          e(Text, { color: 'gray' }, 'Time: '),
          e(Text, { color: 'yellow' }, remaining || '--')
        ),
        score !== null && e(Box, null,
          e(Text, { color: 'gray' }, 'Score: '),
          e(ScoreDisplay, { score }),
          consecutiveIssues > 0 && e(Text, { color: 'yellow' }, `  Issues: ${consecutiveIssues}/5`)
        )
      )
    )
  );
};

/**
 * Phase indicator component
 * @param {object} props - Component props
 * @param {string} props.phase - Current phase
 * @param {object|null} props.plan - Current plan (if any)
 */
export const PhaseIndicator = ({ phase, plan }) => {
  if (!phase || plan) return null;

  return e(Box, { marginTop: 0 },
    e(Text, { color: 'gray' }, 'Phase: '),
    e(Text, { color: 'white' }, phase)
  );
};

export default { StatusPanel, PhaseIndicator };
