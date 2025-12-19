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
import { ComplexityEstimator } from './planner/complexity-estimator.js';
import { PlanParser } from './planner/plan-parser.js';
import { ParallelExecutor } from './planner/parallel-executor.js';
import { SubPlanManager } from './planner/sub-plan-manager.js';

export class Planner {
  constructor(client) {
    this.client = client;
    this.plan = null;
    this.currentStep = 0;

    this.dependencyAnalyzer = new StepDependencyAnalyzer();
    this.complexityEstimator = new ComplexityEstimator();
    this.planParser = new PlanParser(this.complexityEstimator, this.dependencyAnalyzer);
    this.parallelExecutor = new ParallelExecutor(this.dependencyAnalyzer);
    this.subPlanManager = new SubPlanManager();
  }

  // Delegation to complexity estimator
  estimateComplexity(description) { return this.complexityEstimator.estimateComplexity(description); }
  refineComplexity(est, desc) { return this.complexityEstimator.refineComplexity(est, desc); }
  recordStepCompletion(step, dur) { this.complexityEstimator.recordStepCompletion(step, dur); }
  shouldDecomposeStep(step, elapsed) { return this.complexityEstimator.shouldDecomposeStep(step, elapsed); }

  // Delegation to parallel executor
  enableParallelMode() { this.parallelExecutor.enableParallelMode(); }
  disableParallelMode() { this.parallelExecutor.disableParallelMode(); }
  get parallelMode() { return this.parallelExecutor.isParallelModeEnabled(); }
  getInProgressCount() { return this.parallelExecutor.getInProgressCount(); }
  hasInProgressSteps() { return this.parallelExecutor.hasInProgressSteps(); }
  get completedStepNumbers() { return this.parallelExecutor.getCompletedStepNumbers(); }
  get inProgressSteps() { return this.parallelExecutor.inProgressSteps; }

  markStepInProgress(stepNumber) {
    const step = this.plan?.steps.find(s => s.number === stepNumber);
    if (step) this.parallelExecutor.markStepInProgress(step);
  }

  completeStepByNumber(stepNumber) {
    const step = this.plan?.steps.find(s => s.number === stepNumber);
    if (step) this.parallelExecutor.completeStep(step);
    this.updateCurrentStepPointer();
  }

  failStepByNumber(stepNumber, reason) {
    const step = this.plan?.steps.find(s => s.number === stepNumber);
    if (step) this.parallelExecutor.failStep(step, reason);
    this.updateCurrentStepPointer();
  }

  // Delegation to sub-plan manager
  isInSubPlan() { return this.subPlanManager.isInSubPlan(); }
  canAttemptSubPlan() { return this.subPlanManager.canAttemptSubPlan(); }
  clearSubPlan() { this.subPlanManager.clearSubPlan(); }

  /** Generate a plan for the goal */
  async createPlan(goal, context = '', workingDirectory = process.cwd()) {
    const prompt = this.planParser.buildPlanningPrompt(goal, context, workingDirectory);
    const result = await this.client.sendPrompt(prompt, { newSession: true, timeout: 5 * 60 * 1000 });

    this.plan = this.planParser.parsePlan(result.response, goal);
    this.currentStep = 0;
    this.parallelExecutor.reset();
    return this.plan;
  }

  /** Restore a plan from saved state */
  restorePlan(savedPlan, currentStep = 0) {
    this.plan = savedPlan;
    this.currentStep = currentStep;

    if (this.plan?.steps) {
      for (let i = 0; i < currentStep && i < this.plan.steps.length; i++) {
        if (!this.plan.steps[i].status) this.plan.steps[i].status = 'completed';
      }
    }
    this.updateCurrentStepPointer();
    return this.plan;
  }

  /** Update the current step pointer to next incomplete step */
  updateCurrentStepPointer() {
    if (!this.plan) return;
    for (let i = 0; i < this.plan.steps.length; i++) {
      if (this.plan.steps[i].status === 'pending' || this.plan.steps[i].status === 'in_progress') {
        this.currentStep = i;
        return;
      }
    }
    this.currentStep = this.plan.steps.length;
  }

  /** Get the next batch of steps that can be executed */
  getNextExecutableBatch() {
    if (this.subPlanManager.isInSubPlan()) {
      const step = this.getCurrentStep();
      return step ? [step] : [];
    }
    return this.parallelExecutor.getNextExecutableBatch(this.plan, () => this.getCurrentStep());
  }

  getExecutionStats() { return this.plan?.executionStats || null; }

  /** Automatically decompose complex steps into smaller subtasks */
  async decomposeComplexStep(step, workingDirectory) {
    const prompt = this.planParser.buildDecompositionPrompt(this.plan.goal, step, workingDirectory);
    try {
      const result = await this.client.sendPrompt(prompt, { newSession: true, timeout: 3 * 60 * 1000 });
      return this.planParser.parseDecomposition(result.response, step);
    } catch (error) {
      console.error('[Planner] Step decomposition failed:', error.message);
      return null;
    }
  }

  /** Inject decomposed subtasks into the plan */
  injectSubtasks(decomposition) {
    return this.parallelExecutor.injectSubtasks(this.plan, decomposition);
  }

