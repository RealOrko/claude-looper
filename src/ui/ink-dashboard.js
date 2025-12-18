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
    planning: { color: 'magenta', label: 'PLANNING' },
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
  return e(Box, { flexDirection: 'column', marginBottom: 0 },
    e(Gradient, { name: 'atlas' },
      e(BigText, { text: 'CLAUDE', font: 'tiny' })
    ),
    e(Text, { color: 'gray' }, 'Autonomous Runner'),
    e(Box, { borderStyle: 'round', borderColor: 'cyan', paddingX: 1, paddingY: 0, marginTop: 0 },
      e(Text, { color: 'white', bold: true }, goal)
    ),
    e(Box, { marginTop: 0 },
      e(Text, { color: 'gray' }, 'Time: '),
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

// Plan step component
const PlanStep = ({ step, isCurrent }) => {
  const statusIcon = step.status === 'completed' ? '✓' :
                     step.status === 'failed' ? '✗' :
                     isCurrent ? '→' : ' ';
  const statusColor = step.status === 'completed' ? 'green' :
                      step.status === 'failed' ? 'red' :
                      isCurrent ? 'cyan' : 'gray';

  return e(Box, { flexDirection: 'column' },
    e(Text, null,
      e(Text, { color: statusColor }, `${statusIcon} ${step.number}. `),
      e(Text, { color: isCurrent ? 'white' : 'gray' }, step.description),
      e(Text, { color: 'gray', dimColor: true }, ` [${step.complexity}]`)
    ),
    step.status === 'failed' && step.failReason && e(Text, null,
      e(Text, { color: 'gray' }, '   └─ '),
      e(Text, { color: 'red' }, step.failReason)
    )
  );
};

// Plan display component
const PlanDisplay = ({ plan, currentStep }) => {
  if (!plan || !plan.steps || plan.steps.length === 0) {
    return null;
  }

  const progress = plan.steps.filter(s => s.status === 'completed').length;
  const total = plan.steps.length;

  return e(Box, { flexDirection: 'column', marginTop: 0 },
    e(Box, { marginBottom: 0 },
      e(Text, { color: 'cyan', bold: true }, `Plan: `),
      e(Text, { color: 'white' }, `${progress}/${total} steps`)
    ),
    e(Box, { borderStyle: 'single', borderColor: 'gray', paddingX: 1, paddingY: 0, flexDirection: 'column' },
      ...plan.steps.slice(0, 6).map((step, index) =>
        e(PlanStep, { key: index, step, isCurrent: step.number === currentStep })
      ),
      plan.steps.length > 6 && e(Text, { color: 'gray' }, `  ... and ${plan.steps.length - 6} more`)
    )
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
    plan = null,
    currentStep = 0,
  } = state;

  return e(Box, { flexDirection: 'column', paddingX: 1, paddingY: 0 },
    e(Header, { goal, timeLimit, startTime }),
    e(Box, { borderStyle: 'single', borderColor: 'gray', paddingX: 1, paddingY: 0 },
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
    phase && !plan && e(Box, { marginTop: 0 },
      e(Text, { color: 'gray' }, 'Phase: '),
      e(Text, { color: 'white' }, phase)
    ),
    plan && e(PlanDisplay, { plan, currentStep }),
    e(Box, { flexDirection: 'column', marginTop: 0 },
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
      plan: null,
      currentStep: 0,
    };
    this.logs = [];
    this.instance = null;
    this.rerender = null;
    // Debounce/batch update mechanism to prevent UI from stopping
    this._updatePending = false;
    this._updateTimer = null;
    this._stateVersion = 0; // Track state version for change detection
  }

  init(data) {
    this.state.goal = data.goal;
    this.state.subGoals = data.subGoals || [];
    this.state.timeLimit = data.timeLimit;
    this.state.startTime = Date.now();
    this.state.status = 'initialized';
    this._stateVersion++;

    // Start Ink rendering
    const app = render(
      e(Dashboard, { state: this.state, logs: this.logs })
    );
    this.instance = app;
    this.rerender = () => {
      // Create deep copies of state to ensure React detects changes
      // This is critical for nested objects like plan.steps
      const stateCopy = this._deepCopyState();
      const logsCopy = this.logs.map(log => ({...log}));
      app.rerender(e(Dashboard, { state: stateCopy, logs: logsCopy }));
    };
  }

  /**
   * Deep copy state to ensure React detects all changes
   * This is necessary because we mutate nested objects like plan.steps
   */
  _deepCopyState() {
    const state = {...this.state};
    // Deep copy plan if it exists
    if (state.plan) {
      state.plan = {
        ...state.plan,
        steps: state.plan.steps ? state.plan.steps.map(step => ({...step})) : [],
      };
    }
    return state;
  }

  update() {
    if (!this.rerender) return;

    // Increment state version to track changes
    this._stateVersion++;

    // Use debounced updates to prevent overwhelming React's render cycle
    // This is critical to prevent the UI from stopping updates
    if (this._updatePending) {
      // Update already scheduled, it will pick up the latest state
      return;
    }

    this._updatePending = true;

    // Use setImmediate/setTimeout to batch rapid updates
    // This allows multiple state changes to be batched into one render
    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
    }

    this._updateTimer = setTimeout(() => {
      this._updatePending = false;
      this._updateTimer = null;
      try {
        this.rerender();
      } catch (err) {
        // Don't let render errors stop future updates
        console.error('Ink dashboard render error:', err.message);
      }
    }, 16); // ~60fps max update rate
  }

  /**
   * Force an immediate update (bypass debouncing)
   * Use sparingly for critical state changes
   */
  forceUpdate() {
    if (!this.rerender) return;

    this._stateVersion++;

    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
      this._updateTimer = null;
    }
    this._updatePending = false;

    try {
      this.rerender();
    } catch (err) {
      console.error('Ink dashboard render error:', err.message);
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
    try {
      this._handleProgressEvent(data);
    } catch (err) {
      // Don't let handler errors crash the runner
      console.error('Dashboard updateProgress error:', err.message);
    }
    this.update();
  }

  /**
   * Internal progress event handler - separated for cleaner error handling
   */
  _handleProgressEvent(data) {
    if (data?.type === 'started') {
      this.state.status = 'running';
      this.state.startTime = Date.now();
      this.addLog('info', 'Starting autonomous execution...');
    } else if (data.type === 'planning') {
      this.state.status = 'planning';
      this.addLog('info', data.message || 'Creating execution plan...');
    } else if (data.type === 'plan_created') {
      this.state.plan = data.plan;
      this.state.currentStep = 1;
      const stepCount = data.plan?.steps?.length || 0;
      this.addLog('success', `Plan created with ${stepCount} steps`);
    } else if (data.type === 'resuming') {
      this.addLog('info', data.message || 'Resuming session...');
    } else if (data.type === 'plan_restored') {
      this.state.plan = data.plan;
      this.state.currentStep = data.currentStep || 1;
      const completed = data.completedSteps?.length || 0;
      const total = data.plan?.steps?.length || 0;
      this.state.progress = total > 0 ? Math.round((completed / total) * 100) : 0;
      this.addLog('success', `Resumed: ${completed}/${total} steps completed, continuing from step ${this.state.currentStep}`);
    } else if (data.type === 'step_verification_pending') {
      if (data.step) {
        this.addLog('info', `Verifying step ${data.step.number}...`);
      }
    } else if (data.type === 'step_verification_started') {
      this.state.status = 'verifying';
    } else if (data.type === 'step_complete') {
      this.state.status = 'running';
      if (data.step) {
        const verified = data.verification ? ' (verified)' : '';
        this.addLog('success', `Step ${data.step.number} complete${verified}`);
        // Update plan step status
        if (this.state.plan && this.state.plan.steps) {
          const stepIndex = this.state.plan.steps.findIndex(s => s.number === data.step.number);
          if (stepIndex >= 0) {
            this.state.plan.steps[stepIndex].status = 'completed';
          }
        }
      }
      if (data.progress) {
        this.state.currentStep = data.progress.current;
        this.state.progress = data.progress.percentComplete;
      }
    } else if (data.type === 'step_rejected') {
      this.state.status = 'running';
      if (data.step) {
        this.addLog('warning', `Step ${data.step.number} rejected: ${data.reason}`);
      }
    } else if (data.type === 'step_blocked_replanning') {
      if (data.step) {
        this.addLog('warning', `Step ${data.step.number} blocked, creating sub-plan...`);
      }
    } else if (data.type === 'subplan_creating') {
      this.state.status = 'planning';
      this.addLog('info', 'Creating alternative approach...');
    } else if (data.type === 'subplan_created') {
      this.state.status = 'running';
      const stepCount = data.subPlan?.steps?.length || 0;
      this.addLog('success', `Sub-plan created with ${stepCount} sub-steps`);
      // Store sub-plan info
      this.state.subPlan = data.subPlan;
      this.state.subPlanParent = data.parentStep;
    } else if (data.type === 'subplan_failed') {
      this.state.status = 'running';
      this.state.subPlan = null;
      this.state.subPlanParent = null;
      if (data.step) {
        this.addLog('error', `Sub-plan failed: ${data.reason}`);
      }
      if (data.progress) {
        this.state.currentStep = data.progress.current;
        this.state.progress = data.progress.percentComplete;
      }
    } else if (data.type === 'step_failed') {
      if (data.step) {
        this.addLog('error', `Step ${data.step.number} failed: ${data.reason}`);
        if (this.state.plan && this.state.plan.steps) {
          const stepIndex = this.state.plan.steps.findIndex(s => s.number === data.step.number);
          if (stepIndex >= 0) {
            this.state.plan.steps[stepIndex].status = 'failed';
            this.state.plan.steps[stepIndex].failReason = data.reason;
          }
        }
      }
      if (data.progress) {
        this.state.currentStep = data.progress.current;
        this.state.progress = data.progress.percentComplete;
      }
    } else if (data.type === 'step_blocked') {
      if (data.step) {
        this.addLog('warning', `Step ${data.step.number} blocked: ${data.reason}`);
      }
      if (data.progress) {
        this.state.currentStep = data.progress.current;
      }
    } else if (data.type === 'iteration_complete') {
      this.state.iteration = data.iteration;
      this.state.progress = data.planProgress?.percentComplete || data.progress?.overallProgress || 0;
      this.state.sessionId = data.sessionId;
      if (data.time) {
        this.state.elapsed = data.time.elapsedMs || 0;
        this.state.remaining = data.time.remaining || '';
      }
      if (data.planProgress) {
        this.state.currentStep = data.planProgress.current;
      }
    } else if (data.type === 'verification_started') {
      this.state.status = 'verifying';
      this.addLog('info', 'Verifying completion claim...');
    } else if (data.type === 'plan_review_started') {
      this.addLog('info', 'Reviewing execution plan...');
    } else if (data.type === 'plan_review_complete') {
      const status = data.review?.approved ? 'approved' : 'flagged';
      this.addLog(data.review?.approved ? 'success' : 'warning', `Plan review: ${status}`);
    } else if (data.type === 'plan_review_warning') {
      if (data.issues?.length > 0) {
        this.addLog('warning', `Plan issues: ${data.issues.slice(0, 2).join(', ')}`);
      }
      if (data.missingSteps?.length > 0) {
        this.addLog('warning', `Missing steps: ${data.missingSteps.slice(0, 2).join(', ')}`);
      }
    } else if (data.type === 'final_verification_started') {
      this.state.status = 'verifying';
      this.addLog('info', 'Running final verification...');
    } else if (data.type === 'goal_verification_complete') {
      const result = data.result;
      if (result?.achieved) {
        this.addLog('success', `Goal verified (${result.confidence} confidence)`);
      } else {
        this.addLog('warning', `Goal not verified: ${result?.reason?.substring(0, 60) || 'unknown'}`);
      }
    } else if (data.type === 'smoke_tests_complete') {
      const result = data.result;
      if (result?.passed) {
        this.addLog('success', `Smoke tests: ${result.summary || 'passed'}`);
      } else {
        this.addLog('warning', `Smoke tests: ${result?.summary || 'failed'}`);
      }
    } else if (data.type === 'final_verification_passed') {
      this.state.status = 'completed';
      this.addLog('success', 'Final verification PASSED');
    } else if (data.type === 'final_verification_failed') {
      this.state.status = 'error';
      this.addLog('error', `Final verification FAILED: ${data.reason?.substring(0, 60) || 'see report'}`);
    }
    // Note: this.update() is called by updateProgress() wrapper after this method returns
  }

  updateSupervision(data) {
    try {
      const assessment = data?.assessment;
      if (!assessment) return;

      if (assessment.score !== undefined) {
        this.state.score = assessment.score;
      }
      this.state.consecutiveIssues = data.consecutiveIssues || 0;

      if (assessment.action !== 'CONTINUE') {
        this.addLog('supervision', `${assessment.action}: ${assessment.reason || 'Intervention required'}`);
      }
      this.update();
    } catch (err) {
      // Don't let handler errors crash the runner
      console.error('Dashboard updateSupervision error:', err.message);
    }
  }

  showEscalation(data) {
    try {
      const type = data?.type === 'abort' ? 'error' : 'warning';
      this.addLog(type, `ESCALATION: ${data?.message || data?.type || 'unknown'}`);
      this.update();
    } catch (err) {
      console.error('Dashboard showEscalation error:', err.message);
    }
  }

  showVerification(data) {
    try {
      if (data?.passed) {
        this.addLog('success', 'Completion verified');
      } else {
        this.addLog('warning', 'Completion rejected - continuing work');
      }
      this.update();
    } catch (err) {
      console.error('Dashboard showVerification error:', err.message);
    }
  }

  showMessage(data) {
    try {
      if (this.verbose && data?.content) {
        const preview = data.content.substring(0, 100).replace(/\n/g, ' ');
        this.addLog('info', `Claude: ${preview}...`);
      }
      this.update();
    } catch (err) {
      console.error('Dashboard showMessage error:', err.message);
    }
  }

  showError(data) {
    try {
      this.addLog('error', data?.error || 'Unknown error');
      this.update();
    } catch (err) {
      console.error('Dashboard showError error:', err.message);
    }
  }

  showReport(report) {
    // Always cleanup the Ink dashboard first
    this.cleanup();

    try {
      console.log('\n');
      console.log('═'.repeat(60));
      console.log(`  Status: ${report?.status?.toUpperCase() || 'UNKNOWN'}`);
      console.log(`  Progress: ${report?.goal?.progress || 0}%`);
      console.log(`  Iterations: ${report?.session?.iterations || 0}`);
      console.log(`  Time: ${report?.time?.elapsed || 'N/A'}`);

    // Show plan summary if available
    if (report.plan) {
      console.log('─'.repeat(60));
      console.log(`  Plan: ${report.plan.completed}/${report.plan.totalSteps} steps completed`);
      if (report.plan.failed > 0) {
        console.log(`  Failed Steps: ${report.plan.failed}`);
      }
      console.log('  Steps:');
      for (const step of report.plan.steps || []) {
        const icon = step.status === 'completed' ? '✓' :
                     step.status === 'failed' ? '✗' : ' ';
        const color = step.status === 'completed' ? '\x1b[32m' :
                      step.status === 'failed' ? '\x1b[31m' : '\x1b[90m';
        console.log(`    ${color}${icon} ${step.number}. ${step.description}\x1b[0m`);
        if (step.status === 'failed' && step.failReason) {
          console.log(`       \x1b[31m└─ ${step.failReason}\x1b[0m`);
        }
      }
    }

    // Show final verification results
    if (report.finalVerification) {
      const fv = report.finalVerification;
      console.log('─'.repeat(60));
      console.log('  \x1b[1mFinal Verification:\x1b[0m');

      const goalIcon = fv.goalAchieved ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      console.log(`    ${goalIcon} Goal Achieved: ${fv.goalAchieved ? 'Yes' : 'No'}`);
      console.log(`      Confidence: ${fv.confidence || 'Unknown'}`);
      console.log(`      Functional: ${fv.functional || 'Unknown'}`);
      console.log(`      Recommendation: ${fv.recommendation || 'Unknown'}`);

      if (fv.gaps) {
        console.log(`    \x1b[33m⚠\x1b[0m Gaps: ${fv.gaps}`);
      }

      const smokeIcon = fv.smokeTestsPassed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      console.log(`    ${smokeIcon} Smoke Tests: ${fv.smokeTestsSummary || (fv.smokeTestsPassed ? 'Passed' : 'Failed')}`);

      const overallIcon = fv.overallPassed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      const overallColor = fv.overallPassed ? '\x1b[32m' : '\x1b[31m';
      console.log(`    ${overallIcon} ${overallColor}Overall: ${fv.overallPassed ? 'PASSED' : 'FAILED'}\x1b[0m`);
    }

    if (report?.abortReason) {
      console.log('─'.repeat(60));
      console.log(`  Abort Reason: ${report.abortReason}`);
    }
    console.log('═'.repeat(60));
    console.log('\n');
    } catch (err) {
      console.error('Dashboard showReport error:', err.message);
    }
  }

  cleanup() {
    // Clear any pending update timer to prevent updates during/after cleanup
    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
      this._updateTimer = null;
    }
    this._updatePending = false;

    // CRITICAL: Null out rerender BEFORE unmounting to prevent any concurrent
    // updates from trying to use a stale reference to the unmounted app.
    // This fixes the issue where the UI stops updating because update()
    // was trying to call rerender() on an unmounted instance.
    this.rerender = null;

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
