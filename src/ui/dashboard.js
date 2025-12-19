/**
 * Dashboard - Live-updating terminal UI
 * Manages full-screen layout with real-time updates
 */

import { cursor, screen, colors, style, spinners, icons } from './terminal.js';
import { sectionHeader } from './components.js';
import { createInitialState, initializeState } from './dashboard/state.js';
import {
  handleProgressUpdate,
  handleSupervisionUpdate,
  buildEscalationDisplay,
  buildVerificationDisplay,
} from './dashboard/event-handlers.js';
import {
  renderHeader,
  renderStatus,
  renderEscalation,
  renderVerification,
} from './dashboard/renderers.js';
import { renderReport } from './dashboard/report-renderer.js';

export class Dashboard {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.compact = options.compact || false;
    this.state = createInitialState();

    // Animation
    this.spinnerFrames = spinners.dots;
    this.spinnerIndex = 0;
    this.spinnerTimer = null;
    this.pulsePhase = 0;

    // Layout tracking
    this.lastRenderHeight = 0;
    this.renderTimer = null;
  }

  init(data) {
    initializeState(this.state, data);
    cursor.hide();
    screen.clear();
    renderHeader(this.state);
    this.startAnimations();
  }

  startAnimations() {
    this.spinnerTimer = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
      this.pulsePhase = (this.pulsePhase + 1) % 20;
      if (this.state.status === 'running') {
        this._renderStatus();
      }
    }, 80);
  }

  cleanup() {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }
    cursor.show();
  }

  _renderStatus() {
    if (this.compact) return;
    renderStatus(this.state, {
      spinnerFrames: this.spinnerFrames,
      spinnerIndex: this.spinnerIndex,
    });
  }

  updateProgress(data) {
    const result = handleProgressUpdate(this.state, data, {
      log: (msg, type) => this.log(msg, type),
      renderStatus: () => !this.verbose && this._renderStatus(),
    });

    if (result) {
      this.log(result.message, result.type);
    }
  }

  updateSupervision(data) {
    const logs = handleSupervisionUpdate(this.state, data, {
      renderStatus: () => this._renderStatus(),
    });

    if (logs) {
      logs.forEach(entry => this.log(entry.message, entry.type));
    }
  }

  showEscalation(data) {
    const displayData = buildEscalationDisplay(data);
    renderEscalation(displayData);
  }

  showVerification(data) {
    const displayData = buildVerificationDisplay(data);
    renderVerification(displayData);
  }

  showReport(report) {
    this.cleanup();
    this.state.status = report.status;
    renderReport(report, this.state);
  }

  log(message, type = 'info') {
    const typeColors = {
      info: colors.cyan,
      success: colors.green,
      warning: colors.yellow,
      error: colors.red,
      dim: colors.gray,
      reset: style.reset,
    };

    const clr = typeColors[type] || style.reset;
    console.log(`${clr}${message}${style.reset}`);
  }

  showError(data) {
    this.state.error = data.error;
    console.log('');
    console.log(`  ${colors.red}${icons.error} Error: ${data.error}${style.reset}`);
    if (data.retry) {
      console.log(`  ${colors.gray}Retrying (attempt ${data.retry})...${style.reset}`);
    }
    console.log('');
  }

  showMessage(data) {
    if (!this.verbose) return;

    console.log('');
    console.log(sectionHeader(`ITERATION ${data.iteration}`, icons.brain));
    console.log('');

    const content = data.content || '';
    const truncated = content.substring(0, 1500);
    console.log(`${colors.gray}${truncated}${content.length > 1500 ? '\n...(truncated)' : ''}${style.reset}`);
    console.log('');
  }
}

export default Dashboard;
