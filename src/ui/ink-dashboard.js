/**
 * Ink-based Dashboard - Modern React-style terminal UI
 */

import React from 'react';
import { render, Box, Text, Static } from 'ink';
import Spinner from 'ink-spinner';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';

const e = React.createElement;

// Format duration from ms to human readable
const formatDuration = (ms) => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
};

// Progress bar component
const ProgressBar = ({ percent = 0, width = 30 }) => {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const color = percent >= 70 ? 'green' : percent >= 40 ? 'yellow' : 'cyan';

  return e(Text, null,
    e(Text, { color }, bar),
    e(Text, { color: 'gray' }, ` ${percent}%`)
  );
};

// Status badge component
const StatusBadge = ({ status }) => {
  const configs = {
    initializing: { color: 'gray', label: 'INIT' },
    running: { color: 'cyan', label: 'RUNNING' },
    verifying: { color: 'yellow', label: 'VERIFYING' },
    completed: { color: 'green', label: 'COMPLETE' },
    error: { color: 'red', label: 'ERROR' },
    aborted: { color: 'red', label: 'ABORTED' },
    stopped: { color: 'yellow', label: 'STOPPED' },
  };

  const config = configs[status] || configs.initializing;

  return e(Text, { backgroundColor: config.color, color: 'white', bold: true },
    ` ${config.label} `
  );
};

// Score display component
const ScoreDisplay = ({ score }) => {
  if (score === null || score === undefined) {
    return e(Text, { color: 'gray' }, '--');
  }
  const color = score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'red';
  return e(Text, { color, bold: true }, `${score}/100`);
};

// Header component
const Header = ({ goal, timeLimit, startTime }) => {
  return e(Box, { flexDirection: 'column', marginBottom: 1 },
    e(Gradient, { name: 'atlas' },
      e(BigText, { text: 'CLAUDE', font: 'tiny' })
    ),
    e(Text, { color: 'gray' }, 'Autonomous Runner'),
    e(Text, null, ' '),
    e(Box, { borderStyle: 'round', borderColor: 'cyan', paddingX: 2, paddingY: 1 },
      e(Text, { color: 'white', bold: true }, goal)
    ),
    e(Box, { marginTop: 1 },
      e(Text, { color: 'gray' }, 'Time Limit: '),
      e(Text, { color: 'white' }, timeLimit),
      e(Text, null, '  '),
      e(Text, { color: 'gray' }, 'Started: '),
      e(Text, { color: 'white' }, startTime ? new Date(startTime).toLocaleTimeString() : '--')
    )
  );
};

// Stats row component
const StatsRow = ({ iteration, progress, elapsed, remaining, score, issues }) => {
  return e(Box, { flexDirection: 'column', marginY: 1 },
    e(Box, null,
      e(Text, { color: 'gray' }, 'Progress: '),
      e(ProgressBar, { percent: progress, width: 25 }),
      e(Text, null, '  '),
      e(Text, { color: 'gray' }, 'Iter: '),
      e(Text, { color: 'white' }, String(iteration)),
      e(Text, null, '  '),
      e(Text, { color: 'gray' }, 'Time: '),
      e(Text, { color: 'yellow' }, remaining)
    ),
    score !== null && e(Box, { marginTop: 0 },
      e(Text, { color: 'gray' }, 'Score: '),
      e(ScoreDisplay, { score }),
      issues > 0 && e(Text, null,
        e(Text, null, '  '),
        e(Text, { color: 'yellow' }, `Issues: ${issues}/5`)
      )
    )
  );
};

// Log entry component
const LogEntry = ({ type, message, timestamp }) => {
  const colors = {
    info: 'cyan',
    success: 'green',
    warning: 'yellow',
    error: 'red',
    supervision: 'magenta',
  };

  const icons = {
    info: 'ℹ',
    success: '✓',
    warning: '⚠',
    error: '✖',
    supervision: '◎',
  };

  return e(Box, null,
    e(Text, { color: 'gray' }, `${new Date(timestamp).toLocaleTimeString()} `),
    e(Text, { color: colors[type] || 'white' }, `${icons[type] || '•'} ${message}`)
  );
};

