/**
 * Planner - Has Claude analyze a goal and create an execution plan
 * Minimizes human input by letting Claude figure out the steps
 */

export class Planner {
  constructor(client) {
    this.client = client;
    this.plan = null;
    this.currentStep = 0;

    // Sub-plan state (for handling blocked steps)
    this.subPlan = null;
    this.subPlanStep = 0;
    this.subPlanParentStep = null; // The original step that was blocked
    this.subPlanAttempted = false; // Track if we already tried a sub-plan for current step
  }

  /**
   * Build the planning prompt
   */
  buildPlanningPrompt(goal, context, workingDirectory) {
    return `You are a planning assistant. Analyze this goal and create a concrete execution plan.

## GOAL
${goal}

${context ? `## ADDITIONAL CONTEXT\n${context}` : ''}

## WORKING DIRECTORY
${workingDirectory}

## YOUR TASK

Create a step-by-step plan to achieve this goal. Each step should be:
- Concrete and actionable (not vague)
- Independently completable
- In logical order
- Estimated complexity (simple/medium/complex)

First, briefly analyze what needs to be done (2-3 sentences).
Then output your plan in EXACTLY this format:

ANALYSIS: [Your brief analysis]

PLAN:
1. [Step description] | [simple/medium/complex]
2. [Step description] | [simple/medium/complex]
3. [Step description] | [simple/medium/complex]
...

TOTAL_STEPS: [number]

Keep the plan to 3-10 steps. Combine trivial steps, split complex ones.`;
  }

  /**
   * Generate a plan for the goal
   */
  async createPlan(goal, context = '', workingDirectory = process.cwd()) {
    const prompt = this.buildPlanningPrompt(goal, context, workingDirectory);

    const result = await this.client.sendPrompt(prompt, {
      newSession: true,
      timeout: 5 * 60 * 1000, // 5 minutes
    });

    this.plan = this.parsePlan(result.response, goal);
    return this.plan;
  }

  /**
   * Parse Claude's plan response
   */
  parsePlan(response, originalGoal) {
    const plan = {
      goal: originalGoal,
      analysis: '',
      steps: [],
      totalSteps: 0,
      raw: response,
    };

    const lines = response.split('\n');
    let inPlanSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Extract analysis
      if (trimmed.startsWith('ANALYSIS:')) {
        plan.analysis = trimmed.substring('ANALYSIS:'.length).trim();
        continue;
      }

      // Detect plan section
      if (trimmed === 'PLAN:') {
        inPlanSection = true;
        continue;
      }

      // Extract total steps
      if (trimmed.startsWith('TOTAL_STEPS:')) {
        const match = trimmed.match(/(\d+)/);
        if (match) {
          plan.totalSteps = parseInt(match[1], 10);
        }
        inPlanSection = false;
        continue;
      }

      // Parse plan steps
      if (inPlanSection) {
        const stepMatch = trimmed.match(/^(\d+)\.\s*(.+?)(?:\s*\|\s*(simple|medium|complex))?$/i);
        if (stepMatch) {
          plan.steps.push({
            number: parseInt(stepMatch[1], 10),
            description: stepMatch[2].trim(),
            complexity: (stepMatch[3] || 'medium').toLowerCase(),
            status: 'pending',
          });
        }
      }
    }

    // Fallback if parsing failed - try to extract numbered items
    if (plan.steps.length === 0) {
      const numberedItems = response.match(/^\d+\.\s*.+$/gm);
      if (numberedItems) {
        plan.steps = numberedItems.map((item, i) => ({
          number: i + 1,
          description: item.replace(/^\d+\.\s*/, '').replace(/\|.*$/, '').trim(),
          complexity: 'medium',
          status: 'pending',
        }));
      }
    }

    plan.totalSteps = plan.steps.length;
    return plan;
  }

  /**
   * Get plan summary for display
   */
  getSummary() {
    if (!this.plan) return 'No plan created';

    const stepList = this.plan.steps
      .map(s => {
        const status = s.status === 'completed' ? '✓' :
                       s.status === 'failed' ? '✗' :
                       s.number === this.currentStep + 1 ? '→' : ' ';
        return `${status} ${s.number}. ${s.description} [${s.complexity}]`;
      })
      .join('\n');

    return `Goal: ${this.plan.goal}

Analysis: ${this.plan.analysis}

Plan (${this.plan.totalSteps} steps):
${stepList}`;
  }

  /**
   * Check if we're currently executing a sub-plan
   */
  isInSubPlan() {
    return this.subPlan !== null;
  }

  /**
   * Check if a sub-plan was already attempted for current step
   */
  canAttemptSubPlan() {
    return !this.subPlanAttempted;
  }

  /**
   * Create a sub-plan to work around a blocked step
   */
  async createSubPlan(blockedStep, blockReason, workingDirectory) {
    const prompt = `You are a planning assistant. A step has been blocked and needs an alternative approach.

## ORIGINAL GOAL
${this.plan.goal}

## BLOCKED STEP
Step ${blockedStep.number}: ${blockedStep.description}

## BLOCK REASON
${blockReason}

## WORKING DIRECTORY
${workingDirectory}

## YOUR TASK

Create an alternative approach to accomplish what the blocked step was trying to do.
Break it down into 2-5 smaller, more specific steps that work around the blocker.

Think about:
- What alternative methods could achieve the same outcome?
- Can we break this into smaller pieces that are less likely to fail?
- Is there a prerequisite we missed?

Output your plan in EXACTLY this format:

ANALYSIS: [Brief analysis of the problem and your approach]

PLAN:
1. [Step description] | [simple/medium/complex]
2. [Step description] | [simple/medium/complex]
...

TOTAL_STEPS: [number]

Keep to 2-5 steps. Be specific and actionable.`;

    try {
      const result = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 5 * 60 * 1000,
      });

      this.subPlan = this.parsePlan(result.response, `Retry: ${blockedStep.description}`);
      this.subPlanStep = 0;
      this.subPlanParentStep = blockedStep;
      this.subPlanAttempted = true;

      return this.subPlan;
    } catch (error) {
      console.error('[Planner] Failed to create sub-plan:', error.message);
      this.subPlanAttempted = true;
      return null;
    }
  }

  /**
   * Get current step (sub-plan aware)
   */
  getCurrentStep() {
    // If in sub-plan, return sub-plan step
    if (this.subPlan) {
      if (this.subPlanStep >= this.subPlan.steps.length) {
        return null;
      }
      const step = this.subPlan.steps[this.subPlanStep];
      // Mark as sub-step for UI
      return { ...step, isSubStep: true, parentStep: this.subPlanParentStep };
    }

    // Otherwise return main plan step
    if (!this.plan || this.currentStep >= this.plan.steps.length) {
      return null;
    }
    return this.plan.steps[this.currentStep];
  }

  /**
   * Advance step (sub-plan aware)
   */
  advanceStep() {
    if (this.subPlan) {
      // Advance sub-plan
      if (this.subPlanStep < this.subPlan.steps.length) {
        this.subPlan.steps[this.subPlanStep].status = 'completed';
        this.subPlanStep++;
      }

      // Check if sub-plan is complete
      if (this.subPlanStep >= this.subPlan.steps.length) {
        // Sub-plan completed - mark parent step as completed
        if (this.subPlanParentStep && this.currentStep < this.plan.steps.length) {
          this.plan.steps[this.currentStep].status = 'completed';
          this.plan.steps[this.currentStep].completedViaSubPlan = true;
          this.currentStep++;
        }
        // Clear sub-plan state
        this.clearSubPlan();
      }

      return this.getCurrentStep();
    }

    // Normal step advance
    if (this.plan && this.currentStep < this.plan.steps.length) {
      this.plan.steps[this.currentStep].status = 'completed';
      this.currentStep++;
      this.subPlanAttempted = false; // Reset for next step
    }
    return this.getCurrentStep();
  }

  /**
   * Fail current step (sub-plan aware)
   */
  failCurrentStep(reason) {
    if (this.subPlan) {
      // Fail sub-plan step
      if (this.subPlanStep < this.subPlan.steps.length) {
        this.subPlan.steps[this.subPlanStep].status = 'failed';
        this.subPlan.steps[this.subPlanStep].failReason = reason;
      }
      return;
    }

    // Fail main plan step
    if (this.plan && this.currentStep < this.plan.steps.length) {
      this.plan.steps[this.currentStep].status = 'failed';
      this.plan.steps[this.currentStep].failReason = reason;
    }
  }

  /**
   * Abort sub-plan and mark parent step as failed
   */
  abortSubPlan(reason) {
    if (!this.subPlan) return;

    // Mark parent step as failed
    if (this.subPlanParentStep && this.currentStep < this.plan.steps.length) {
      this.plan.steps[this.currentStep].status = 'failed';
      this.plan.steps[this.currentStep].failReason = `Sub-plan failed: ${reason}`;
      this.currentStep++;
    }

    this.clearSubPlan();
  }

  /**
   * Clear sub-plan state
   */
  clearSubPlan() {
    this.subPlan = null;
    this.subPlanStep = 0;
    this.subPlanParentStep = null;
    // Note: subPlanAttempted is NOT cleared here - it resets on main step advance
  }

  /**
   * Get progress info (sub-plan aware)
   */
  getProgress() {
    if (!this.plan) return null;

    const completed = this.plan.steps.filter(s => s.status === 'completed').length;
    const failed = this.plan.steps.filter(s => s.status === 'failed').length;

    const progress = {
      current: this.currentStep + 1,
      total: this.plan.totalSteps,
      completed,
      failed,
      pending: this.plan.totalSteps - completed - failed,
      percentComplete: Math.round((completed / this.plan.totalSteps) * 100),
      inSubPlan: this.isInSubPlan(),
    };

    if (this.subPlan) {
      progress.subPlan = {
        current: this.subPlanStep + 1,
        total: this.subPlan.totalSteps,
        parentStep: this.subPlanParentStep?.number,
      };
    }

    return progress;
  }

  /**
   * Check if complete (sub-plan aware)
   */
  isComplete() {
    if (this.subPlan) return false; // Still in sub-plan
    return this.plan && this.currentStep >= this.plan.steps.length;
  }

  /**
   * Get execution prompt (sub-plan aware)
   */
  getExecutionPrompt() {
    const step = this.getCurrentStep();
    if (!step) return null;

    const progress = this.getProgress();

    if (step.isSubStep) {
      // Sub-plan execution prompt
      const subCompleted = this.subPlan.steps
        .filter(s => s.status === 'completed')
        .map(s => `✓ ${s.description}`)
        .join('\n');

      return `## EXECUTING SUB-STEP ${this.subPlanStep + 1} OF ${this.subPlan.totalSteps}

**Original Step:** ${this.subPlanParentStep.description}
**Why we're retrying:** This step was blocked and we're trying an alternative approach.

**Current Sub-Step:** ${step.description}
**Complexity:** ${step.complexity}

${subCompleted ? `**Completed Sub-Steps:**\n${subCompleted}\n` : ''}

## INSTRUCTIONS

Execute this sub-step completely. When done:
1. Confirm what you accomplished
2. Say "STEP COMPLETE" when finished
3. If blocked, say "STEP BLOCKED: [reason]"

Focus ONLY on this sub-step.

Begin.`;
    }

    // Normal step prompt
    const completedSteps = this.plan.steps
      .filter(s => s.status === 'completed')
      .map(s => `✓ ${s.description}`)
      .join('\n');

    return `## EXECUTING STEP ${step.number} OF ${this.plan.totalSteps}

**Overall Goal:** ${this.plan.goal}

**Current Step:** ${step.description}
**Complexity:** ${step.complexity}

${completedSteps ? `**Completed Steps:**\n${completedSteps}\n` : ''}
**Remaining:** ${progress.pending} steps after this one

## INSTRUCTIONS

Execute this step completely. When done:
1. Confirm what you accomplished
2. Say "STEP COMPLETE" when finished
3. If blocked, say "STEP BLOCKED: [reason]"

Focus ONLY on this step. Do not move ahead to other steps.

Begin.`;
  }
}

export default Planner;
