/**
 * Planner - Has Claude analyze a goal and create an execution plan
 * Minimizes human input by letting Claude figure out the steps
 */

export class Planner {
  constructor(client) {
    this.client = client;
    this.plan = null;
    this.currentStep = 0;
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
   * Get current step to execute
   */
  getCurrentStep() {
    if (!this.plan || this.currentStep >= this.plan.steps.length) {
      return null;
    }
    return this.plan.steps[this.currentStep];
  }

  /**
   * Mark current step complete and move to next
   */
  advanceStep() {
    if (this.plan && this.currentStep < this.plan.steps.length) {
      this.plan.steps[this.currentStep].status = 'completed';
      this.currentStep++;
    }
    return this.getCurrentStep();
  }

  /**
   * Mark current step as failed
   */
  failCurrentStep(reason) {
    if (this.plan && this.currentStep < this.plan.steps.length) {
      this.plan.steps[this.currentStep].status = 'failed';
      this.plan.steps[this.currentStep].failReason = reason;
    }
  }

  /**
   * Check if plan is complete
   */
  isComplete() {
    return this.plan && this.currentStep >= this.plan.steps.length;
  }

  /**
   * Get progress info
   */
  getProgress() {
    if (!this.plan) return null;

    const completed = this.plan.steps.filter(s => s.status === 'completed').length;
    const failed = this.plan.steps.filter(s => s.status === 'failed').length;

    return {
      current: this.currentStep + 1,
      total: this.plan.totalSteps,
      completed,
      failed,
      pending: this.plan.totalSteps - completed - failed,
      percentComplete: Math.round((completed / this.plan.totalSteps) * 100),
    };
  }

  /**
   * Generate execution prompt for current step
   */
  getExecutionPrompt() {
    const step = this.getCurrentStep();
    if (!step) return null;

    const progress = this.getProgress();
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
}

export default Planner;
