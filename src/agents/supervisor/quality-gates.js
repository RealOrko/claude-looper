/**
 * quality-gates.js - Quality gate types, thresholds, and result tracking
 *
 * Provides the foundation for quality control in the supervisor system:
 * - Gate types for different verification points
 * - Configurable thresholds for pass/fail decisions
 * - Result class to track evaluation outcomes
 */

/**
 * Quality gate types - checkpoints where quality is evaluated
 */
export const QualityGateType = {
  PLAN_APPROVAL: 'plan_approval',
  CODE_APPROVAL: 'code_approval',
  STEP_COMPLETION: 'step_completion',
  GOAL_ACHIEVEMENT: 'goal_achievement',
};

/**
 * Default quality gate thresholds (score out of 100)
 */
export const QualityThresholds = {
  [QualityGateType.PLAN_APPROVAL]: 70,      // Plans need 70+ to proceed
  [QualityGateType.CODE_APPROVAL]: 60,      // Code needs 60+ to proceed
  [QualityGateType.STEP_COMPLETION]: 70,    // Steps need 70+ to be marked complete
  [QualityGateType.GOAL_ACHIEVEMENT]: 80,   // Goal needs 80+ to be considered achieved
};

/**
 * Generates a unique ID for quality gate results
 * @returns {string} Unique identifier
 */
function generateGateId() {
  return `gate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Quality Gate Result - Tracks pass/fail for each gate
 *
 * Represents the outcome of evaluating a quality gate checkpoint.
 * Contains the score, threshold, decision, and any issues/suggestions.
 */
export class QualityGateResult {
  /**
   * @param {string} gateType - One of QualityGateType values
   * @param {string} targetId - ID of the item being evaluated (plan, step, etc.)
   */
  constructor(gateType, targetId) {
    this.id = generateGateId();
    this.gateType = gateType;
    this.targetId = targetId;
    this.threshold = QualityThresholds[gateType] || 70;
    this.score = 0;
    this.passed = false;
    this.issues = [];
    this.suggestions = [];
    this.decision = 'pending'; // pending, approved, rejected, needs_revision
    this.reason = '';
    this.timestamp = Date.now();
  }

  /**
   * Evaluate the gate with a score
   * @param {number} score - Score from 0-100
   * @param {Array} issues - List of issues found
   * @param {Array} suggestions - List of suggestions for improvement
   */
  evaluate(score, issues = [], suggestions = []) {
    this.score = score;
    this.issues = issues;
    this.suggestions = suggestions;
    this.passed = score >= this.threshold;
    this.decision = this.passed ? 'approved' : 'needs_revision';

    // Reject if score is significantly below threshold
    if (score < this.threshold - 20) {
      this.decision = 'rejected';
    }
  }

  /**
   * Get a summary of the gate result
   * @returns {Object} Summary object with key metrics
   */
  getSummary() {
    return {
      gateType: this.gateType,
      passed: this.passed,
      score: this.score,
      threshold: this.threshold,
      decision: this.decision,
      issueCount: this.issues.length,
    };
  }
}

export default {
  QualityGateType,
  QualityThresholds,
  QualityGateResult,
};
