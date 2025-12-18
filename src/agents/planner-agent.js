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
  ExecutionPlan,
  PlanStep,
  AgentMessage,
} from './interfaces.js';

// Limits
const MAX_PLAN_STEPS = 15;
const MIN_PLAN_STEPS = 2;
const MAX_SUBPLAN_STEPS = 5;

// Quality thresholds
const PLAN_QUALITY_THRESHOLD = 70;  // Minimum score for plan approval

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
    // Base score
    let score = 100;

    // Deduct for issues
    for (const issue of this.issues) {
      if (issue.severity === 'critical') score -= 30;
      else if (issue.severity === 'major') score -= 15;
      else if (issue.severity === 'minor') score -= 5;
    }

    // Ensure score is in valid range
    this.score = Math.max(0, Math.min(100, score));
    this.approved = this.score >= PLAN_QUALITY_THRESHOLD;

    return this.score;
  }
}

/**
 * Step dependency tracker
 */
export class DependencyTracker {
  constructor() {
    this.dependencies = new Map(); // stepId -> Set of dependent stepIds
    this.reverseDeps = new Map();  // stepId -> Set of steps it depends on
  }

  /**
   * Add a dependency: stepId depends on dependsOnId
   */
  addDependency(stepId, dependsOnId) {
    if (!this.dependencies.has(dependsOnId)) {
      this.dependencies.set(dependsOnId, new Set());
    }
    this.dependencies.get(dependsOnId).add(stepId);

    if (!this.reverseDeps.has(stepId)) {
      this.reverseDeps.set(stepId, new Set());
    }
    this.reverseDeps.get(stepId).add(dependsOnId);
  }

  /**
   * Get steps that depend on the given step
   */
  getDependents(stepId) {
    return Array.from(this.dependencies.get(stepId) || []);
  }

  /**
   * Get steps that the given step depends on
   */
  getDependencies(stepId) {
    return Array.from(this.reverseDeps.get(stepId) || []);
  }

