/**
 * Dashboard - Live-updating terminal UI
 * Manages full-screen layout with real-time updates
 */

import {
  cursor, screen, colors, style, gradient, icons, spinners, box, color
} from './terminal.js';
import {
  Spinner, ProgressBar, Sparkline, Box, badge, divider,
  sectionHeader, keyValue, formatDuration, formatScore, statusIndicator
} from './components.js';

const LOGO = `
   ██████╗ ██╗      █████╗ ██╗   ██╗ ██████╗  ███████╗
  ██╔════╝ ██║     ██╔══██╗██║   ██║ ██╔══██╗ ██╔════╝
  ██║      ██║     ███████║██║   ██║ ██║  ██║ █████╗
  ██║      ██║     ██╔══██║██║   ██║ ██║  ██║ ██╔══╝
  ╚██████╗ ███████╗██║  ██║╚██████╔╝ ██████╔╝ ███████╗
   ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝  ╚══════╝
        ${colors.gray}A U T O N O M O U S   R U N N E R${style.reset}`;

const MINI_LOGO = `${colors.cyan}${style.bold}◆ CLAUDE${style.reset} ${colors.gray}AUTONOMOUS${style.reset}`;

export class Dashboard {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.compact = options.compact || false;

    // State
    this.state = {
      goal: '',
      subGoals: [],
      timeLimit: '',
      startTime: null,
      iteration: 0,
      progress: 0,
      status: 'initializing',
      phase: '',
      sessionId: null,
      scoreHistory: [],
      lastScore: null,
      consecutiveIssues: 0,
      messages: [],
      verification: null,
      error: null,
    };

    // Animation
    this.spinnerFrames = spinners.dots;
    this.spinnerIndex = 0;
    this.spinnerTimer = null;
    this.pulsePhase = 0;

