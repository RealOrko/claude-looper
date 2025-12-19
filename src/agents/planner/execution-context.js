/**
 * Execution Context Module
 *
 * Tracks progress and learnings across plan execution.
 */

/**
 * Execution context for tracking progress and learning
 */
export class ExecutionContext {
  constructor() {
    this.completedSteps = [];
    this.failedSteps = [];
    this.blockedReasons = [];
    this.successfulApproaches = [];
  }

  /**
   * Update context with new information
   * @param {Object} updates - Context updates
   */
  update(updates) {
    if (updates.completedSteps) {
      this.completedSteps.push(...updates.completedSteps);
    }
    if (updates.failedSteps) {
      this.failedSteps.push(...updates.failedSteps);
    }
    if (updates.successfulApproaches) {
      this.successfulApproaches.push(...updates.successfulApproaches);
    }
  }

  /**
   * Record a blocked step reason
   * @param {string} stepId - The step ID
   * @param {string} reason - Block reason
   * @param {number} depth - Plan depth
   */
  recordBlockedReason(stepId, reason, depth) {
    this.blockedReasons.push({
      stepId,
      reason,
      depth,
      timestamp: Date.now(),
    });
  }

  /**
   * Record a successful approach for future reference
   * @param {string} description - Description of the approach
   * @param {string} stepId - The step ID
   */
  recordSuccessfulApproach(description, stepId) {
    this.successfulApproaches.push({
      description,
      stepId,
      timestamp: Date.now(),
    });

    // Limit stored approaches
    if (this.successfulApproaches.length > 20) {
      this.successfulApproaches = this.successfulApproaches.slice(-20);
    }
  }

  /**
   * Reset context for new goal
   */
  reset() {
    this.completedSteps = [];
    this.failedSteps = [];
    this.blockedReasons = [];
    this.successfulApproaches = [];
  }

  /**
   * Get summary stats
   * @returns {Object} Summary stats
   */
  getStats() {
    return {
      completedSteps: this.completedSteps.length,
      failedSteps: this.failedSteps.length,
      blockedReasons: this.blockedReasons.length,
    };
  }
}

export default ExecutionContext;
