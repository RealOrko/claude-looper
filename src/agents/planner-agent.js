/**
 * Planner Agent - Goal Decomposition and Recursive Re-planning
 *
 * The Planner agent is responsible for:
 * 1. Analyzing goals and breaking them into executable steps
 * 2. Creating execution plans with complexity ratings
 * 3. Recursive re-planning when steps are blocked (up to 3 levels deep)
 * 4. Adapting plans based on feedback from other agents
 *
 * Uses Opus model for intelligent planning.
 */

import {
  BaseAgent,
  AgentRole,
  AgentStatus,
  MessageType,
  PlanDepth,
} from './interfaces.js';

// Re-export classes for backwards compatibility
export { PlanQualityAssessment, DependencyTracker } from './planner/index.js';

import {
  PlanGenerator,
  ExecutionContext,
  assessPlanQuality,
  formatPlanForDisplay,
} from './planner/index.js';

/**
 * Planner Agent
 */
export class PlannerAgent extends BaseAgent {
  constructor(client, config = {}) {
    super(AgentRole.PLANNER, client, config);

    this.model = config.model || 'opus';
    this.maxSubPlanAttempts = 3;

    // Create the plan generator
    this.generator = new PlanGenerator(client, { model: this.model });

    // Register message handlers
    this.registerHandlers();
  }

  /**
   * Register message handlers for this agent
   */
  registerHandlers() {
    this.onMessage(MessageType.PLAN_REQUEST, (msg) => this.handlePlanRequest(msg));
    this.onMessage(MessageType.REPLAN_REQUEST, (msg) => this.handleReplanRequest(msg));
    this.onMessage(MessageType.SUBPLAN_REQUEST, (msg) => this.handleSubplanRequest(msg));
  }

  /**
   * Handle initial plan request
   */
  async handlePlanRequest(message) {
    const { goal, context } = message.payload;

    this.status = AgentStatus.WORKING;

    try {
      const plan = await this.generator.createPlan(goal, context);

      return message.createResponse(MessageType.PLAN_RESPONSE, {
        success: true,
        plan,
      });

    } catch (error) {
      return message.createResponse(MessageType.PLAN_RESPONSE, {
        success: false,
        error: error.message,
      });
    } finally {
      this.status = AgentStatus.IDLE;
    }
  }

  /**
   * Handle re-plan request for blocked step
   */
  async handleReplanRequest(message) {
    const { blockedStep, reason, depth, executionContext } = message.payload;

    this.status = AgentStatus.WORKING;

    try {
      // Check depth limit
      if (depth >= PlanDepth.LEVEL_3) {
        return message.createResponse(MessageType.SUBPLAN_RESPONSE, {
          success: false,
          error: 'Maximum re-planning depth reached (3 levels)',
          depthLimitReached: true,
        });
      }

      // Check sub-plan attempt limit
      if (!this.generator.canRetrySubPlan(blockedStep.id)) {
        return message.createResponse(MessageType.SUBPLAN_RESPONSE, {
          success: false,
          error: `Maximum sub-plan attempts (${this.maxSubPlanAttempts}) reached for this step`,
          maxAttemptsReached: true,
        });
      }

      // Record attempt
      const attempt = this.generator.recordSubPlanAttempt(blockedStep.id);

      // Update execution context if provided
      if (executionContext) {
        this.generator.executionContext.update(executionContext);
      }

      // Record the block reason for future reference
      this.generator.executionContext.recordBlockedReason(
        blockedStep.id,
        reason,
        depth
      );

      const subPlan = await this.generator.createSubPlan(blockedStep, reason, depth + 1);

      // Assess plan quality
      const assessment = assessPlanQuality(subPlan);

      return message.createResponse(MessageType.SUBPLAN_RESPONSE, {
        success: true,
        plan: subPlan,
        depth: depth + 1,
        attempt,
        assessment,
      });

    } catch (error) {
      return message.createResponse(MessageType.SUBPLAN_RESPONSE, {
        success: false,
        error: error.message,
      });
    } finally {
      this.status = AgentStatus.IDLE;
    }
  }

  /**
   * Handle sub-plan request (alternative to replan)
   */
  async handleSubplanRequest(message) {
    return this.handleReplanRequest(message);
  }

  /**
   * Create an execution plan from a goal
   */
  async createPlan(goal, context = {}) {
    return this.generator.createPlan(goal, context);
  }

  /**
   * Create a sub-plan for a blocked step
   */
  async createSubPlan(blockedStep, reason, depth) {
    return this.generator.createSubPlan(blockedStep, reason, depth);
  }

  /**
   * Create an adaptive sub-plan that learns from previous attempts
   */
  async createAdaptiveSubPlan(blockedStep, reason, depth, previousAttempts = []) {
    return this.generator.createAdaptiveSubPlan(blockedStep, reason, depth, previousAttempts);
  }

  /**
   * Execute method (for BaseAgent compatibility)
   */
  async execute(task) {
    if (task.type === 'plan') {
      return this.createPlan(task.goal, task.context);
    } else if (task.type === 'replan') {
      return this.createSubPlan(task.blockedStep, task.reason, task.depth);
    }
    throw new Error(`Unknown task type: ${task.type}`);
  }

  /**
   * Get agent statistics
   */
  getStats() {
    return {
      ...super.getStats(),
      ...this.generator.getStats(),
    };
  }

  /**
   * Get dependency tracker for external use
   */
  getDependencyTracker() {
    return this.generator.getDependencyTracker();
  }

  /**
   * Check if a step can be executed based on dependencies
   */
  canExecuteStep(stepId, completedStepIds) {
    return this.generator.canExecuteStep(stepId, completedStepIds);
  }

  /**
   * Get optimal execution order for plan steps
   */
  getExecutionOrder(plan) {
    return this.generator.getExecutionOrder(plan);
  }

  /**
   * Record a successful approach for future reference
   */
  recordSuccessfulApproach(description, stepId) {
    this.generator.executionContext.recordSuccessfulApproach(description, stepId);
  }

  /**
   * Reset execution context for new goal
   */
  resetExecutionContext() {
    this.generator.reset();
  }

  /**
   * Format plan for display
   */
  formatPlan(plan) {
    return formatPlanForDisplay(plan);
  }

  /**
   * Assess plan quality
   */
  assessPlanQuality(plan) {
    return assessPlanQuality(plan);
  }

  /**
   * Get plan history
   */
  get planHistory() {
    return this.generator.planHistory;
  }

  /**
   * Get execution context
   */
  get executionContext() {
    return this.generator.executionContext;
  }

  /**
   * Get dependency tracker
   */
  get dependencyTracker() {
    return this.generator.getDependencyTracker();
  }
}

export default PlannerAgent;