// Main Dashboard component
const Dashboard = ({ state, logs }) => {
  const {
    goal = '',
    timeLimit = '',
    startTime = null,
    status = 'initializing',
    iteration = 0,
    progress = 0,
    elapsed = 0,
    remaining = '',
    score = null,
    consecutiveIssues = 0,
    phase = '',
  } = state;

  return e(Box, { flexDirection: 'column', padding: 1 },
    e(Header, { goal, timeLimit, startTime }),
    e(Box, { borderStyle: 'single', borderColor: 'gray', paddingX: 1, paddingY: 1 },
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
    ),
    phase && e(Box, { marginTop: 1 },
      e(Text, { color: 'gray' }, 'Phase: '),
      e(Text, { color: 'white' }, phase)
    ),
    e(Box, { flexDirection: 'column', marginTop: 1 },
      e(Box, { borderStyle: 'single', borderColor: 'gray', flexDirection: 'row', height: 8 },
        e(Box, { flexDirection: 'column', flexGrow: 1, paddingX: 1, overflow: 'hidden' },
          e(Text, { color: 'cyan', bold: true }, '─ Recent Activity ─'),
          ...(() => {
            const visible = logs.slice(-6);
            const entries = visible.map((log, index) =>
              e(LogEntry, { key: index, ...log })
            );
            // Pad with empty lines if fewer than 6 entries
            while (entries.length < 6) {
              entries.push(e(Text, { key: `empty-${entries.length}` }, ' '));
            }
            return entries;
          })()
        ),
        e(Box, { flexDirection: 'column', width: 1 },
          ...(() => {
            // Simple scrollbar visualization
            const total = logs.length;
            const barHeight = 6;
            if (total <= 6) {
              return Array(barHeight).fill(null).map((_, i) =>
                e(Text, { key: i, color: 'gray' }, '│')
              );
            }
            const scrollPos = Math.floor((total - 6) / Math.max(1, total - 6) * (barHeight - 2));
            return Array(barHeight).fill(null).map((_, i) => {
              if (i >= scrollPos && i < scrollPos + 2) {
                return e(Text, { key: i, color: 'cyan' }, '█');
              }
              return e(Text, { key: i, color: 'gray' }, '░');
            });
          })()
        )
      )
    )
  );
};

// Dashboard wrapper class for imperative API
export class InkDashboard {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.state = {
      goal: '',
      subGoals: [],
      timeLimit: '',
      startTime: null,
      status: 'initializing',
      iteration: 0,
      progress: 0,
      elapsed: 0,
      remaining: '',
      score: null,
      consecutiveIssues: 0,
      phase: '',
      sessionId: null,
    };
    this.logs = [];
    this.instance = null;
    this.rerender = null;
  }

  init(data) {
    this.state.goal = data.goal;
    this.state.subGoals = data.subGoals || [];
    this.state.timeLimit = data.timeLimit;
    this.state.startTime = Date.now();
    this.state.status = 'initialized';

    // Start Ink rendering
    const app = render(
      e(Dashboard, { state: this.state, logs: this.logs })
    );
    this.instance = app;
    this.rerender = () => {
      app.rerender(e(Dashboard, { state: {...this.state}, logs: [...this.logs] }));
    };
  }

  update() {
    if (this.rerender) {
      this.rerender();
    }
  }

  addLog(type, message) {
    this.logs.push({
      type,
      message,
      timestamp: Date.now(),
    });
    if (this.logs.length > 50) {
      this.logs = this.logs.slice(-50);
    }
    this.update();
  }

  updateProgress(data) {
    if (data.type === 'started') {
      this.state.status = 'running';
      this.state.startTime = Date.now();
      this.addLog('info', 'Starting autonomous execution...');
    } else if (data.type === 'iteration_complete') {
      this.state.iteration = data.iteration;
      this.state.progress = data.progress?.overallProgress || 0;
      this.state.sessionId = data.sessionId;
      if (data.time) {
        this.state.elapsed = data.time.elapsedMs || 0;
        this.state.remaining = data.time.remaining || '';
      }
    } else if (data.type === 'verification_started') {
      this.state.status = 'verifying';
      this.addLog('info', 'Verifying completion claim...');
    }
    this.update();
  }

  updateSupervision(data) {
    const assessment = data.assessment;
    if (!assessment) return;

    if (assessment.score !== undefined) {
      this.state.score = assessment.score;
    }
    this.state.consecutiveIssues = data.consecutiveIssues || 0;

    if (assessment.action !== 'CONTINUE') {
      this.addLog('supervision', `${assessment.action}: ${assessment.reason || 'Intervention required'}`);
    }
    this.update();
  }

  showEscalation(data) {
    const type = data.type === 'abort' ? 'error' : 'warning';
    this.addLog(type, `ESCALATION: ${data.message || data.type}`);
    this.update();
  }

  showVerification(data) {
    if (data.passed) {
      this.addLog('success', 'Completion verified');
    } else {
      this.addLog('warning', 'Completion rejected - continuing work');
    }
    this.update();
  }

  showMessage(data) {
    if (this.verbose && data.content) {
      const preview = data.content.substring(0, 100).replace(/\n/g, ' ');
      this.addLog('info', `Claude: ${preview}...`);
    }
    this.update();
  }

  showError(data) {
    this.addLog('error', data.error);
    this.update();
  }

  showReport(report) {
    this.cleanup();

    console.log('\n');
    console.log('═'.repeat(60));
    console.log(`  Status: ${report.status?.toUpperCase()}`);
    console.log(`  Progress: ${report.goal?.progress || 0}%`);
    console.log(`  Iterations: ${report.session?.iterations || 0}`);
    console.log(`  Time: ${report.time?.elapsed || 'N/A'}`);
    if (report.abortReason) {
      console.log(`  Abort Reason: ${report.abortReason}`);
    }
    console.log('═'.repeat(60));
    console.log('\n');
  }

  cleanup() {
    if (this.instance) {
      this.instance.unmount();
      this.instance = null;
    }
  }

  log(message, type = 'info') {
    this.addLog(type, message);
  }
}

export default InkDashboard;
