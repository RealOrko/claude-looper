/**
 * Fix Cycle Tracker
 * Tracks fix attempts and learning context for iterative bug fixing
 */

import { FixCycleStatus } from '../interfaces.js';

/**
 * Fix Cycle Tracker - Manages fix attempt tracking and learning context
 */
export class FixCycleTracker {
  constructor(maxFixCycles = 3) {
    this.fixCycleTracker = new Map();
    this.maxFixCycles = maxFixCycles;

    this.learningContext = {
      commonIssues: [],
      successfulFixes: [],
      failedApproaches: [],
    };
  }

  /**
   * Initialize fix cycle tracking for a step
   */
  initializeFixCycle(stepId, previousFixPlan = null) {
    if (!this.fixCycleTracker.has(stepId)) {
      this.fixCycleTracker.set(stepId, {
        attempts: 0,
        maxAttempts: this.maxFixCycles,
        issues: [],
        status: FixCycleStatus.NOT_STARTED,
        previousPlans: [],
      });
    }

    const tracker = this.fixCycleTracker.get(stepId);

    if (previousFixPlan) {
      tracker.attempts++;
      tracker.previousPlans.push({
        planId: previousFixPlan.id || `plan_${tracker.attempts}`,
        timestamp: Date.now(),
        issueCount: previousFixPlan.issues?.length || 0,
      });
    }

    return tracker;
  }

  /**
   * Update fix cycle status
   */
  updateFixCycleStatus(stepId, status, issues = []) {
    const tracker = this.fixCycleTracker.get(stepId);
    if (tracker) {
      tracker.status = status === 'resolved' ? FixCycleStatus.RESOLVED :
                       status === 'in_progress' ? FixCycleStatus.IN_PROGRESS :
                       tracker.attempts >= tracker.maxAttempts ? FixCycleStatus.MAX_ATTEMPTS_REACHED :
                       FixCycleStatus.IN_PROGRESS;
      tracker.issues = issues;
    }
  }

  /**
   * Get fix cycle status for a step
   */
  getFixCycleStatus(stepId) {
    const tracker = this.fixCycleTracker.get(stepId);
    if (!tracker) {
      return { status: FixCycleStatus.NOT_STARTED, attempts: 0, maxAttempts: this.maxFixCycles, canRetry: true };
    }

    return {
      status: tracker.status,
      attempts: tracker.attempts,
      maxAttempts: tracker.maxAttempts,
      canRetry: tracker.attempts < tracker.maxAttempts && tracker.status !== FixCycleStatus.RESOLVED,
      previousPlanCount: tracker.previousPlans.length,
    };
  }

  /**
   * Record a successful fix for learning
   */
  recordSuccessfulFix(stepId, fixPlan) {
    if (!fixPlan) return;

    this.learningContext.successfulFixes.push({
      stepId,
      timestamp: Date.now(),
      approach: fixPlan.suggestedApproach,
      issueTypes: fixPlan.issues?.map(i => i.category) || [],
    });

    if (this.learningContext.successfulFixes.length > 20) {
      this.learningContext.successfulFixes = this.learningContext.successfulFixes.slice(-20);
    }
  }

  /**
   * Record a failed fix approach for learning
   */
  recordFailedApproach(stepId, approach, reason) {
    this.learningContext.failedApproaches.push({ stepId, timestamp: Date.now(), approach, reason });

    if (this.learningContext.failedApproaches.length > 20) {
      this.learningContext.failedApproaches = this.learningContext.failedApproaches.slice(-20);
    }
  }

  /**
   * Add to common issues
   */
  addToCommonIssues(description) {
    const pattern = description.substring(0, 100);

    if (!this.learningContext.commonIssues.includes(pattern)) {
      this.learningContext.commonIssues.push(pattern);

      if (this.learningContext.commonIssues.length > 10) {
        this.learningContext.commonIssues = this.learningContext.commonIssues.slice(-10);
      }
    }
  }

  /**
   * Reset for new goal
   */
  reset() {
    this.fixCycleTracker.clear();
  }

  /**
   * Get the number of tracked cycles
   */
  get size() {
    return this.fixCycleTracker.size;
  }

  /**
   * Get tracker for a step (Map.get delegate)
   */
  get(stepId) {
    return this.fixCycleTracker.get(stepId);
  }

  /**
   * Check if tracker exists (Map.has delegate)
   */
  has(stepId) {
    return this.fixCycleTracker.has(stepId);
  }

  /**
   * Get fix cycle stats
   */
  getStats() {
    const stats = { totalCycles: this.fixCycleTracker.size, resolved: 0, inProgress: 0, maxAttemptsReached: 0 };

    for (const tracker of this.fixCycleTracker.values()) {
      if (tracker.status === FixCycleStatus.RESOLVED) stats.resolved++;
      else if (tracker.status === FixCycleStatus.MAX_ATTEMPTS_REACHED) stats.maxAttemptsReached++;
      else if (tracker.status === FixCycleStatus.IN_PROGRESS) stats.inProgress++;
    }

    return stats;
  }

  /**
   * Get learning context
   */
  getLearningContext() {
    return this.learningContext;
  }
}
