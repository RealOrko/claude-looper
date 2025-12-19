/**
 * Dashboard Event Handlers - Handle progress, supervision, escalation events
 */

import { updateScoreHistory } from './state.js';
import { icons } from '../terminal.js';
import { formatScore } from '../components.js';

/**
 * Handle progress update event
 * @param {object} state - Dashboard state
 * @param {object} data - Progress event data
 * @param {object} callbacks - Callback functions
 * @returns {object|null} Log entry to display, or null
 */
export function handleProgressUpdate(state, data, callbacks = {}) {
  const { log, renderStatus } = callbacks;

  switch (data.type) {
    case 'started':
      state.status = 'running';
      state.startTime = Date.now();
      return { message: `${icons.rocket} Starting autonomous execution...`, type: 'info' };

    case 'iteration_complete':
      state.iteration = data.iteration;
      state.progress = data.progress?.overallProgress || 0;
      state.sessionId = data.sessionId;
      if (renderStatus) renderStatus();
      return null;

    case 'verification_started':
      state.status = 'verifying';
      return { message: `${icons.target} Verifying completion claim...`, type: 'info' };

    default:
      return null;
  }
}

/**
 * Handle supervision update event
 * @param {object} state - Dashboard state
 * @param {object} data - Supervision event data
 * @param {object} callbacks - Callback functions
 * @returns {Array|null} Log entries to display, or null
 */
export function handleSupervisionUpdate(state, data, callbacks = {}) {
  const { renderStatus } = callbacks;
  const assessment = data.assessment;
  if (!assessment) return null;

  // Update score history
  updateScoreHistory(state, assessment.score);
  state.consecutiveIssues = data.consecutiveIssues || 0;

  // Only show alerts for non-CONTINUE actions
  if (assessment.action === 'CONTINUE') {
    if (renderStatus) renderStatus();
    return null;
  }

  // Build supervision alert logs
  const severity = assessment.action === 'REFOCUS' || assessment.action === 'CRITICAL' ? 'error' : 'warning';
  const icon = severity === 'error' ? icons.fire : icons.warning;

  const logs = [
    { message: '', type: 'reset' },
    { message: `${icon} SUPERVISION: ${assessment.action}`, type: severity },
    { message: `   Score: ${formatScore(assessment.score)} | Issues: ${state.consecutiveIssues}/5`, type: 'dim' },
  ];

  if (assessment.reason) {
    logs.push({ message: `   ${assessment.reason}`, type: 'dim' });
  }

  logs.push({ message: '', type: 'reset' });

  return logs;
}

/**
 * Build escalation display data
 * @param {object} data - Escalation event data
 * @returns {object} Display configuration
 */
export function buildEscalationDisplay(data) {
  const isCritical = data.type === 'critical' || data.type === 'abort';
  const isAbort = data.type === 'abort';

  return {
    isCritical,
    borderColor: isAbort ? 'red' : 'yellow',
    titleIcon: isAbort ? icons.error : icons.warning,
    title: isAbort ? 'SESSION ABORTED' : 'CRITICAL WARNING',
    message: data.message || 'Drift limit exceeded',
    consecutiveIssues: data.consecutiveIssues,
    score: data.score,
  };
}

/**
 * Build verification display data
 * @param {object} data - Verification event data
 * @returns {object} Display configuration
 */
export function buildVerificationDisplay(data) {
  const layers = data.layers || {};

  return {
    passed: data.passed,
    layers: {
      challenge: layers.challenge ? {
        passed: layers.challenge.passed,
        icon: layers.challenge.passed ? icons.success : icons.error,
      } : null,
      artifacts: layers.artifacts ? {
        passed: layers.artifacts.passed,
        skipped: layers.artifacts.skipped,
        verified: layers.artifacts.verified?.length || 0,
        missing: layers.artifacts.missing?.length || 0,
        icon: layers.artifacts.passed ? icons.success : icons.error,
      } : null,
      validation: layers.validation ? {
        passed: layers.validation.passed,
        skipped: layers.validation.skipped,
        icon: layers.validation.passed ? icons.success : icons.error,
      } : null,
    },
    failures: data.failures || [],
  };
}

export default {
  handleProgressUpdate,
  handleSupervisionUpdate,
  buildEscalationDisplay,
  buildVerificationDisplay,
};
