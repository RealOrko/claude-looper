/**
 * Dashboard Renderers - Render functions for different dashboard sections
 */

import {
  cursor, screen, colors, style, gradient, icons, spinners,
} from '../terminal.js';
import {
  ProgressBar, Sparkline, Box, badge, divider,
  sectionHeader, keyValue, formatScore, statusIndicator,
} from '../components.js';
import { LOGO } from './constants.js';
import { calculateTimeInfo, getTimeColor } from './time-utils.js';

/**
 * Render the dashboard header with logo
 * @param {object} state - Dashboard state
 */
export function renderHeader(state) {
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
    `${colors.white}${style.bold}${state.goal}${style.reset}`,
    { title: `${icons.target} GOAL`, width: Math.min(width - 4, 80) }
  ));

  // Sub-goals
  if (state.subGoals.length > 0) {
    console.log('');
    console.log(`  ${colors.gray}Sub-goals:${style.reset}`);
    state.subGoals.forEach((g, i) => {
      console.log(`    ${colors.darkGray}${i + 1}.${style.reset} ${g}`);
    });
  }

  console.log('');
  console.log(`  ${colors.gray}Time Limit:${style.reset} ${state.timeLimit}    ${colors.gray}Started:${style.reset} ${new Date().toLocaleTimeString()}`);
  console.log('');
  console.log(divider('─', width, colors.darkGray));
  console.log('');
}

/**
 * Get status badge based on current state
 * @param {string} status - Current status
 * @returns {string} Formatted status badge
 */
export function getStatusBadge(status) {
  switch (status) {
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
 * Render the status area
 * @param {object} state - Dashboard state
 * @param {object} animation - Animation state (spinnerIndex, spinnerFrames)
 */
export function renderStatus(state, animation = {}) {
  const width = screen.width();
  const elapsed = Date.now() - state.startTime;
  const timeInfo = calculateTimeInfo(elapsed, state.timeLimit);
  const timeColor = colors[getTimeColor(timeInfo.percentRemaining)];

  cursor.save();

  const statusLine = process.stdout.rows - 6;
  cursor.moveTo(1, statusLine);
  screen.clearDown();

  console.log(divider('─', width, colors.darkGray));

  // Spinner or status indicator
  const spinner = state.status === 'running' && animation.spinnerFrames
    ? `${colors.cyan}${animation.spinnerFrames[animation.spinnerIndex || 0]}${style.reset}`
    : statusIndicator(state.status);

  const progressBar = new ProgressBar({ width: 30, gradient: true });
  const progressStr = progressBar.render(state.progress);
  const statusBadge = getStatusBadge(state.status);

  console.log(
    `  ${spinner} ${statusBadge}  ${progressStr}  ` +
    `${colors.gray}Iter:${style.reset} ${state.iteration}  ` +
    `${colors.gray}Time:${style.reset} ${timeColor}${timeInfo.remaining}${style.reset}`
  );

  // Score sparkline
  if (state.scoreHistory.length > 0) {
    const sparkline = Sparkline.render(state.scoreHistory.slice(-20), { min: 0, max: 100 });
    const lastScore = state.lastScore || state.scoreHistory[state.scoreHistory.length - 1];
    const scoreDisplay = formatScore(lastScore, false);

    console.log(
      `  ${colors.gray}Score:${style.reset} ${scoreDisplay}/100  ` +
      `${colors.gray}History:${style.reset} ${sparkline}  ` +
      `${state.consecutiveIssues > 0 ? `${colors.yellow}Issues: ${state.consecutiveIssues}/5${style.reset}` : ''}`
    );
  }

  // Phase indicator
  if (state.phase) {
    console.log(`  ${colors.gray}Phase:${style.reset} ${state.phase}`);
  }

  cursor.restore();
}

/**
 * Render escalation box
 * @param {object} displayData - Escalation display configuration
 */
export function renderEscalation(displayData) {
  const width = Math.min(screen.width() - 4, 70);

  console.log('');
  if (displayData.isCritical) {
    const borderColor = colors[displayData.borderColor];
    const boxStyle = new Box({ style: 'heavy', borderColor, padding: 1 });

    console.log(boxStyle.render(
      `${colors.white}${displayData.message}${style.reset}\n\n` +
      `${colors.gray}Consecutive issues: ${displayData.consecutiveIssues}/5${style.reset}\n` +
      `${colors.gray}Final score: ${displayData.score}/100${style.reset}`,
      { title: `${displayData.titleIcon} ${displayData.title}`, width }
    ));
  }
  console.log('');
}

/**
 * Render verification result
 * @param {object} displayData - Verification display configuration
 */
export function renderVerification(displayData) {
  console.log('');
  console.log(sectionHeader('COMPLETION VERIFICATION', icons.target));
  console.log('');

  const { layers, passed, failures } = displayData;

  // Layer 1: Challenge
  if (layers.challenge) {
    const clr = layers.challenge.passed ? colors.green : colors.red;
    console.log(`  ${clr}${layers.challenge.icon}${style.reset} Layer 1: LLM Challenge    ${layers.challenge.passed ? 'PASSED' : 'FAILED'}`);
  }

  // Layer 2: Artifacts
  if (layers.artifacts && !layers.artifacts.skipped) {
    const clr = layers.artifacts.passed ? colors.green : colors.red;
    console.log(`  ${clr}${layers.artifacts.icon}${style.reset} Layer 2: Artifacts        ${layers.artifacts.passed ? 'PASSED' : 'FAILED'}  (${layers.artifacts.verified} verified, ${layers.artifacts.missing} missing)`);
  } else if (layers.artifacts?.skipped) {
    console.log(`  ${colors.gray}○${style.reset} Layer 2: Artifacts        ${colors.gray}SKIPPED${style.reset}`);
  }

  // Layer 3: Validation
  if (layers.validation && !layers.validation.skipped) {
    const clr = layers.validation.passed ? colors.green : colors.red;
    console.log(`  ${clr}${layers.validation.icon}${style.reset} Layer 3: Validation       ${layers.validation.passed ? 'PASSED' : 'FAILED'}`);
  } else if (layers.validation?.skipped) {
    console.log(`  ${colors.gray}○${style.reset} Layer 3: Validation       ${colors.gray}SKIPPED${style.reset}`);
  }

  console.log('');

  // Final result
  if (passed) {
    console.log(`  ${colors.green}${style.bold}${icons.success} VERIFIED - Completion accepted${style.reset}`);
  } else {
    console.log(`  ${colors.yellow}${style.bold}${icons.error} REJECTED - Continuing work${style.reset}`);
    if (failures.length > 0) {
      console.log(`  ${colors.gray}Reasons:${style.reset}`);
      failures.forEach(f => console.log(`    ${colors.gray}• ${f}${style.reset}`));
    }
  }

  console.log('');
}

export default {
  renderHeader,
  getStatusBadge,
  renderStatus,
  renderEscalation,
  renderVerification,
};
