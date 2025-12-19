/**
 * escalation-logic.js - Escalation levels and intervention logic
 *
 * Provides graduated intervention for the supervisor system:
 * - Escalation levels from none to abort
 * - Logic to determine appropriate escalation based on issue counts
 * - Correction prompt generation for each escalation level
 */

/**
 * Escalation levels for supervisor interventions
 * Ordered from least to most severe
 */
export const EscalationLevel = {
  NONE: 'none',       // No intervention needed
  REMIND: 'remind',   // Gentle reminder about the goal
  CORRECT: 'correct', // Course correction needed
  REFOCUS: 'refocus', // Significant refocusing required
  CRITICAL: 'critical', // Final warning before abort
  ABORT: 'abort',     // Session termination
};

/**
 * Default escalation thresholds
 * Defines how many consecutive issues trigger each escalation level
 */
export const DEFAULT_ESCALATION_THRESHOLDS = {
  warn: 2,      // Trigger CORRECT after 2 issues
  intervene: 3, // Trigger REFOCUS after 3 issues
  critical: 4,  // Trigger CRITICAL after 4 issues
  abort: 5,     // Trigger ABORT after 5 issues
};

/**
 * Determine the escalation level based on assessment and issue history
 *
 * @param {Object} assessment - The assessment object with action field
 * @param {number} consecutiveIssues - Number of consecutive issues detected
 * @param {Object} thresholds - Escalation thresholds (warn, intervene, critical, abort)
 * @returns {string} The escalation level from EscalationLevel
 */
export function determineEscalation(assessment, consecutiveIssues, thresholds = DEFAULT_ESCALATION_THRESHOLDS) {
  if (consecutiveIssues >= thresholds.abort) {
    return EscalationLevel.ABORT;
  }
  if (consecutiveIssues >= thresholds.critical) {
    return EscalationLevel.CRITICAL;
  }
  if (consecutiveIssues >= thresholds.intervene) {
    return EscalationLevel.REFOCUS;
  }
  if (consecutiveIssues >= thresholds.warn) {
    return EscalationLevel.CORRECT;
  }
  if (assessment?.action === 'REMIND') {
    return EscalationLevel.REMIND;
  }

  return EscalationLevel.NONE;
}

/**
 * Generate a correction prompt based on escalation level
 *
 * @param {string} level - The escalation level from EscalationLevel
 * @param {Object} assessment - Assessment object with reason and score
 * @param {string} goal - The current goal being worked on
 * @param {number} consecutiveIssues - Number of consecutive issues
 * @param {Object} thresholds - Escalation thresholds for context
 * @returns {Object|null} Correction object with level, prompt, and optional shouldAbort flag
 */
export function generateCorrection(level, assessment, goal, consecutiveIssues, thresholds = DEFAULT_ESCALATION_THRESHOLDS) {
  switch (level) {
    case EscalationLevel.REMIND:
      return {
        level,
        prompt: `## Quick Reminder\n\n${assessment.reason}\n\n**Goal:** ${goal}\n\nContinue working.`,
      };

    case EscalationLevel.CORRECT:
      return {
        level,
        prompt: `## Course Correction\n\n${assessment.reason}\n\n**Your goal is:** ${goal}\n\nScore: ${assessment.score}/100\nConsecutive issues: ${consecutiveIssues}/${thresholds.abort}\n\nRefocus and take your next action toward the goal.`,
      };

    case EscalationLevel.REFOCUS:
      return {
        level,
        prompt: `## CRITICAL: REFOCUS REQUIRED\n\nYou have drifted for ${consecutiveIssues} consecutive responses.\n\n**STOP. Your ONLY objective is:** ${goal}\n\n1. Acknowledge this correction\n2. State what you were doing wrong\n3. List 3 steps to get back on track\n4. Execute the FIRST step immediately\n\nWARNING: Continued drift will terminate this session.`,
      };

    case EscalationLevel.CRITICAL:
      return {
        level,
        prompt: `## CRITICAL ESCALATION - FINAL WARNING\n\n⚠️ ONE MORE OFF-TRACK RESPONSE WILL TERMINATE THIS SESSION ⚠️\n\nConsecutive issues: ${consecutiveIssues}/${thresholds.abort}\n\nYou MUST immediately:\n1. STOP all current work\n2. State the EXACT goal: "${goal}"\n3. Take ONE concrete action toward that goal\n\nThis is not a suggestion.`,
      };

    case EscalationLevel.ABORT:
      return {
        level,
        prompt: `## SESSION TERMINATED\n\nUnable to maintain goal focus after ${consecutiveIssues} consecutive issues.\n\nProvide a final summary of:\n1. What was accomplished\n2. What went wrong\n3. Recommendations for retry`,
        shouldAbort: true,
      };

    case EscalationLevel.NONE:
    default:
      return null;
  }
}

/**
 * Get the severity order of an escalation level (higher = more severe)
 *
 * @param {string} level - The escalation level
 * @returns {number} Severity order (0-5)
 */
export function getEscalationSeverity(level) {
  const severityOrder = {
    [EscalationLevel.NONE]: 0,
    [EscalationLevel.REMIND]: 1,
    [EscalationLevel.CORRECT]: 2,
    [EscalationLevel.REFOCUS]: 3,
    [EscalationLevel.CRITICAL]: 4,
    [EscalationLevel.ABORT]: 5,
  };
  return severityOrder[level] ?? 0;
}

/**
 * Check if escalation level requires immediate action
 *
 * @param {string} level - The escalation level
 * @returns {boolean} True if immediate action is required
 */
export function requiresImmediateAction(level) {
  return level === EscalationLevel.CRITICAL || level === EscalationLevel.ABORT;
}

export default {
  EscalationLevel,
  DEFAULT_ESCALATION_THRESHOLDS,
  determineEscalation,
  generateCorrection,
  getEscalationSeverity,
  requiresImmediateAction,
};
