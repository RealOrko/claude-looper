/**
 * Plan Manager
 * Handles plan setup, review, sub-plans, and gap planning
 */

import {
  buildVerificationDetails,
  buildGapContext,
  extractGaps,
  buildSubPlanPrompt,
} from './gap-plan-builder.js';

export class PlanManager {
  constructor(runner) {
    this.runner = runner;
  }

  /**
   * Setup execution plan (create new or restore from session)
   */
  async setupPlan(resumedSession) {
    if (resumedSession?.plan) {
      await this.restorePlan(resumedSession);
    } else {
      await this.createNewPlan();
    }
  }

  /**
   * Restore plan from resumed session
   */
  async restorePlan(resumedSession) {
    const r = this.runner;
    r.onProgress({ type: 'resuming', message: 'Resuming from saved session...' });
    r.planner.restorePlan(resumedSession.plan, resumedSession.currentStep);
    r.planCreated = true;

    const nextStep = r.planner.getCurrentStep();
    const nextStepNumber = nextStep?.number || (r.planner.currentStep + 1);

    r.onProgress({
      type: 'plan_restored',
      plan: resumedSession.plan,
      currentStep: nextStepNumber,
      completedSteps: resumedSession.completedSteps,
    });
  }

  /**
   * Create new execution plan
   */
  async createNewPlan() {
    const r = this.runner;
    r.onProgress({ type: 'planning', message: 'Creating execution plan...' });

    const planStart = Date.now();
    const plan = await r.planner.createPlan(r.primaryGoal, r.initialContext, r.workingDirectory);
    r.planCreated = true;
    r.metrics.recordPlanningTime(Date.now() - planStart, plan.totalSteps);

    if (r.enablePersistence) {
      await r.statePersistence.setPlan(plan);
      await r.statePersistence.createCheckpoint('plan_created', plan);
    }

    const parallelConfig = r.config.get('parallelExecution') || {};
    if (parallelConfig.enabled !== false) {
      r.planner.enableParallelMode();
    }

    r.contextManager.recordMilestone(`Created execution plan with ${plan.totalSteps} steps`);

    r.onProgress({
      type: 'plan_created',
      plan: plan,
      summary: r.planner.getSummary(),
      executionStats: r.planner.getExecutionStats(),
    });

    await this.reviewPlan(plan);
  }

  /**
   * Review created plan with supervisor
   */
  async reviewPlan(plan) {
    const r = this.runner;
    r.onProgress({ type: 'plan_review_started', plan });
    const planReview = await r.supervisor.reviewPlan(plan, r.primaryGoal);

    r.onProgress({ type: 'plan_review_complete', review: planReview });

    if (!planReview.approved) {
      r.contextManager.recordDecision(
        'Proceeding with plan despite review warnings',
        `Issues: ${planReview.issues?.length || 0}, Missing steps: ${planReview.missingSteps?.length || 0}`
      );
      r.onProgress({
        type: 'plan_review_warning',
        issues: planReview.issues,
        missingSteps: planReview.missingSteps,
        suggestions: planReview.suggestions,
      });
    } else {
      r.contextManager.recordDecision(
        'Plan approved by supervisor',
        `${r.planner.plan.totalSteps} steps ready for execution`
      );
    }
  }

  /**
   * Handle pending sub-plan creation
   */
  async handlePendingSubPlan() {
    const r = this.runner;
    if (!r.pendingSubPlan) return;

    r.onProgress({ type: 'subplan_creating', step: r.pendingSubPlan.step, reason: r.pendingSubPlan.reason });

    const subPlan = await r.planner.createSubPlan(
      r.pendingSubPlan.step,
      r.pendingSubPlan.reason,
      r.workingDirectory
    );

    if (subPlan) {
      r.contextManager.recordDecision(
        `Created sub-plan for step ${r.pendingSubPlan.step.number}`,
        `Original step blocked: ${r.pendingSubPlan.reason}. Created ${subPlan.totalSteps} sub-steps.`
      );
      r.onProgress({ type: 'subplan_created', parentStep: r.pendingSubPlan.step, subPlan });

      const prompt = buildSubPlanPrompt(r.pendingSubPlan, subPlan);
      const result = await r.client.continueConversation(prompt);

      if (result.tokensIn || result.tokensOut) {
        r.contextManager.trackTokenUsage(result.tokensIn || 0, result.tokensOut || 0);
      }
    } else {
      r.planner.failCurrentStep(r.pendingSubPlan.reason);
      r.planner.advanceStep();
      r.onProgress({
        type: 'step_failed',
        step: r.pendingSubPlan.step,
        reason: 'Sub-plan creation failed',
        progress: r.planner.getProgress(),
      });
    }

    r.pendingSubPlan = null;
  }

  /**
   * Create gap plan for failed verification
   */
  async createGapPlan(goalAchievementCycles, cycleVerification) {
    const r = this.runner;
    const failedSteps = r.planner.plan.steps.filter(s => s.status === 'failed');
    const gaps = extractGaps(cycleVerification, failedSteps);

    r.onProgress({
      type: 'creating_gap_plan',
      cycle: goalAchievementCycles,
      gaps,
      failedSteps: failedSteps.length,
      timeRemaining: r.phaseManager.getTimeStatus().remaining,
    });

    const verificationDetails = buildVerificationDetails(cycleVerification);
    const gapContext = buildGapContext(
      goalAchievementCycles,
      r.planner.getProgress(),
      failedSteps,
      gaps,
      verificationDetails
    );

    const newPlan = await r.planner.createPlan(
      r.primaryGoal,
      (r.initialContext || '') + '\n\n' + gapContext,
      r.workingDirectory
    );

    r.onProgress({
      type: 'gap_plan_created',
      cycle: goalAchievementCycles,
      plan: newPlan,
      steps: newPlan.totalSteps,
    });

    r.client.reset();
  }

  /**
   * Check if step should be decomposed
   */
  async checkStepDecomposition(step) {
    const r = this.runner;
    if (!step || step.isSubtask || step.decomposedInto) return;

    const stepElapsed = step.startTime ? Date.now() - step.startTime : 0;
    if (r.planner.shouldDecomposeStep(step, stepElapsed)) {
      r.onProgress({
        type: 'step_decomposing',
        step,
        reason: step.complexity === 'complex' ? 'complex_step' : 'long_running',
      });

      const decomposition = await r.planner.decomposeComplexStep(step, r.workingDirectory);

      if (decomposition && r.planner.injectSubtasks(decomposition)) {
        r.onProgress({
          type: 'step_decomposed',
          parentStep: step,
          subtasks: decomposition.subtasks,
          parallelSafe: decomposition.parallelSafe,
        });
      }
    }
  }
}

export default PlanManager;