  /**
   * Check if a step can be executed (all dependencies satisfied)
   */
  canExecute(stepId, completedSteps) {
    const deps = this.reverseDeps.get(stepId);
    if (!deps || deps.size === 0) return true;

    for (const depId of deps) {
      if (!completedSteps.has(depId)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get execution order respecting dependencies
   */
  getExecutionOrder(steps) {
    const order = [];
    const completed = new Set();
    const remaining = new Set(steps.map(s => s.id));

    while (remaining.size > 0) {
      let added = false;
      for (const stepId of remaining) {
        if (this.canExecute(stepId, completed)) {
          order.push(stepId);
          completed.add(stepId);
          remaining.delete(stepId);
          added = true;
        }
      }
      // Prevent infinite loop if circular dependency
      if (!added) {
        // Add remaining in original order
        for (const stepId of remaining) {
          order.push(stepId);
        }
        break;
      }
    }

    return order;
  }

  /**
   * Serialize dependencies for storage
   */
  toJSON() {
    const deps = {};
    for (const [key, value] of this.dependencies) {
      deps[key] = Array.from(value);
    }
    return deps;
  }

  /**
   * Load dependencies from serialized form
   */
  static fromJSON(json) {
    const tracker = new DependencyTracker();
    for (const [dependsOn, dependents] of Object.entries(json)) {
      for (const dependent of dependents) {
        tracker.addDependency(dependent, dependsOn);
      }
    }
    return tracker;
  }
}

/**
 * Planner Agent
 */
export class PlannerAgent extends BaseAgent {
  constructor(client, config = {}) {
    super(AgentRole.PLANNER, client, config);

    this.model = config.model || 'opus';
    this.planHistory = [];
    this.maxPlanHistory = 20;

    // Track dependencies across plans
    this.dependencyTracker = new DependencyTracker();

    // Track sub-plan attempts per step
    this.subPlanAttempts = new Map();
    this.maxSubPlanAttempts = 3;

    // Store context for adaptive replanning
    this.executionContext = {
      completedSteps: [],
      failedSteps: [],
      blockedReasons: [],
      successfulApproaches: [],
    };

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
      const plan = await this.createPlan(goal, context);

      // Store in history
      this.addToHistory(plan);

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

      // Track sub-plan attempts for this step
      const stepAttempts = this.subPlanAttempts.get(blockedStep.id) || 0;
      if (stepAttempts >= this.maxSubPlanAttempts) {
        return message.createResponse(MessageType.SUBPLAN_RESPONSE, {
          success: false,
          error: `Maximum sub-plan attempts (${this.maxSubPlanAttempts}) reached for this step`,
          maxAttemptsReached: true,
        });
      }
      this.subPlanAttempts.set(blockedStep.id, stepAttempts + 1);

      // Update execution context if provided
      if (executionContext) {
        this.updateExecutionContext(executionContext);
      }

      // Record the block reason for future reference
      this.executionContext.blockedReasons.push({
        stepId: blockedStep.id,
        reason,
        depth,
        timestamp: Date.now(),
      });

      const subPlan = await this.createSubPlan(blockedStep, reason, depth + 1);

      // Store in history
      this.addToHistory(subPlan);

      // Assess plan quality
      const assessment = this.assessPlanQuality(subPlan);

      return message.createResponse(MessageType.SUBPLAN_RESPONSE, {
        success: true,
        plan: subPlan,
        depth: depth + 1,
        attempt: stepAttempts + 1,
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
   * Update execution context with new information
   */
  updateExecutionContext(context) {
    if (context.completedSteps) {
      this.executionContext.completedSteps.push(...context.completedSteps);
    }
    if (context.failedSteps) {
      this.executionContext.failedSteps.push(...context.failedSteps);
    }
    if (context.successfulApproaches) {
      this.executionContext.successfulApproaches.push(...context.successfulApproaches);
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
    const prompt = this.buildPlanningPrompt(goal, context);

    const result = await this.client.sendPrompt(prompt, {
      newSession: true,
      timeout: 5 * 60 * 1000, // 5 minutes
      model: this.model,
    });

    const plan = this.parsePlanResponse(result.response, goal);
    plan.depth = PlanDepth.ROOT;

    // Parse and store dependencies
    this.parseDependencies(result.response, plan);

    // Assess plan quality
    plan.qualityAssessment = this.assessPlanQuality(plan);

    return plan;
  }

  /**
   * Assess the quality of a plan
   */
  assessPlanQuality(plan) {
    const assessment = new PlanQualityAssessment(plan);

    // Check for minimum steps
    if (plan.steps.length < MIN_PLAN_STEPS) {
      assessment.addIssue('major', `Plan has only ${plan.steps.length} steps, minimum is ${MIN_PLAN_STEPS}`);
    }

    // Check for overly complex plans
    if (plan.steps.length > MAX_PLAN_STEPS) {
      assessment.addIssue('minor', `Plan exceeds ${MAX_PLAN_STEPS} steps, may be too granular`);
    }

    // Check step quality
    for (const step of plan.steps) {
      // Check for vague descriptions
      if (step.description.length < 15) {
        assessment.addIssue('minor', `Step ${step.number} has a very short description`);
      }

      // Check for action verbs
      const actionVerbs = ['create', 'implement', 'add', 'update', 'fix', 'refactor', 'test', 'configure', 'setup', 'build', 'write', 'modify', 'remove', 'delete', 'integrate'];
      const hasActionVerb = actionVerbs.some(verb =>
        step.description.toLowerCase().startsWith(verb) ||
        step.description.toLowerCase().includes(` ${verb} `)
      );
      if (!hasActionVerb) {
        assessment.addIssue('minor', `Step ${step.number} may not be actionable (no clear action verb)`);
      }

      // Check for testability indicators
      if (step.complexity !== 'simple') {
        const testableIndicators = ['test', 'verify', 'validate', 'check', 'ensure'];
        const hasTestable = testableIndicators.some(ind =>
          step.description.toLowerCase().includes(ind)
        );
        if (hasTestable) {
          assessment.addStrength(`Step ${step.number} includes verification`);
        }
      }
    }

    // Check for analysis
    if (!plan.analysis || plan.analysis.length < 20) {
      assessment.addIssue('minor', 'Plan analysis is missing or too brief');
    } else {
      assessment.addStrength('Plan includes thoughtful analysis');
    }

    // Check complexity distribution
    const complexityCount = {
      simple: plan.steps.filter(s => s.complexity === 'simple').length,
      medium: plan.steps.filter(s => s.complexity === 'medium').length,
      complex: plan.steps.filter(s => s.complexity === 'complex').length,
    };

    if (complexityCount.complex > plan.steps.length * 0.5) {
      assessment.addIssue('major', 'More than 50% of steps are complex - consider breaking them down');
    }

    if (complexityCount.simple + complexityCount.medium > 0) {
      assessment.addStrength('Plan has a mix of complexity levels');
    }

    // Calculate final score
    assessment.calculateScore();

    // Add suggestions based on issues
    if (assessment.issues.length > 0) {
      if (assessment.issues.some(i => i.description.includes('complex'))) {
        assessment.addSuggestion('Break complex steps into smaller, more manageable tasks');
      }
      if (assessment.issues.some(i => i.description.includes('actionable'))) {
        assessment.addSuggestion('Start each step with a clear action verb');
      }
    }

    return assessment;
  }

  /**
   * Parse dependencies from plan response
   */
  parseDependencies(response, plan) {
    // Reset dependency tracker for new plan
    this.dependencyTracker = new DependencyTracker();

    // Look for DEPENDENCIES section
    const depsMatch = response.match(/DEPENDENCIES:\s*\n([\s\S]*?)(?=RISKS:|TOTAL_STEPS:|$)/i);
    if (!depsMatch || depsMatch[1].toLowerCase().includes('none')) {
      // Assume sequential dependencies by default
      for (let i = 1; i < plan.steps.length; i++) {
        this.dependencyTracker.addDependency(
          plan.steps[i].id,
          plan.steps[i - 1].id
        );
      }
      return;
    }

    // Parse explicit dependencies like "Step 2 depends on Step 1"
    const depLines = depsMatch[1].split('\n');
    for (const line of depLines) {
      const depMatch = line.match(/step\s*(\d+)\s*(?:depends on|requires|needs)\s*step\s*(\d+)/i);
      if (depMatch) {
        const dependent = parseInt(depMatch[1], 10);
        const dependsOn = parseInt(depMatch[2], 10);

        const dependentStep = plan.steps.find(s => s.number === dependent);
        const dependsOnStep = plan.steps.find(s => s.number === dependsOn);

        if (dependentStep && dependsOnStep) {
          this.dependencyTracker.addDependency(dependentStep.id, dependsOnStep.id);
        }
      }
    }

    // Store dependencies in plan
    plan.dependencies = this.dependencyTracker.toJSON();
  }

  /**
   * Create a sub-plan for a blocked step
   */
  async createSubPlan(blockedStep, reason, depth) {
    // Build context-aware prompt
    const prompt = this.buildSubPlanPrompt(blockedStep, reason, depth);

    const result = await this.client.sendPrompt(prompt, {
      newSession: true,
      timeout: 5 * 60 * 1000,
      model: this.model,
    });

    const subPlan = this.parsePlanResponse(
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
    subPlan.qualityAssessment = this.assessPlanQuality(subPlan);

    return subPlan;
  }

  /**
   * Create an adaptive sub-plan that learns from previous attempts
   */
  async createAdaptiveSubPlan(blockedStep, reason, depth, previousAttempts = []) {
    // Build a prompt that incorporates learnings from failed attempts
    const prompt = this.buildAdaptiveSubPlanPrompt(blockedStep, reason, depth, previousAttempts);

    const result = await this.client.sendPrompt(prompt, {
      newSession: true,
      timeout: 5 * 60 * 1000,
      model: this.model,
    });

    const subPlan = this.parsePlanResponse(
      result.response,
      `Adaptive approach for: ${blockedStep.description}`
    );

    subPlan.depth = depth;
    subPlan.parentStepId = blockedStep.id;
    subPlan.blockReason = reason;
    subPlan.isAdaptive = true;
    subPlan.previousAttemptCount = previousAttempts.length;

    return subPlan;
  }

  /**
   * Build adaptive sub-plan prompt with learnings from previous attempts
   */
  buildAdaptiveSubPlanPrompt(blockedStep, reason, depth, previousAttempts) {
    const depthLabel = depth === 1 ? 'SUB-PLAN' :
                       depth === 2 ? 'SUB-SUB-PLAN' :
                       'LEVEL-3 RECOVERY PLAN';

    const previousAttemptsSection = previousAttempts.length > 0
      ? `\n## PREVIOUS ATTEMPTS (DO NOT REPEAT THESE)\n${previousAttempts.map((a, i) =>
          `Attempt ${i + 1}: ${a.approach} - FAILED because: ${a.failureReason}`
        ).join('\n')}`
      : '';

    const successfulApproachesSection = this.executionContext.successfulApproaches.length > 0
      ? `\n## SUCCESSFUL PATTERNS (Consider these)\n${this.executionContext.successfulApproaches.slice(-3).map(a =>
          `- ${a.description}`
        ).join('\n')}`
      : '';

    return `You are an expert software architect. A step has been blocked multiple times and needs a fresh approach.

## BLOCKED STEP
Step: ${blockedStep.description}
Complexity: ${blockedStep.complexity}

## BLOCK REASON
${reason}

## CURRENT DEPTH
Creating: ${depthLabel} (Level ${depth} of max 3)
${previousAttemptsSection}
${successfulApproachesSection}

## YOUR TASK

Create a DIFFERENT approach that avoids the previous failure patterns. Think creatively:
- Can we achieve the same goal through a completely different method?
- Is there a simpler version we can implement first?
- Can we skip this and handle it differently later?
- Is there a workaround that doesn't require what was blocked?

## OUTPUT FORMAT

Respond in EXACTLY this format:

ANALYSIS:
[Why previous approaches failed and what new direction you'll take]

ALTERNATIVE_APPROACH:
[1-2 sentences describing the NEW strategy]

PLAN:
1. [Sub-step description] | [simple/medium/complex]
2. [Sub-step description] | [simple/medium/complex]
...

TOTAL_STEPS: [number]

Keep to 2-${Math.max(2, MAX_SUBPLAN_STEPS - depth)} steps maximum.`;
  }

  /**
   * Build the main planning prompt
   */
  buildPlanningPrompt(goal, context = {}) {
    const contextSection = context.additionalContext
      ? `\n## ADDITIONAL CONTEXT\n${context.additionalContext}`
      : '';

    const workingDir = context.workingDirectory || process.cwd();

    return `You are an expert software architect and planner. Your task is to analyze a goal and create a detailed, executable plan.

## GOAL
${goal}
${contextSection}

## WORKING DIRECTORY
${workingDir}

## PLANNING GUIDELINES

1. **Analyze First**: Before creating steps, briefly analyze:
   - What is the core objective?
   - What are the key components needed?
   - What dependencies exist between components?
   - What could potentially block progress?

2. **Create Actionable Steps**: Each step must be:
   - Concrete and specific (not vague like "implement feature")
   - Independently completable
   - Testable/verifiable
   - In logical dependency order

3. **Estimate Complexity**: Rate each step:
   - **simple**: Single file change, straightforward logic (< 30 min)
   - **medium**: Multiple files, moderate logic (30 min - 2 hours)
   - **complex**: Architectural changes, complex logic (2+ hours)

4. **Consider Testing**: Include testing steps where appropriate

5. **Step Count**: Create ${MIN_PLAN_STEPS}-${MAX_PLAN_STEPS} steps. Combine trivial steps, split complex ones.

## OUTPUT FORMAT

Respond in EXACTLY this format:

ANALYSIS:
[2-4 sentences analyzing the goal, key challenges, and approach]

PLAN:
1. [Step description] | [simple/medium/complex]
2. [Step description] | [simple/medium/complex]
3. [Step description] | [simple/medium/complex]
...

DEPENDENCIES:
[List any external dependencies or prerequisites, or "None"]

RISKS:
[List potential blockers or risks, or "None identified"]

TOTAL_STEPS: [number]

Begin your analysis and planning now.`;
  }

  /**
   * Build sub-plan prompt for blocked step
   */
  buildSubPlanPrompt(blockedStep, reason, depth) {
    const depthLabel = depth === 1 ? 'SUB-PLAN' :
                       depth === 2 ? 'SUB-SUB-PLAN' :
                       'LEVEL-3 RECOVERY PLAN';

    const depthWarning = depth >= 2
      ? '\n⚠️ WARNING: This is a deep re-planning level. Keep the plan minimal and focused.'
      : '';

    return `You are an expert software architect. A step in the execution plan has been blocked and needs an alternative approach.

## BLOCKED STEP
Step: ${blockedStep.description}
Complexity: ${blockedStep.complexity}

## BLOCK REASON
${reason}

## CURRENT DEPTH
Creating: ${depthLabel} (Level ${depth} of max 3)
${depthWarning}

## YOUR TASK

Create an alternative approach to accomplish what the blocked step was trying to do. This ${depthLabel.toLowerCase()} should:

1. **Work around the blocker**: Address the specific reason for the block
2. **Be more granular**: Break into smaller, more achievable sub-steps
3. **Have fallbacks**: Consider what could go wrong and how to handle it
4. **Stay focused**: Only address the blocked step's objective

Think about:
- What alternative methods could achieve the same outcome?
- Is there a simpler approach we missed?
- Can we use different tools or libraries?
- Should we create a minimal implementation first?

## OUTPUT FORMAT

Respond in EXACTLY this format:

ANALYSIS:
[Brief analysis of why the step was blocked and your alternative approach]

ALTERNATIVE_APPROACH:
[1-2 sentences describing the new strategy]

PLAN:
1. [Sub-step description] | [simple/medium/complex]
2. [Sub-step description] | [simple/medium/complex]
...

TOTAL_STEPS: [number]

Keep to 2-${MAX_SUBPLAN_STEPS} steps maximum. Be specific and actionable.`;
  }

  /**
   * Parse Claude's plan response into ExecutionPlan
   */
  parsePlanResponse(response, goal) {
    const plan = new ExecutionPlan(goal);

    const lines = response.split('\n');
    let inPlanSection = false;
    let inAnalysisSection = false;
    let analysisLines = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Extract analysis
      if (trimmed.startsWith('ANALYSIS:')) {
        inAnalysisSection = true;
        const inlineAnalysis = trimmed.substring('ANALYSIS:'.length).trim();
        if (inlineAnalysis) {
          analysisLines.push(inlineAnalysis);
        }
        continue;
      }

      // End analysis section
      if (inAnalysisSection && (trimmed.startsWith('PLAN:') || trimmed.startsWith('ALTERNATIVE_APPROACH:'))) {
        inAnalysisSection = false;
        plan.analysis = analysisLines.join(' ').trim();
      }

      // Collect analysis lines
      if (inAnalysisSection && trimmed && !trimmed.startsWith('##')) {
        analysisLines.push(trimmed);
        continue;
      }

      // Detect plan section
      if (trimmed === 'PLAN:' || trimmed.startsWith('PLAN:')) {
        inPlanSection = true;
        continue;
      }

      // Extract total steps (ends plan section)
      if (trimmed.startsWith('TOTAL_STEPS:')) {
        inPlanSection = false;
        continue;
      }

      // End plan section on other headers
      if (trimmed.startsWith('DEPENDENCIES:') || trimmed.startsWith('RISKS:')) {
        inPlanSection = false;
        continue;
      }

      // Parse plan steps
      if (inPlanSection) {
        const step = this.parseStepLine(trimmed, plan.steps.length + 1);
        if (step) {
          plan.steps.push(step);
        }
      }
    }

    // Fallback: try to extract numbered items if no steps found
    if (plan.steps.length === 0) {
      const numberedItems = response.match(/^\d+\.\s*.+$/gm);
      if (numberedItems) {
        for (const item of numberedItems) {
          const step = this.parseStepLine(item, plan.steps.length + 1);
          if (step) {
            plan.steps.push(step);
          }
        }
      }
    }

    // Validate and adjust
    this.validatePlan(plan);

    return plan;
  }

  /**
   * Parse a single step line
   */
  parseStepLine(line, defaultNumber) {
    if (!line || line.startsWith('#') || line.startsWith('-') && !line.match(/^\d/)) {
      return null;
    }

    // Try to match: "1. Description | complexity"
    const stepMatch = line.match(/^(\d+)\.\s*(.+?)(?:\s*\|\s*(simple|medium|complex))?$/i);

    if (stepMatch) {
      const number = parseInt(stepMatch[1], 10);
      let description = stepMatch[2].trim();
      const complexity = (stepMatch[3] || 'medium').toLowerCase();

      // Clean up description
      description = description.replace(/\|.*$/, '').trim();

      if (description.length > 5) { // Minimum meaningful description
        return new PlanStep(number, description, complexity);
      }
    }

    // Try simpler format: "1. Description"
    const simpleMatch = line.match(/^(\d+)\.\s*(.+)$/);
    if (simpleMatch) {
      const number = parseInt(simpleMatch[1], 10);
      let description = simpleMatch[2].trim();
      description = description.replace(/\|.*$/, '').trim();

      if (description.length > 5) {
        return new PlanStep(number, description, 'medium');
      }
    }

    return null;
  }

  /**
   * Validate and adjust a plan
   */
  validatePlan(plan) {
    // Ensure at least minimum steps
    if (plan.steps.length < MIN_PLAN_STEPS) {
      // If we have at least one step, it's still valid
      if (plan.steps.length === 0) {
        plan.steps.push(new PlanStep(1, 'Execute the goal directly', 'complex'));
      }
    }

    // Limit maximum steps
    if (plan.steps.length > MAX_PLAN_STEPS) {
      plan.steps = plan.steps.slice(0, MAX_PLAN_STEPS);
    }

    // Re-number steps sequentially
    plan.steps.forEach((step, index) => {
      step.number = index + 1;
    });

    // Ensure analysis exists
    if (!plan.analysis) {
      plan.analysis = `Plan to achieve: ${plan.goal}`;
    }
  }

  /**
   * Add plan to history
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
      model: this.model,
      plansCreated: this.planHistory.length,
      subPlanAttempts: Object.fromEntries(this.subPlanAttempts),
      executionContext: {
        completedSteps: this.executionContext.completedSteps.length,
        failedSteps: this.executionContext.failedSteps.length,
        blockedReasons: this.executionContext.blockedReasons.length,
      },
      recentPlans: this.planHistory.slice(-5).map(p => ({
        goal: p.goal.substring(0, 50),
        depth: p.depth,
        steps: p.stepCount,
      })),
    };
  }

  /**
   * Get dependency tracker for external use
   */
  getDependencyTracker() {
    return this.dependencyTracker;
  }

  /**
   * Check if a step can be executed based on dependencies
   */
  canExecuteStep(stepId, completedStepIds) {
    return this.dependencyTracker.canExecute(stepId, new Set(completedStepIds));
  }

  /**
   * Get optimal execution order for plan steps
   */
  getExecutionOrder(plan) {
    return this.dependencyTracker.getExecutionOrder(plan.steps);
  }

  /**
   * Record a successful approach for future reference
   */
  recordSuccessfulApproach(description, stepId) {
    this.executionContext.successfulApproaches.push({
      description,
      stepId,
      timestamp: Date.now(),
    });

    // Limit stored approaches
    if (this.executionContext.successfulApproaches.length > 20) {
      this.executionContext.successfulApproaches =
        this.executionContext.successfulApproaches.slice(-20);
    }
  }

  /**
   * Reset execution context for new goal
   */
  resetExecutionContext() {
    this.executionContext = {
      completedSteps: [],
      failedSteps: [],
      blockedReasons: [],
      successfulApproaches: [],
    };
    this.subPlanAttempts.clear();
    this.dependencyTracker = new DependencyTracker();
  }

  /**
   * Format plan for display
   */
  formatPlan(plan) {
    const depthLabel = plan.depth === 0 ? 'MAIN PLAN' :
                       plan.depth === 1 ? 'SUB-PLAN' :
                       plan.depth === 2 ? 'SUB-SUB-PLAN' :
                       'LEVEL-3 PLAN';

    const header = `═══ ${depthLabel} ═══`;
    const goal = `Goal: ${plan.goal}`;
    const analysis = `Analysis: ${plan.analysis}`;

    const steps = plan.steps.map(s => {
      const statusIcon = s.status === 'completed' ? '✓' :
                        s.status === 'failed' ? '✗' :
                        s.status === 'in_progress' ? '→' : ' ';
      return `  ${statusIcon} ${s.number}. ${s.description} [${s.complexity}]`;
    }).join('\n');

    return `${header}\n${goal}\n${analysis}\n\nSteps:\n${steps}`;
  }
}

export { PlanQualityAssessment, DependencyTracker };
export default PlannerAgent;
