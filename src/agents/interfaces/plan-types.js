/**
 * Plan-Related Types
 *
 * Defines PlanStep and ExecutionPlan classes.
 */

import { PlanDepth } from './enums.js';

/**
 * Plan Step structure
 */
export class PlanStep {
  constructor(number, description, complexity = 'medium') {
    this.id = `step_${Date.now()}_${number}`;
    this.number = number;
    this.description = description;
    this.complexity = complexity; // simple, medium, complex
    this.status = 'pending'; // pending, in_progress, completed, failed, blocked
    this.depth = PlanDepth.ROOT;
    this.parentStepId = null;
    this.subSteps = [];
    this.attempts = 0;
    this.maxAttempts = 3;
    this.codeOutput = null;
    this.testResults = null;
    this.verificationResult = null;
    this.failReason = null;
    this.createdAt = Date.now();
    this.completedAt = null;
  }

  /**
   * Check if step can be retried
   * @returns {boolean} Whether step can be retried
   */
  canRetry() {
    return this.attempts < this.maxAttempts && this.depth < PlanDepth.LEVEL_3;
  }

  /**
   * Check if step has sub-steps
   * @returns {boolean} Whether step has sub-steps
   */
  hasSubSteps() {
    return this.subSteps.length > 0;
  }

  /**
   * Add a sub-step
   * @param {PlanStep} step - The sub-step to add
   */
  addSubStep(step) {
    step.depth = this.depth + 1;
    step.parentStepId = this.id;
    this.subSteps.push(step);
  }

  /**
   * Get all sub-steps recursively
   * @returns {PlanStep[]} All nested sub-steps
   */
  getAllSubSteps() {
    const all = [];
    for (const sub of this.subSteps) {
      all.push(sub);
      all.push(...sub.getAllSubSteps());
    }
    return all;
  }
}

/**
 * Execution Plan structure
 */
export class ExecutionPlan {
  constructor(goal, analysis = '') {
    this.id = `plan_${Date.now()}`;
    this.goal = goal;
    this.analysis = analysis;
    this.steps = [];
    this.depth = PlanDepth.ROOT;
    this.parentPlanId = null;
    this.status = 'pending'; // pending, in_progress, completed, failed
    this.currentStepIndex = 0;
    this.createdAt = Date.now();
    this.completedAt = null;
  }

  /**
   * Add a step to the plan
   * @param {string} description - Step description
   * @param {string} complexity - Step complexity (simple/medium/complex)
   * @returns {PlanStep} The created step
   */
  addStep(description, complexity = 'medium') {
    const step = new PlanStep(this.steps.length + 1, description, complexity);
    step.depth = this.depth;
    this.steps.push(step);
    return step;
  }

  /**
   * Get current step
   * @returns {PlanStep|null} Current step or null
   */
  getCurrentStep() {
    return this.steps[this.currentStepIndex] || null;
  }

  /**
   * Advance to next step
   * @returns {PlanStep|null} Next step or null
   */
  advanceStep() {
    if (this.currentStepIndex < this.steps.length) {
      const current = this.steps[this.currentStepIndex];
      current.status = 'completed';
      current.completedAt = Date.now();
      this.currentStepIndex++;
    }
    return this.getCurrentStep();
  }

  /**
   * Check if plan is complete
   * @returns {boolean} Whether plan is complete
   */
  isComplete() {
    return this.currentStepIndex >= this.steps.length;
  }

  /**
   * Get progress information
   * @returns {Object} Progress info
   */
  getProgress() {
    const completed = this.steps.filter(s => s.status === 'completed').length;
    const failed = this.steps.filter(s => s.status === 'failed').length;

    return {
      current: this.currentStepIndex + 1,
      total: this.steps.length,
      completed,
      failed,
      pending: this.steps.length - completed - failed,
      percentComplete: this.steps.length > 0
        ? Math.round((completed / this.steps.length) * 100)
        : 0,
    };
  }
}

export default { PlanStep, ExecutionPlan };
