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

/**
 * Planner Agent
 */
export class PlannerAgent extends BaseAgent {
  constructor(client, config = {}) {
    super(AgentRole.PLANNER, client, config);

    this.model = config.model || 'opus';
    this.planHistory = [];
    this.maxPlanHistory = 20;

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
    const { blockedStep, reason, depth } = message.payload;

    this.status = AgentStatus.WORKING;

    try {
      // Check depth limit
      if (depth >= PlanDepth.LEVEL_3) {
        return message.createResponse(MessageType.PLAN_RESPONSE, {
          success: false,
          error: 'Maximum re-planning depth reached (3 levels)',
        });
      }

      const subPlan = await this.createSubPlan(blockedStep, reason, depth + 1);

      // Store in history
      this.addToHistory(subPlan);

      return message.createResponse(MessageType.SUBPLAN_RESPONSE, {
        success: true,
        plan: subPlan,
        depth: depth + 1,
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
    const prompt = this.buildPlanningPrompt(goal, context);

    const result = await this.client.sendPrompt(prompt, {
      newSession: true,
      timeout: 5 * 60 * 1000, // 5 minutes
      model: this.model,
    });

    const plan = this.parsePlanResponse(result.response, goal);
    plan.depth = PlanDepth.ROOT;

    return plan;
  }

  /**
   * Create a sub-plan for a blocked step
   */
  async createSubPlan(blockedStep, reason, depth) {
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

    // Limit sub-plan steps
    if (subPlan.steps.length > MAX_SUBPLAN_STEPS) {
      subPlan.steps = subPlan.steps.slice(0, MAX_SUBPLAN_STEPS);
    }

    return subPlan;
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
      recentPlans: this.planHistory.slice(-5).map(p => ({
        goal: p.goal.substring(0, 50),
        depth: p.depth,
        steps: p.stepCount,
      })),
    };
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

export default PlannerAgent;
