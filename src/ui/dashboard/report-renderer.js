/**
 * Dashboard Report Renderer - Render final execution report
 */

import { screen, colors, style, icons } from '../terminal.js';
import {
  Sparkline, Box, divider, sectionHeader, keyValue, formatScore,
} from '../components.js';

/**
 * Render final execution report
 * @param {object} report - Execution report
 * @param {object} state - Dashboard state (for score history)
 */
export function renderReport(report, state = {}) {
  const width = Math.min(screen.width() - 4, 80);

  console.log('');
  console.log('');

  // Status banner
  const statusColors = {
    completed: colors.green,
    time_expired: colors.yellow,
    stopped: colors.orange,
    aborted: colors.red,
  };
  const bannerColor = statusColors[report.status] || colors.gray;

  const bannerBox = new Box({ style: 'double', borderColor: bannerColor, padding: 1 });
  const statusIcon = report.status === 'completed' ? icons.success :
                     report.status === 'aborted' ? icons.error : icons.warning;

  console.log(bannerBox.render(
    `${bannerColor}${style.bold}${statusIcon}  ${report.status.toUpperCase().replace('_', ' ')}${style.reset}`,
    { title: 'EXECUTION COMPLETE', width }
  ));

  console.log('');

  // Stats grid
  renderStatistics(report);

  // Supervision stats
  if (report.supervision) {
    renderSupervisionStats(report.supervision, state.scoreHistory);
  }

  // Verification stats
  if (report.verification?.enabled) {
    renderVerificationStats(report.verification);
  }

  // Completed milestones
  if (report.goal?.milestones?.length > 0) {
    renderMilestones(report.goal.milestones);
  }

  // Summary
  if (report.summary?.summary) {
    renderSummary(report.summary.summary);
  }

  console.log('');
  console.log(divider('═', width, bannerColor));
  console.log('');
}

/**
 * Render statistics section
 * @param {object} report - Execution report
 */
function renderStatistics(report) {
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
}

/**
 * Render supervision statistics
 * @param {object} sup - Supervision data
 * @param {Array} scoreHistory - Score history array
 */
function renderSupervisionStats(sup, scoreHistory = []) {
  console.log('');
  console.log(sectionHeader('SUPERVISION', icons.brain));
  console.log('');

  console.log(`  ${keyValue('Assessments', sup.totalAssessments, 18)}`);
  console.log(`  ${keyValue('Corrections', sup.totalCorrections, 18)}`);
  console.log(`  ${keyValue('Average Score', sup.averageScore ? `${sup.averageScore}/100` : 'N/A', 18)}`);

  if (scoreHistory.length > 0) {
    const sparkline = Sparkline.render(scoreHistory, { min: 0, max: 100 });
    console.log(`  ${keyValue('Score History', sparkline, 18)}`);
  }
}

/**
 * Render verification statistics
 * @param {object} ver - Verification data
 */
function renderVerificationStats(ver) {
  console.log('');
  console.log(sectionHeader('VERIFICATION', icons.target));
  console.log('');

  const statusClr = ver.finalStatus === 'verified' ? colors.green : colors.yellow;
  console.log(`  ${keyValue('Final Status', `${statusClr}${ver.finalStatus?.toUpperCase()}${style.reset}`, 18)}`);
  if (ver.failures > 0) {
    console.log(`  ${keyValue('False Claims', `${colors.yellow}${ver.failures}${style.reset}`, 18)}`);
  }
}

/**
 * Render completed milestones
 * @param {Array} milestones - Array of milestone strings
 */
function renderMilestones(milestones) {
  console.log('');
  console.log(sectionHeader('COMPLETED MILESTONES', icons.success));
  console.log('');
  milestones.forEach(m => {
    console.log(`  ${colors.green}${icons.check}${style.reset} ${m}`);
  });
}

/**
 * Render summary section
 * @param {string} summary - Summary text
 */
function renderSummary(summary) {
  console.log('');
  console.log(sectionHeader('SUMMARY', icons.info));
  console.log('');
  const truncated = summary.substring(0, 500);
  console.log(`  ${colors.gray}${truncated}${summary.length >= 500 ? '...' : ''}${style.reset}`);
}

export default { renderReport };