    // Layout tracking
    this.lastRenderHeight = 0;
    this.renderTimer = null;
  }

  /**
   * Initialize the dashboard
   */
  init(data) {
    this.state.goal = data.goal;
    this.state.subGoals = data.subGoals || [];
    this.state.timeLimit = data.timeLimit;
    this.state.startTime = Date.now();
    this.state.status = 'initialized';

    cursor.hide();
    screen.clear();
    this.renderHeader();
    this.startAnimations();
  }

  /**
   * Start animation timers
   */
  startAnimations() {
    // Spinner animation
    this.spinnerTimer = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
      this.pulsePhase = (this.pulsePhase + 1) % 20;
      if (this.state.status === 'running') {
        this.renderStatus();
      }
    }, 80);
  }

  /**
   * Stop animations and cleanup
   */
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

  /**
   * Render the header with logo
   */
  renderHeader() {
    const width = screen.width();

    // Gradient logo
    const logoLines = LOGO.trimEnd().split('\n').filter(line => line.length > 0);
    logoLines.forEach((line, i) => {
      const colorCode = gradient.cool((i / logoLines.length) * 100);
      console.log(`${colorCode}${line}${style.reset}`);
    });

    console.log('');
    console.log(divider('═', width, colors.cyan));
    console.log('');

    // Goal display
    const goalBox = new Box({ style: 'rounded', borderColor: colors.softBlue, padding: 1 });
    console.log(goalBox.render(
      `${colors.white}${style.bold}${this.state.goal}${style.reset}`,
      { title: `${icons.target} GOAL`, width: Math.min(width - 4, 80) }
    ));

    // Sub-goals
    if (this.state.subGoals.length > 0) {
      console.log('');
      console.log(`  ${colors.gray}Sub-goals:${style.reset}`);
      this.state.subGoals.forEach((g, i) => {
        console.log(`    ${colors.darkGray}${i + 1}.${style.reset} ${g}`);
      });
    }

    console.log('');
    console.log(`  ${colors.gray}Time Limit:${style.reset} ${this.state.timeLimit}    ${colors.gray}Started:${style.reset} ${new Date().toLocaleTimeString()}`);
    console.log('');
    console.log(divider('─', width, colors.darkGray));
    console.log('');
  }

  /**
   * Update and render the status area
   */
  renderStatus() {
    if (this.compact) return;

    const width = screen.width();
    const elapsed = Date.now() - this.state.startTime;
    const progress = this.state.progress;

    // Calculate time info
    const timeInfo = this.calculateTimeInfo(elapsed);

    // Build status line
    cursor.save();

    // Move to status area (fixed position from bottom)
    const statusLine = process.stdout.rows - 6;
    cursor.moveTo(1, statusLine);
    screen.clearDown();

    // Status bar
    console.log(divider('─', width, colors.darkGray));

    // Main progress line with spinner
    const spinner = this.state.status === 'running'
      ? `${colors.cyan}${this.spinnerFrames[this.spinnerIndex]}${style.reset}`
      : statusIndicator(this.state.status);

    const progressBar = new ProgressBar({ width: 30, gradient: true });
    const progressStr = progressBar.render(progress);

    const timeColor = timeInfo.percentRemaining > 20 ? colors.green :
                      timeInfo.percentRemaining > 5 ? colors.yellow : colors.red;

    const statusBadge = this.getStatusBadge();

    console.log(
      `  ${spinner} ${statusBadge}  ${progressStr}  ` +
      `${colors.gray}Iter:${style.reset} ${this.state.iteration}  ` +
      `${colors.gray}Time:${style.reset} ${timeColor}${timeInfo.remaining}${style.reset}`
    );

    // Score sparkline and metrics
    if (this.state.scoreHistory.length > 0) {
      const sparkline = Sparkline.render(this.state.scoreHistory.slice(-20), { min: 0, max: 100 });
      const lastScore = this.state.lastScore || this.state.scoreHistory[this.state.scoreHistory.length - 1];
      const scoreDisplay = formatScore(lastScore, false);

      console.log(
        `  ${colors.gray}Score:${style.reset} ${scoreDisplay}/100  ` +
        `${colors.gray}History:${style.reset} ${sparkline}  ` +
        `${this.state.consecutiveIssues > 0 ? `${colors.yellow}Issues: ${this.state.consecutiveIssues}/5${style.reset}` : ''}`
      );
    }

    // Phase indicator
    if (this.state.phase) {
      console.log(`  ${colors.gray}Phase:${style.reset} ${this.state.phase}`);
    }

    cursor.restore();
  }

  /**
   * Get status badge based on current state
   */
  getStatusBadge() {
    switch (this.state.status) {
      case 'running':
        return badge('RUNNING', 'running');
      case 'verifying':
        return badge('VERIFYING', 'warning');
      case 'completed':
        return badge('COMPLETE', 'success');
      case 'error':
        return badge('ERROR', 'error');
      case 'aborted':
        return badge('ABORTED', 'error');
      default:
        return badge('STARTING', 'pending');
    }
  }

  /**
   * Calculate time information
   */
  calculateTimeInfo(elapsed) {
    const timeLimitMs = this.parseTimeLimit(this.state.timeLimit);
    const remaining = Math.max(0, timeLimitMs - elapsed);
    const percentRemaining = (remaining / timeLimitMs) * 100;

    return {
      elapsed: formatDuration(elapsed),
      remaining: formatDuration(remaining),
      percentUsed: Math.round((elapsed / timeLimitMs) * 100),
      percentRemaining: Math.round(percentRemaining),
    };
  }

  /**
   * Parse time limit string to ms
   */
  parseTimeLimit(str) {
    const match = str.match(/^(\d+)(m|h|d)?$/);
    if (!match) return 2 * 60 * 60 * 1000; // default 2h

    const value = parseInt(match[1], 10);
    const unit = match[2] || 'h';
    const multipliers = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
    return value * multipliers[unit];
  }

  /**
   * Handle progress update
   */
  updateProgress(data) {
    switch (data.type) {
      case 'started':
        this.state.status = 'running';
        this.state.startTime = Date.now();
        this.log(`${icons.rocket} Starting autonomous execution...`, 'info');
        break;

      case 'iteration_complete':
        this.state.iteration = data.iteration;
        this.state.progress = data.progress?.overallProgress || 0;
        this.state.sessionId = data.sessionId;
        if (!this.verbose) {
          this.renderStatus();
        }
        break;

      case 'verification_started':
        this.state.status = 'verifying';
        this.log(`${icons.target} Verifying completion claim...`, 'info');
        break;
    }
  }

  /**
   * Handle supervision update
   */
  updateSupervision(data) {
    const assessment = data.assessment;
    if (!assessment) return;

    // Update score history
    if (assessment.score !== undefined) {
      this.state.scoreHistory.push(assessment.score);
      this.state.lastScore = assessment.score;
    }

    this.state.consecutiveIssues = data.consecutiveIssues || 0;

    // Only show alerts for non-CONTINUE actions
    if (assessment.action === 'CONTINUE') {
      this.renderStatus();
      return;
    }

    // Display supervision alert
    const severity = assessment.action === 'REFOCUS' || assessment.action === 'CRITICAL' ? 'error' : 'warning';
    const icon = severity === 'error' ? icons.fire : icons.warning;

    this.log('', 'reset');
    this.log(`${icon} SUPERVISION: ${assessment.action}`, severity);
    this.log(`   Score: ${formatScore(assessment.score)} | Issues: ${this.state.consecutiveIssues}/5`, 'dim');
    if (assessment.reason) {
      this.log(`   ${assessment.reason}`, 'dim');
    }
    this.log('', 'reset');
  }

  /**
   * Handle escalation
   */
  showEscalation(data) {
    const width = Math.min(screen.width() - 4, 70);

    console.log('');
    if (data.type === 'critical' || data.type === 'abort') {
      const borderColor = data.type === 'abort' ? colors.red : colors.yellow;
      const titleIcon = data.type === 'abort' ? icons.error : icons.warning;

      const boxStyle = new Box({ style: 'heavy', borderColor, padding: 1 });
      const title = data.type === 'abort' ? 'SESSION ABORTED' : 'CRITICAL WARNING';

      console.log(boxStyle.render(
        `${colors.white}${data.message || 'Drift limit exceeded'}${style.reset}\n\n` +
        `${colors.gray}Consecutive issues: ${data.consecutiveIssues}/5${style.reset}\n` +
        `${colors.gray}Final score: ${data.score}/100${style.reset}`,
        { title: `${titleIcon} ${title}`, width }
      ));
    }
    console.log('');
  }

  /**
   * Handle verification result
   */
  showVerification(data) {
    const width = Math.min(screen.width() - 4, 70);
    const passed = data.passed;

    console.log('');
    console.log(sectionHeader('COMPLETION VERIFICATION', icons.target));
    console.log('');

    // Layer results
    const layers = data.layers || {};

    // Layer 1: Challenge
    if (layers.challenge) {
      const icon = layers.challenge.passed ? icons.success : icons.error;
      const clr = layers.challenge.passed ? colors.green : colors.red;
      console.log(`  ${clr}${icon}${style.reset} Layer 1: LLM Challenge    ${layers.challenge.passed ? 'PASSED' : 'FAILED'}`);
    }

    // Layer 2: Artifacts
    if (layers.artifacts && !layers.artifacts.skipped) {
      const icon = layers.artifacts.passed ? icons.success : icons.error;
      const clr = layers.artifacts.passed ? colors.green : colors.red;
      const verified = layers.artifacts.verified?.length || 0;
      const missing = layers.artifacts.missing?.length || 0;
      console.log(`  ${clr}${icon}${style.reset} Layer 2: Artifacts        ${layers.artifacts.passed ? 'PASSED' : 'FAILED'}  (${verified} verified, ${missing} missing)`);
    } else if (layers.artifacts?.skipped) {
      console.log(`  ${colors.gray}○${style.reset} Layer 2: Artifacts        ${colors.gray}SKIPPED${style.reset}`);
    }

    // Layer 3: Validation
    if (layers.validation && !layers.validation.skipped) {
      const icon = layers.validation.passed ? icons.success : icons.error;
      const clr = layers.validation.passed ? colors.green : colors.red;
      console.log(`  ${clr}${icon}${style.reset} Layer 3: Validation       ${layers.validation.passed ? 'PASSED' : 'FAILED'}`);
    } else if (layers.validation?.skipped) {
      console.log(`  ${colors.gray}○${style.reset} Layer 3: Validation       ${colors.gray}SKIPPED${style.reset}`);
    }

    console.log('');

    // Final result
    if (passed) {
      console.log(`  ${colors.green}${style.bold}${icons.success} VERIFIED - Completion accepted${style.reset}`);
    } else {
      console.log(`  ${colors.yellow}${style.bold}${icons.error} REJECTED - Continuing work${style.reset}`);
      if (data.failures?.length > 0) {
        console.log(`  ${colors.gray}Reasons:${style.reset}`);
        data.failures.forEach(f => console.log(`    ${colors.gray}• ${f}${style.reset}`));
      }
    }

    console.log('');
  }

  /**
   * Show final report
   */
  showReport(report) {
    this.cleanup();
    this.state.status = report.status;

    const width = Math.min(screen.width() - 4, 80);

    console.log('');
    console.log('');

    // Final status banner
    const statusColors = {
      completed: colors.green,
      time_expired: colors.yellow,
      stopped: colors.orange,
      aborted: colors.red,
    };
    const bannerColor = statusColors[report.status] || colors.gray;

    // Big completion banner
    const bannerBox = new Box({ style: 'double', borderColor: bannerColor, padding: 1 });
    const statusIcon = report.status === 'completed' ? icons.success :
                       report.status === 'aborted' ? icons.error : icons.warning;

    console.log(bannerBox.render(
      `${bannerColor}${style.bold}${statusIcon}  ${report.status.toUpperCase().replace('_', ' ')}${style.reset}`,
      { title: 'EXECUTION COMPLETE', width }
    ));

    console.log('');

    // Stats grid
    console.log(sectionHeader('STATISTICS', icons.chart));
    console.log('');

    const elapsed = report.time?.elapsed || 'N/A';
    const percentUsed = report.time?.percentUsed || 0;
    const iterations = report.session?.iterations || 0;
    const progress = report.goal?.progress || 0;

    console.log(`  ${keyValue('Progress', `${formatScore(progress)}%`, 18)}`);
    console.log(`  ${keyValue('Time Used', `${elapsed} (${percentUsed}% of limit)`, 18)}`);
    console.log(`  ${keyValue('Iterations', iterations, 18)}`);
    console.log(`  ${keyValue('Session ID', report.session?.id || 'N/A', 18)}`);

    // Supervision stats
    if (report.supervision) {
      console.log('');
      console.log(sectionHeader('SUPERVISION', icons.brain));
      console.log('');

      const sup = report.supervision;
      console.log(`  ${keyValue('Assessments', sup.totalAssessments, 18)}`);
      console.log(`  ${keyValue('Corrections', sup.totalCorrections, 18)}`);
      console.log(`  ${keyValue('Average Score', sup.averageScore ? `${sup.averageScore}/100` : 'N/A', 18)}`);

      // Score sparkline if we have history
      if (this.state.scoreHistory.length > 0) {
        const sparkline = Sparkline.render(this.state.scoreHistory, { min: 0, max: 100 });
        console.log(`  ${keyValue('Score History', sparkline, 18)}`);
      }
    }

    // Verification stats
    if (report.verification?.enabled) {
      console.log('');
      console.log(sectionHeader('VERIFICATION', icons.target));
      console.log('');

      const ver = report.verification;
      const statusClr = ver.finalStatus === 'verified' ? colors.green : colors.yellow;
      console.log(`  ${keyValue('Final Status', `${statusClr}${ver.finalStatus?.toUpperCase()}${style.reset}`, 18)}`);
      if (ver.failures > 0) {
        console.log(`  ${keyValue('False Claims', `${colors.yellow}${ver.failures}${style.reset}`, 18)}`);
      }
    }

    // Completed milestones
    if (report.goal?.milestones?.length > 0) {
      console.log('');
      console.log(sectionHeader('COMPLETED MILESTONES', icons.success));
      console.log('');
      report.goal.milestones.forEach(m => {
        console.log(`  ${colors.green}${icons.check}${style.reset} ${m}`);
      });
    }

    // Summary
    if (report.summary?.summary) {
      console.log('');
      console.log(sectionHeader('SUMMARY', icons.info));
      console.log('');
      const summary = report.summary.summary.substring(0, 500);
      console.log(`  ${colors.gray}${summary}${summary.length >= 500 ? '...' : ''}${style.reset}`);
    }

    console.log('');
    console.log(divider('═', width, bannerColor));
    console.log('');
  }

  /**
   * Log a message
   */
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

  /**
   * Log an error
   */
  showError(data) {
    this.state.error = data.error;
    console.log('');
    console.log(`  ${colors.red}${icons.error} Error: ${data.error}${style.reset}`);
    if (data.retry) {
      console.log(`  ${colors.gray}Retrying (attempt ${data.retry})...${style.reset}`);
    }
    console.log('');
  }

  /**
   * Log a message from Claude (verbose mode)
   */
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
