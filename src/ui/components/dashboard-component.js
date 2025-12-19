/**
 * Main Dashboard Component - Combines all UI components
 */

import React from 'react';
import { Box } from 'ink';
import { Header } from './header-component.js';
import { StatusPanel, PhaseIndicator } from './status-panel.js';
import { PlanDisplay } from './plan-components.js';
import { LogViewer } from './log-components.js';

const e = React.createElement;

/**
 * Main Dashboard component combining all sub-components
 * @param {object} props - Component props
 * @param {object} props.state - Dashboard state
 * @param {Array} props.logs - Log entries array
 */
export const Dashboard = ({ state, logs }) => {
  const {
    goal = '',
    timeLimit = '',
    startTime = null,
    status = 'initializing',
    iteration = 0,
    progress = 0,
    remaining = '',
    score = null,
    consecutiveIssues = 0,
    phase = '',
    plan = null,
    currentStep = 0,
  } = state;

  return e(Box, { flexDirection: 'column', paddingX: 1, paddingY: 0 },
    e(Header, { goal, timeLimit, startTime }),
    e(StatusPanel, {
      status,
      progress,
      iteration,
      remaining,
      score,
      consecutiveIssues,
    }),
    e(PhaseIndicator, { phase, plan }),
    plan && e(PlanDisplay, { plan, currentStep }),
    e(Box, { flexDirection: 'column', marginTop: 0 },
      e(LogViewer, { logs, maxVisible: 6, height: 8 })
    )
  );
};

export default Dashboard;