  /** Create a sub-plan to work around a blocked step */
  async createSubPlan(blockedStep, blockReason, workingDirectory) {
    const prompt = this.planParser.buildSubPlanPrompt(this.plan.goal, blockedStep, blockReason, workingDirectory);
    try {
      const result = await this.client.sendPrompt(prompt, { newSession: true, timeout: 5 * 60 * 1000 });
      const subPlan = this.planParser.parsePlan(result.response, `Retry: ${blockedStep.description}`);
      this.subPlanManager.setSubPlan(subPlan, blockedStep);
      return subPlan;
    } catch (error) {
      console.error('[Planner] Failed to create sub-plan:', error.message);
      this.subPlanManager.markAttempted();
      return null;
    }
  }

  /** Get current step (sub-plan aware) */
  getCurrentStep() {
    if (this.subPlanManager.isInSubPlan()) {
      return this.subPlanManager.getCurrentSubStep();
    }
    if (!this.plan || this.currentStep >= this.plan.steps.length) return null;
    return this.plan.steps[this.currentStep];
  }

  /** Advance step (sub-plan aware) */
  advanceStep() {
    if (this.subPlanManager.isInSubPlan()) {
      this.subPlanManager.advanceSubStep();
      if (this.subPlanManager.isSubPlanComplete()) {
        if (this.subPlanManager.getParentStep() && this.currentStep < this.plan.steps.length) {
          Object.assign(this.plan.steps[this.currentStep], { status: 'completed', completedViaSubPlan: true });
          this.currentStep++;
        }
        this.subPlanManager.clearSubPlan();
      }
      return this.getCurrentStep();
    }
    if (this.plan && this.currentStep < this.plan.steps.length) {
      this.plan.steps[this.currentStep].status = 'completed';
      this.currentStep++;
      this.subPlanManager.resetAttemptedFlag();
    }
    return this.getCurrentStep();
  }

  /** Fail current step (sub-plan aware) */
  failCurrentStep(reason) {
    if (this.subPlanManager.isInSubPlan()) return this.subPlanManager.failCurrentSubStep(reason);
    if (this.plan && this.currentStep < this.plan.steps.length) {
      Object.assign(this.plan.steps[this.currentStep], { status: 'failed', failReason: reason });
    }
  }

  /** Skip a step (mark as skipped and advance) */
  skipStep(stepNumber) {
    if (!this.plan) return;
    const step = this.plan.steps.find(s => s.number === stepNumber);
    if (step) Object.assign(step, { status: 'skipped', skippedAt: Date.now() });
    if (this.currentStep < this.plan.steps.length && this.plan.steps[this.currentStep].number === stepNumber) this.currentStep++;
    return this.getCurrentStep();
  }

  /** Abort sub-plan and mark parent step as failed */
  abortSubPlan(reason) {
    if (!this.subPlanManager.isInSubPlan()) return;
    if (this.subPlanManager.getParentStep() && this.currentStep < this.plan.steps.length) {
      Object.assign(this.plan.steps[this.currentStep], { status: 'failed', failReason: `Sub-plan failed: ${reason}` });
      this.currentStep++;
    }
    this.subPlanManager.clearSubPlan();
  }

  /** Get progress info (sub-plan aware) */
  getProgress() {
    if (!this.plan) return null;
    const completed = this.plan.steps.filter(s => s.status === 'completed').length;
    const failed = this.plan.steps.filter(s => s.status === 'failed').length;
    const inSubPlan = this.subPlanManager.isInSubPlan();
    return {
      current: this.currentStep + 1, total: this.plan.totalSteps, completed, failed,
      pending: this.plan.totalSteps - completed - failed,
      percentComplete: Math.round((completed / this.plan.totalSteps) * 100), inSubPlan,
      ...(inSubPlan && { subPlan: this.subPlanManager.getSubPlanProgress() }),
    };
  }

  /** Check if complete (sub-plan aware) */
  isComplete() {
    if (this.subPlanManager.isInSubPlan()) return false;
    return this.plan && this.currentStep >= this.plan.steps.length;
  }

  /** Get plan summary for display */
  getSummary() {
    if (!this.plan) return 'No plan created';
    const stepList = this.plan.steps.map(s => {
      const status = s.status === 'completed' ? '✓' : s.status === 'failed' ? '✗' : s.number === this.currentStep + 1 ? '→' : ' ';
      return `${status} ${s.number}. ${s.description} [${s.complexity}]`;
    }).join('\n');
    return `Goal: ${this.plan.goal}\n\nAnalysis: ${this.plan.analysis}\n\nPlan (${this.plan.totalSteps} steps):\n${stepList}`;
  }

  /** Get execution prompt (sub-plan aware) */
  getExecutionPrompt() {
    if (this.subPlanManager.isInSubPlan()) return this.subPlanManager.getSubPlanExecutionPrompt();
    const step = this.getCurrentStep();
    if (!step) return null;
    const { pending } = this.getProgress();
    const done = this.plan.steps.filter(s => s.status === 'completed').map(s => `✓ ${s.description}`).join('\n');
    return `## EXECUTING STEP ${step.number} OF ${this.plan.totalSteps}
**Goal:** ${this.plan.goal}
**Current Step:** ${step.description} [${step.complexity}]
${done ? `**Completed:**\n${done}\n` : ''}**Remaining:** ${pending} steps

Execute this step. Say "STEP COMPLETE" when done or "STEP BLOCKED: [reason]" if blocked. Focus ONLY on this step.`;
  }
}

export default Planner;
