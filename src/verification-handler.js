/**
 * Verification Handler
 * Handles step verification, goal verification, and completion verification
 */

import { isTruthy, isFalsy, isInconclusive } from './utils.js';
import {
  recordStepCompletion,
  persistStepProgress,
  recordAdaptiveMetrics,
  generateStepRejectionPrompt,
  trackTokenUsage,
  determineGoalVerificationPassed,
  buildGoalFailureReason,
} from './verification-result-handlers.js';

export class VerificationHandler {
  constructor(runner) {
    this.runner = runner;
  }

  /**
   * Handle pending step verification
   */
  async handlePendingStepVerification() {
    const r = this.runner;
    if (!r.pendingStepCompletion) return;

    r.onProgress({ type: 'step_verification_started', step: r.pendingStepCompletion.step });

    const stepVerification = await r.supervisor.verifyStepCompletion(
      r.pendingStepCompletion.step,
      r.pendingStepCompletion.response
    );

    if (stepVerification.verified) {
      await this.handleVerifiedStep(stepVerification);
    } else {
      await this.handleRejectedStep(stepVerification);
    }
  }

  /**
   * Handle a verified step completion
   */
  async handleVerifiedStep(stepVerification) {
    const r = this.runner;
    const completedStep = r.pendingStepCompletion.step;
    const stepDuration = completedStep.startTime ? Date.now() - completedStep.startTime : 0;

    r.planner.advanceStep();
    r.pendingStepCompletion = null;
    r.stepVerificationFailures = 0;

    recordStepCompletion(r, completedStep, stepDuration);

    r.onProgress({
      type: 'step_complete',
      step: completedStep,
      progress: r.planner.getProgress(),
      verification: stepVerification,
      duration: stepDuration,
    });

    await persistStepProgress(r, completedStep, stepDuration);

    r.contextManager.recordMilestone(
      `Completed step ${completedStep.number}: ${completedStep.description}`
    );

    recordAdaptiveMetrics(r, completedStep, stepDuration);
  }

  /**
   * Handle a rejected step completion
   */
  async handleRejectedStep(stepVerification) {
    const r = this.runner;
    r.stepVerificationFailures++;
    const rejectedStep = r.pendingStepCompletion.step;
    r.pendingStepCompletion = null;

    r.contextManager.recordDecision(
      `Rejected step ${rejectedStep.number} completion claim`,
      stepVerification.reason
    );

    r.onProgress({
      type: 'step_rejected',
      step: rejectedStep,
      reason: stepVerification.reason,
      failures: r.stepVerificationFailures,
    });

    const prompt = generateStepRejectionPrompt(rejectedStep, stepVerification);
    const result = await r.client.continueConversation(prompt);
    trackTokenUsage(r, result);
  }

  /**
   * Handle pending completion verification
   */
  async handlePendingCompletion() {
    const r = this.runner;
    if (!r.pendingCompletion) return;

    const verifyConfig = r.config.get('verification') || {};

    r.onProgress({ type: 'verification_started', claim: r.pendingCompletion });

    const planProgress = r.planner?.getProgress() || null;
    const verification = await r.verifier.verify(
      r.pendingCompletion.claim,
      r.workingDirectory,
      planProgress
    );

    r.onVerification({ iteration: r.iterationCount, claim: r.pendingCompletion, ...verification });

    if (verification.passed) {
      this.handleVerificationPassed(verification);
    } else {
      await this.handleVerificationFailed(verification, verifyConfig);
    }
  }

  handleVerificationPassed(verification) {
    const r = this.runner;
    r.shouldStop = true;
    r.finalSummary = {
      summary: r.pendingCompletion.claim,
      detectedCompletion: true,
      verified: true,
      verificationLayers: verification.layers,
    };
    r.pendingCompletion = null;
  }

  async handleVerificationFailed(verification, verifyConfig) {
    const r = this.runner;
    r.verificationFailures++;
    r.pendingCompletion = null;

    const maxAttempts = verifyConfig.maxAttempts || 3;
    if (r.verificationFailures >= maxAttempts) {
      r.onEscalation({
        type: 'verification_limit',
        iteration: r.iterationCount,
        failures: r.verificationFailures,
        message: `Max false completion claims (${maxAttempts}) reached`,
      });
    }

    const rejectionPrompt = r.verifier.generateRejectionPrompt(verification);
    const result = await r.client.continueConversation(rejectionPrompt);
    trackTokenUsage(r, result);
  }

  /**
   * Verify goal achievement
   */
  async verifyGoalAchievement(goalAchievementCycles) {
    const r = this.runner;
    if (!r.planner?.isComplete() || r.abortReason) {
      return null;
    }

    r.onProgress({ type: 'final_verification_started', cycle: goalAchievementCycles });

    const goalVerification = await r.supervisor.verifyGoalAchieved(
      r.primaryGoal,
      r.planner.plan.steps,
      r.workingDirectory
    );

    r.onProgress({
      type: 'goal_verification_complete',
      cycle: goalAchievementCycles,
      result: goalVerification,
    });

    return this.processGoalVerification(goalVerification, goalAchievementCycles);
  }

  processGoalVerification(goalVerification, goalAchievementCycles) {
    const r = this.runner;
    const verificationInconclusive = isInconclusive(goalVerification.achieved);
    const stepProgress = r.planner.getProgress();

    const overallPassed = determineGoalVerificationPassed(
      goalVerification.achieved,
      stepProgress.percentComplete,
      isTruthy,
      isFalsy
    );

    const cycleVerification = { goalVerification, overallPassed, verificationInconclusive };

    if (r.finalSummary) {
      r.finalSummary.goalVerification = goalVerification;
      r.finalSummary.fullyVerified = overallPassed;
    }

    if (overallPassed) {
      this.recordGoalSuccess(goalAchievementCycles, goalVerification, verificationInconclusive);
    } else {
      this.recordGoalFailure(goalAchievementCycles, goalVerification, verificationInconclusive, stepProgress);
    }

    return cycleVerification;
  }

  recordGoalSuccess(cycle, goalVerification, verificationInconclusive) {
    const r = this.runner;
    const suffix = verificationInconclusive ? ' (verification inconclusive but most steps completed)' : '';
    r.contextManager.recordMilestone(
      `Goal achieved and verified: ${r.primaryGoal.substring(0, 50)}...${suffix}`
    );
    r.onProgress({ type: 'final_verification_passed', cycle, goalVerification, verificationInconclusive });
  }

  recordGoalFailure(cycle, goalVerification, verificationInconclusive, stepProgress) {
    const r = this.runner;
    const failReason = buildGoalFailureReason(
      verificationInconclusive,
      stepProgress.percentComplete,
      goalVerification.reason
    );
    r.contextManager.recordDecision('Verification failed - will retry', failReason);
    r.onProgress({
      type: 'final_verification_failed',
      cycle,
      goalVerification,
      verificationInconclusive,
      reason: failReason,
      willRetry: !r.phaseManager.isTimeExpired() && cycle < 10,
    });
  }
}

export default VerificationHandler;
