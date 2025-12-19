/**
 * Ink-based Dashboard - Modern React-style terminal UI
 */

import React from 'react';
import { render } from 'ink';
import { Dashboard } from './components/dashboard-component.js';
import { handleProgressEvent } from './components/progress-handlers.js';
import { displayReport } from './components/report-display.js';

const e = React.createElement;

/**
 * Create initial dashboard state
 * @returns {object} Initial state object
 */
function createInitialState() {
  return {
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
}

/**
 * Deep copy state to ensure React detects all changes
 * @param {object} state - State to copy
 * @returns {object} Deep copied state
 */
function deepCopyState(state) {
  const copy = { ...state };
  if (copy.plan) {
    copy.plan = {
      ...copy.plan,
      steps: copy.plan.steps ? copy.plan.steps.map(step => ({ ...step })) : [],
    };
  }
  return copy;
}

// Dashboard wrapper class for imperative API
export class InkDashboard {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.state = createInitialState();
    this.logs = [];
    this.instance = null;
    this.rerender = null;
    this._updatePending = false;
    this._updateTimer = null;
    this._stateVersion = 0;
  }

  init(data) {
    this.state.goal = data.goal;
    this.state.subGoals = data.subGoals || [];
    this.state.timeLimit = data.timeLimit;
    this.state.startTime = Date.now();
    this.state.status = 'initialized';
    this._stateVersion++;

    const app = render(e(Dashboard, { state: this.state, logs: this.logs }));
    this.instance = app;
    this.rerender = () => {
      const stateCopy = deepCopyState(this.state);
      const logsCopy = this.logs.map(log => ({ ...log }));
      app.rerender(e(Dashboard, { state: stateCopy, logs: logsCopy }));
    };
  }

  update() {
    if (!this.rerender) return;
    this._stateVersion++;

    if (this._updatePending) return;
    this._updatePending = true;

    if (this._updateTimer) clearTimeout(this._updateTimer);

    this._updateTimer = setTimeout(() => {
      this._updatePending = false;
      this._updateTimer = null;
      try {
        this.rerender();
      } catch (err) {
        console.error('Ink dashboard render error:', err.message);
      }
    }, 16);
  }

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
    this.logs.push({ type, message, timestamp: Date.now() });
    if (this.logs.length > 50) {
      this.logs = this.logs.slice(-50);
    }
    this.update();
  }

  updateProgress(data) {
    try {
      handleProgressEvent(this.state, data, (type, msg) => this.addLog(type, msg));
    } catch (err) {
      console.error('Dashboard updateProgress error:', err.message);
    }
    this.update();
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
    this.cleanup();
    try {
      displayReport(report);
    } catch (err) {
      console.error('Dashboard showReport error:', err.message);
    }
  }

  cleanup() {
    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
      this._updateTimer = null;
    }
    this._updatePending = false;
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
