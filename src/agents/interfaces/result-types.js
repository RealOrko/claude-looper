/**
 * Result Types
 *
 * Defines TestResult and VerificationResult classes.
 */

/**
 * Test Result structure
 */
export class TestResult {
  constructor(stepId, testType) {
    this.id = `test_${Date.now()}`;
    this.stepId = stepId;
    this.testType = testType; // unit, integration, exploratory
    this.passed = false;
    this.issues = [];
    this.suggestions = [];
    this.coverage = null;
    this.output = '';
    this.fixPlan = null; // If failed, contains fix instructions
    this.timestamp = Date.now();
  }

  /**
   * Add an issue found during testing
   * @param {string} severity - Issue severity (critical, major, minor)
   * @param {string} description - Issue description
   * @param {string|null} location - File:line or function name
   */
  addIssue(severity, description, location = null) {
    this.issues.push({
      id: `issue_${this.issues.length + 1}`,
      severity, // critical, major, minor
      description,
      location, // file:line or function name
    });
  }

  /**
   * Add a suggestion for improvement
   * @param {string} description - Suggestion description
   * @param {string} priority - Priority (high, medium, low)
   */
  addSuggestion(description, priority = 'medium') {
    this.suggestions.push({
      description,
      priority, // high, medium, low
    });
  }

  /**
   * Generate a fix plan from issues
   * @returns {Object|null} Fix plan or null
   */
  generateFixPlan() {
    if (this.issues.length === 0) return null;

    this.fixPlan = {
      id: `fixplan_${Date.now()}`,
      testResultId: this.id,
      issues: this.issues.map(issue => ({
        ...issue,
        fixDescription: `Fix: ${issue.description}`,
      })),
      priority: this.issues.some(i => i.severity === 'critical') ? 'critical' :
                this.issues.some(i => i.severity === 'major') ? 'major' : 'minor',
    };

    return this.fixPlan;
  }
}

/**
 * Verification Result structure
 */
export class VerificationResult {
  constructor(type, targetId) {
    this.id = `verify_${Date.now()}`;
    this.type = type; // plan, code, test, step, goal
    this.targetId = targetId;
    this.verified = false;
    this.score = 0; // 0-100
    this.issues = [];
    this.recommendation = 'continue'; // continue, fix, replan, abort
    this.reason = '';
    this.timestamp = Date.now();
  }

  /**
   * Set verification result
   * @param {boolean} verified - Whether verified
   * @param {number} score - Score 0-100
   * @param {string} recommendation - Recommendation
   * @param {string} reason - Reason for result
   */
  setResult(verified, score, recommendation, reason) {
    this.verified = verified;
    this.score = score;
    this.recommendation = recommendation;
    this.reason = reason;
  }

  /**
   * Add a verification issue
   * @param {string} description - Issue description
   * @param {string} severity - Issue severity (warning, error)
   */
  addIssue(description, severity = 'warning') {
    this.issues.push({ description, severity });
  }
}

export default { TestResult, VerificationResult };
