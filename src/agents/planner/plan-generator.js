/**
 * Plan Generator Module
 *
 * Handles plan creation and sub-plan generation.
 */

import { PlanDepth } from '../interfaces.js';
import { parsePlanResponse } from './plan-parser.js';
import { assessPlanQuality, MAX_SUBPLAN_STEPS } from './quality-assessment.js';
import { DependencyTracker, parseDependenciesFromResponse } from './dependency-tracker.js';
import { buildPlanningPrompt, buildSubPlanPrompt, buildAdaptiveSubPlanPrompt } from './prompt-builder.js';
import { ExecutionContext } from './execution-context.js';

// Re-export for backwards compatibility
export { ExecutionContext } from './execution-context.js';

/**
 * Plan Generator - creates execution plans
 */
export class PlanGenerator {
  constructor(client, config = {}) {
    this.client = client;
    this.model = config.model || 'opus';
    this.planHistory = [];
    this.maxPlanHistory = 20;

    // Track dependencies across plans
    this.dependencyTracker = new DependencyTracker();

    // Track sub-plan attempts per step
    this.subPlanAttempts = new Map();
    this.maxSubPlanAttempts = 3;

    // Store context for adaptive replanning
    this.executionContext = new ExecutionContext();
  }

  /**
   * Create an execution plan from a goal
   * @param {string} goal - The goal to plan for
   * @param {Object} context - Additional context
   * @returns {Promise<Object>} The execution plan
   */
  async createPlan(goal, context = {}) {
    const prompt = buildPlanningPrompt(goal, context);

    const result = await this.client.sendPrompt(prompt, {
      newSession: true,
      timeout: 5 * 60 * 1000, // 5 minutes
      model: this.model,
    });

    const plan = parsePlanResponse(result.response, goal);
    plan.depth = PlanDepth.ROOT;

    // Parse and store dependencies
    parseDependenciesFromResponse(result.response, plan, this.dependencyTracker);

    // Store dependencies in plan
    plan.dependencies = this.dependencyTracker.toJSON();

    // Assess plan quality
    plan.qualityAssessment = assessPlanQuality(plan);

    // Store in history
    this.addToHistory(plan);

    return plan;
  }

  /**
   * Create a sub-plan for a blocked step
   * @param {Object} blockedStep - The blocked step
   * @param {string} reason - Block reason
   * @param {number} depth - Current depth
   * @returns {Promise<Object>} The sub-plan
   */
  async createSubPlan(blockedStep, reason, depth) {
    // Build context-aware prompt
    const prompt = buildSubPlanPrompt(blockedStep, reason, depth);

    const result = await this.client.sendPrompt(prompt, {
      newSession: true,
      timeout: 5 * 60 * 1000,
      model: this.model,
    });

    const subPlan = parsePlanResponse(
      result.response,
      `Alternative approach for: ${blockedStep.description}`
    );

    subPlan.depth = depth;
    subPlan.parentStepId = blockedStep.id;
    subPlan.blockReason = reason;
    subPlan.attempt = this.subPlanAttempts.get(blockedStep.id) || 1;

    // Limit sub-plan steps based on depth
    const maxSteps = depth === 1 ? MAX_SUBPLAN_STEPS :
                     depth === 2 ? 3 :
                     2;  // Level 3 should be minimal
    if (subPlan.steps.length > maxSteps) {
      subPlan.steps = subPlan.steps.slice(0, maxSteps);
    }

    // Assess quality
    subPlan.qualityAssessment = assessPlanQuality(subPlan);

    // Store in history
    this.addToHistory(subPlan);

    return subPlan;
  }

  /**
   * Create an adaptive sub-plan that learns from previous attempts
   * @param {Object} blockedStep - The blocked step
   * @param {string} reason - Block reason
   * @param {number} depth - Current depth
   * @param {Object[]} previousAttempts - Previous attempt info
   * @returns {Promise<Object>} The adaptive sub-plan
   */
  async createAdaptiveSubPlan(blockedStep, reason, depth, previousAttempts = []) {
    // Build a prompt that incorporates learnings from failed attempts
    const prompt = buildAdaptiveSubPlanPrompt(
      blockedStep,
      reason,
      depth,
      previousAttempts,
      this.executionContext
    );

    const result = await this.client.sendPrompt(prompt, {
      newSession: true,
      timeout: 5 * 60 * 1000,
      model: this.model,
    });

    const subPlan = parsePlanResponse(
      result.response,
      `Adaptive approach for: ${blockedStep.description}`
    );

    subPlan.depth = depth;
    subPlan.parentStepId = blockedStep.id;
    subPlan.blockReason = reason;
    subPlan.isAdaptive = true;
    subPlan.previousAttemptCount = previousAttempts.length;

    // Store in history
    this.addToHistory(subPlan);

    return subPlan;
  }

  /**
   * Check if more sub-plan attempts are allowed for a step
   * @param {string} stepId - The step ID
   * @returns {boolean} Whether more attempts are allowed
   */
  canRetrySubPlan(stepId) {
    const attempts = this.subPlanAttempts.get(stepId) || 0;
    return attempts < this.maxSubPlanAttempts;
  }

  /**
   * Record a sub-plan attempt for a step
   * @param {string} stepId - The step ID
   * @returns {number} The attempt number
   */
  recordSubPlanAttempt(stepId) {
    const attempts = (this.subPlanAttempts.get(stepId) || 0) + 1;
    this.subPlanAttempts.set(stepId, attempts);
    return attempts;
  }

  /**
   * Get sub-plan attempt count for a step
   * @param {string} stepId - The step ID
   * @returns {number} The attempt count
   */
  getSubPlanAttemptCount(stepId) {
    return this.subPlanAttempts.get(stepId) || 0;
  }

  /**
   * Add plan to history
   * @param {Object} plan - The plan to add
   */
  addToHistory(plan) {
    this.planHistory.push({
      timestamp: Date.now(),
      planId: plan.id,
      goal: plan.goal,
      depth: plan.depth,
      stepCount: plan.steps.length,
    });

    // Trim history
    if (this.planHistory.length > this.maxPlanHistory) {
      this.planHistory = this.planHistory.slice(-this.maxPlanHistory);
    }
  }

  /**
   * Get dependency tracker
   * @returns {DependencyTracker} The dependency tracker
   */
  getDependencyTracker() {
    return this.dependencyTracker;
  }

  /**
   * Check if a step can be executed based on dependencies
   * @param {string} stepId - The step ID
   * @param {string[]} completedStepIds - Completed step IDs
   * @returns {boolean} Whether the step can be executed
   */
  canExecuteStep(stepId, completedStepIds) {
    return this.dependencyTracker.canExecute(stepId, new Set(completedStepIds));
  }

  /**
   * Get optimal execution order for plan steps
   * @param {Object} plan - The plan
   * @returns {string[]} Ordered step IDs
   */
  getExecutionOrder(plan) {
    return this.dependencyTracker.getExecutionOrder(plan.steps);
  }

  /**
   * Reset for new goal
   */
  reset() {
    this.executionContext.reset();
    this.subPlanAttempts.clear();
    this.dependencyTracker = new DependencyTracker();
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      model: this.model,
      plansCreated: this.planHistory.length,
      subPlanAttempts: Object.fromEntries(this.subPlanAttempts),
      executionContext: this.executionContext.getStats(),
      recentPlans: this.planHistory.slice(-5).map(p => ({
        goal: p.goal.substring(0, 50),
        depth: p.depth,
        steps: p.stepCount,
      })),
    };
  }
}

export default {
  PlanGenerator,
  ExecutionContext,
};
