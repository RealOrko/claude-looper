/**
 * quality-gates.js - Quality gate logic for the Supervisor agent
 *
 * This file re-exports from the supervisor module for backwards compatibility
 * and adds additional assessment classes for plan quality.
 */

// Import and re-export core quality gate items from the supervisor module
export {
  QualityGateType,
  QualityThresholds,
  QualityGateResult,
} from './supervisor/quality-gates.js';

// Re-export escalation logic from supervisor module
export {
  EscalationLevel,
  determineEscalation,
  generateCorrection,
} from './supervisor/escalation-logic.js';

// Re-export from progress-monitor for backwards compatibility
export { ProgressMonitor } from './progress-monitor.js';

/**
 * Plan quality threshold for approval
 */
export const PLAN_QUALITY_THRESHOLD = 70;

/**
 * Plan quality assessment result
 */
export class PlanQualityAssessment {
  constructor(plan) {
    this.planId = plan.id;
    this.score = 0;
    this.issues = [];
    this.strengths = [];
    this.approved = false;
    this.suggestions = [];
    this.timestamp = Date.now();
  }

  addIssue(severity, description) {
    this.issues.push({ severity, description });
  }

  addStrength(description) {
    this.strengths.push(description);
  }

  addSuggestion(description) {
    this.suggestions.push(description);
  }

  calculateScore() {
    let score = 100;

    for (const issue of this.issues) {
      if (issue.severity === 'critical') score -= 30;
      else if (issue.severity === 'major') score -= 15;
      else if (issue.severity === 'minor') score -= 5;
    }

    this.score = Math.max(0, Math.min(100, score));
    this.approved = this.score >= PLAN_QUALITY_THRESHOLD;

    return this.score;
  }

  getSummary() {
    return {
      planId: this.planId,
      score: this.score,
      approved: this.approved,
      issueCount: this.issues.length,
      strengthCount: this.strengths.length,
    };
  }
}

// Import for default export
import { QualityGateType, QualityThresholds, QualityGateResult } from './supervisor/quality-gates.js';
import { EscalationLevel } from './supervisor/escalation-logic.js';

export default {
  EscalationLevel,
  QualityGateType,
  QualityThresholds,
  PLAN_QUALITY_THRESHOLD,
  QualityGateResult,
  PlanQualityAssessment,
};
