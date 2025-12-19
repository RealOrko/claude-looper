/**
 * Sub-Plan Manager - Handles sub-plan creation and execution for blocked steps
 */

export class SubPlanManager {
  constructor() {
    this.subPlan = null;
    this.subPlanStep = 0;
    this.subPlanParentStep = null;
    this.subPlanAttempted = false;
  }

  /** Check if we're currently executing a sub-plan */
  isInSubPlan() {
    return this.subPlan !== null;
  }

  /** Check if a sub-plan was already attempted for current step */
  canAttemptSubPlan() {
    return !this.subPlanAttempted;
  }

  /** Set the sub-plan */
  setSubPlan(plan, parentStep) {
    this.subPlan = plan;
    this.subPlanStep = 0;
    this.subPlanParentStep = parentStep;
    this.subPlanAttempted = true;
  }

  /** Mark sub-plan as attempted (even if creation failed) */
  markAttempted() {
    this.subPlanAttempted = true;
  }

  /** Get current sub-plan step */
  getCurrentSubStep() {
    if (!this.subPlan || this.subPlanStep >= this.subPlan.steps.length) {
      return null;
    }
    const step = this.subPlan.steps[this.subPlanStep];
    return { ...step, isSubStep: true, parentStep: this.subPlanParentStep };
  }

  /** Check if sub-plan is complete */
  isSubPlanComplete() {
    return this.subPlan && this.subPlanStep >= this.subPlan.steps.length;
  }

  /** Advance to next sub-plan step */
  advanceSubStep() {
    if (this.subPlan && this.subPlanStep < this.subPlan.steps.length) {
      this.subPlan.steps[this.subPlanStep].status = 'completed';
      this.subPlanStep++;
    }
  }

  /** Fail current sub-plan step */
  failCurrentSubStep(reason) {
    if (this.subPlan && this.subPlanStep < this.subPlan.steps.length) {
      this.subPlan.steps[this.subPlanStep].status = 'failed';
      this.subPlan.steps[this.subPlanStep].failReason = reason;
    }
  }

  /** Get sub-plan progress info */
  getSubPlanProgress() {
    if (!this.subPlan) return null;
    return {
      current: this.subPlanStep + 1,
      total: this.subPlan.totalSteps,
      parentStep: this.subPlanParentStep?.number,
    };
  }

  /** Clear sub-plan state */
  clearSubPlan() {
    this.subPlan = null;
    this.subPlanStep = 0;
    this.subPlanParentStep = null;
    // Note: subPlanAttempted is NOT cleared here - it resets on main step advance
  }

  /** Reset sub-plan attempted flag (called when advancing main step) */
  resetAttemptedFlag() {
    this.subPlanAttempted = false;
  }

  /** Get the parent step that triggered the sub-plan */
  getParentStep() {
    return this.subPlanParentStep;
  }

  /** Get the current sub-plan */
  getSubPlan() {
    return this.subPlan;
  }

  /** Get execution prompt for sub-plan step */
  getSubPlanExecutionPrompt() {
    const step = this.getCurrentSubStep();
    if (!step) return null;

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
}

export default SubPlanManager;
