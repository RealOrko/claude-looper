/**
 * Planner - Has Claude analyze a goal and create an execution plan
 * Minimizes human input by letting Claude figure out the steps
 *
 * Enhanced with:
 * - Step dependency analysis for parallel execution
 * - Smart batching of independent steps
 * - Critical path identification
 */

import { StepDependencyAnalyzer } from './step-dependency-analyzer.js';

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

    // Dependency analyzer for parallel execution
    this.dependencyAnalyzer = new StepDependencyAnalyzer();

    // Parallel execution state
    this.parallelMode = false;
    this.inProgressSteps = new Set(); // Steps currently being executed
    this.completedStepNumbers = [];
  }

  /**
   * Build the planning prompt
   * Optimized for speed and clarity
   */
  buildPlanningPrompt(goal, context, workingDirectory) {
    // Use concise prompt for faster planning
    const contextSection = context ? `Context: ${context}\n` : '';

    return `PLAN THIS GOAL: ${goal}
${contextSection}Working dir: ${workingDirectory}

Rules:
- 3-10 concrete, actionable steps
- Each step independently completable
- Mark complexity: simple/medium/complex

Output EXACTLY:
ANALYSIS: [1-2 sentence analysis]
PLAN:
1. [Step] | [complexity]
2. [Step] | [complexity]
...
TOTAL_STEPS: [N]`;
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
   * Restore a plan from saved state (for session resumption)
   */
  restorePlan(savedPlan, currentStep = 0) {
    this.plan = savedPlan;
    this.currentStep = currentStep;

    // Restore step statuses
    if (this.plan?.steps) {
      for (let i = 0; i < currentStep && i < this.plan.steps.length; i++) {
        if (!this.plan.steps[i].status) {
          this.plan.steps[i].status = 'completed';
        }
      }
    }

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

    // Analyze dependencies and add parallel execution metadata
    if (plan.steps.length > 0) {
      plan.steps = this.dependencyAnalyzer.analyzeDependencies(plan.steps);
      plan.executionStats = this.dependencyAnalyzer.getExecutionStats(plan.steps);
    }

    return plan;
  }

  /**
   * Enable parallel execution mode
   */
  enableParallelMode() {
    this.parallelMode = true;
  }

  /**
   * Disable parallel execution mode
   */
  disableParallelMode() {
    this.parallelMode = false;
  }

  /**
   * Get the next batch of steps that can be executed
   * Returns array of steps (multiple if parallel execution enabled)
   */
  getNextExecutableBatch() {
    if (!this.plan) return [];

    // If in sub-plan, handle that first (no parallelization for sub-plans)
    if (this.subPlan) {
      const step = this.getCurrentStep();
      return step ? [step] : [];
    }

    // Get completed step numbers
    const completed = this.plan.steps
      .filter(s => s.status === 'completed')
      .map(s => s.number);

    // If parallel mode disabled, return just the current step
    if (!this.parallelMode) {
      const step = this.getCurrentStep();
      return step ? [step] : [];
    }

    // Get next batch of parallelizable steps
    return this.dependencyAnalyzer.getNextParallelBatch(
      this.plan.steps,
      completed
    );
  }

  /**
   * Mark a step as in-progress (for parallel execution tracking)
   */
  markStepInProgress(stepNumber) {
    this.inProgressSteps.add(stepNumber);
    const step = this.plan?.steps.find(s => s.number === stepNumber);
    if (step) {
      step.status = 'in_progress';
      step.startTime = Date.now();
    }
  }

  /**
   * Complete a step by number (for parallel execution)
   */
  completeStepByNumber(stepNumber) {
    this.inProgressSteps.delete(stepNumber);
    const step = this.plan?.steps.find(s => s.number === stepNumber);
    if (step) {
      step.status = 'completed';
      step.endTime = Date.now();
      step.duration = step.endTime - (step.startTime || step.endTime);
      this.completedStepNumbers.push(stepNumber);
    }

    // Update currentStep to point to next incomplete step
    this.updateCurrentStepPointer();
  }

  /**
   * Fail a step by number (for parallel execution)
   */
  failStepByNumber(stepNumber, reason) {
    this.inProgressSteps.delete(stepNumber);
    const step = this.plan?.steps.find(s => s.number === stepNumber);
    if (step) {
      step.status = 'failed';
      step.failReason = reason;
      step.endTime = Date.now();
    }

    this.updateCurrentStepPointer();
  }

  /**
   * Update the current step pointer to next incomplete step
   */
  updateCurrentStepPointer() {
    if (!this.plan) return;

    for (let i = 0; i < this.plan.steps.length; i++) {
      const step = this.plan.steps[i];
      if (step.status === 'pending' || step.status === 'in_progress') {
        this.currentStep = i;
        return;
      }
    }

    // All steps complete
    this.currentStep = this.plan.steps.length;
  }

  /**
   * Get number of steps currently in progress
   */
  getInProgressCount() {
    return this.inProgressSteps.size;
  }

  /**
   * Check if any steps are currently in progress
   */
  hasInProgressSteps() {
    return this.inProgressSteps.size > 0;
  }

  /**
   * Get execution statistics
   */
  getExecutionStats() {
    return this.plan?.executionStats || null;
  }

  /**
   * Automatically decompose complex steps into smaller subtasks
   * Called when a step is too complex or taking too long
   */
  async decomposeComplexStep(step, workingDirectory) {
    const prompt = `You are a planning assistant. Break down this complex step into smaller, more manageable subtasks.

## ORIGINAL GOAL
${this.plan.goal}

## STEP TO DECOMPOSE
Step ${step.number}: ${step.description}
Complexity: ${step.complexity}

## WORKING DIRECTORY
${workingDirectory}

## YOUR TASK

This step is complex and should be broken into smaller pieces. Create 2-4 subtasks that:
1. Are independently completable
2. Can potentially run in parallel if they don't depend on each other
3. Together fully accomplish the original step

Output in EXACTLY this format:

ANALYSIS: [Why this needs decomposition and your approach]

SUBTASKS:
1. [Subtask description] | [simple/medium]
2. [Subtask description] | [simple/medium]
...

PARALLEL_SAFE: [YES/NO] - Can these subtasks run in parallel?`;

    try {
      const result = await this.client.sendPrompt(prompt, {
        newSession: true,
        timeout: 3 * 60 * 1000,
      });

      return this.parseDecomposition(result.response, step);
    } catch (error) {
      console.error('[Planner] Step decomposition failed:', error.message);
      return null;
    }
  }

  /**
   * Parse decomposition response into subtasks
   */
  parseDecomposition(response, parentStep) {
    const subtasks = [];
    const lines = response.split('\n');
    let inSubtasksSection = false;
    let parallelSafe = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('SUBTASKS:')) {
        inSubtasksSection = true;
        continue;
      }

      if (trimmed.startsWith('PARALLEL_SAFE:')) {
        parallelSafe = trimmed.toUpperCase().includes('YES');
        inSubtasksSection = false;
        continue;
      }

      if (inSubtasksSection) {
        const match = trimmed.match(/^(\d+)\.\s*(.+?)(?:\s*\|\s*(simple|medium))?$/i);
        if (match) {
          subtasks.push({
            number: parentStep.number + (parseInt(match[1], 10) / 10), // e.g., 3.1, 3.2
            description: match[2].trim(),
            complexity: (match[3] || 'simple').toLowerCase(),
            status: 'pending',
            isSubtask: true,
            parentStepNumber: parentStep.number,
          });
        }
      }
    }

    if (subtasks.length === 0) return null;

    return {
      parentStep,
      subtasks,
      parallelSafe,
      raw: response,
    };
  }

  /**
   * Inject decomposed subtasks into the plan
   */
  injectSubtasks(decomposition) {
    if (!decomposition || !this.plan) return false;

    const { parentStep, subtasks, parallelSafe } = decomposition;

    // Find the parent step index
    const parentIndex = this.plan.steps.findIndex(s => s.number === parentStep.number);
    if (parentIndex === -1) return false;

    // Mark parent as decomposed
    this.plan.steps[parentIndex].status = 'decomposed';
    this.plan.steps[parentIndex].decomposedInto = subtasks.map(s => s.number);

    // Insert subtasks after parent
    this.plan.steps.splice(parentIndex + 1, 0, ...subtasks);

    // Update total steps
    this.plan.totalSteps = this.plan.steps.length;

    // Re-analyze dependencies if parallel safe
    if (parallelSafe) {
      this.plan.steps = this.dependencyAnalyzer.analyzeDependencies(this.plan.steps);
      this.plan.executionStats = this.dependencyAnalyzer.getExecutionStats(this.plan.steps);
    }

    return true;
  }

  /**
   * Check if a step should be decomposed based on complexity and time
   */
  shouldDecomposeStep(step, elapsedMs = 0) {
    // Always decompose 'complex' steps that haven't started
    if (step.complexity === 'complex' && step.status === 'pending') {
      return true;
    }

    // Decompose if step is taking too long (> 10 minutes for medium, > 5 for simple)
    const thresholds = {
      simple: 5 * 60 * 1000,
      medium: 10 * 60 * 1000,
      complex: 15 * 60 * 1000,
    };

    const threshold = thresholds[step.complexity] || thresholds.medium;
    if (elapsedMs > threshold && step.status === 'in_progress') {
      return true;
    }

    return false;
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
   * Skip a step (mark as skipped and advance)
   * Used by error recovery when a step cannot be completed
   */
  skipStep(stepNumber) {
    if (!this.plan) return;

    // Find and mark the step as skipped
    const step = this.plan.steps.find(s => s.number === stepNumber);
    if (step) {
      step.status = 'skipped';
      step.skippedAt = Date.now();
    }

    // If this is the current step, advance
    if (this.currentStep < this.plan.steps.length &&
        this.plan.steps[this.currentStep].number === stepNumber) {
      this.currentStep++;
    }

    return this.getCurrentStep();
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
