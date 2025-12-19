/**
 * Report Generator - generates final execution reports
 */

export class ReportGenerator {
  constructor(runner) {
    this.runner = runner;
  }

  /** Generate the final execution report */
  generate(finalVerification = null) {
    const r = this.runner;
    const timeStatus = r.phaseManager.getTimeStatus();
    const progressSummary = r.goalTracker.getProgressSummary();
    const planProgress = r.planner?.getProgress();

    const status = this.determineStatus(finalVerification, timeStatus);

    return {
      status,
      abortReason: r.abortReason,
      summary: r.finalSummary,
      goal: this.buildGoalSection(planProgress, progressSummary),
      plan: this.buildPlanSection(planProgress),
      time: this.buildTimeSection(timeStatus),
      session: this.buildSessionSection(),
      supervision: r.supervisor.getStats(),
      verification: this.buildVerificationSection(),
      finalVerification: this.buildFinalVerificationSection(finalVerification),
      phases: r.phaseManager.getStatusReport().phases,
      checkpoints: r.phaseManager.getStatusReport().checkpoints,
      cacheStats: r.contextManager.getCacheStats(),
      tokenStats: r.contextManager.getTokenStats(),
      clientMetrics: this.getClientMetrics(),
      performanceMetrics: r.metrics.getSummary(),
      performanceTrends: r.metrics.getTrends(),
    };
  }

  /** Determine the final status */
  determineStatus(finalVerification, timeStatus) {
    const r = this.runner;
    if (r.abortReason) return 'aborted';
    if (r.planner?.isComplete()) {
      return (finalVerification && !finalVerification.overallPassed) ? 'verification_failed' : 'completed';
    }
    if (r.goalTracker.isComplete()) return 'completed';
    if (timeStatus.isExpired) return 'time_expired';
    return 'stopped';
  }

  /** Build goal section of report */
  buildGoalSection(planProgress, progressSummary) {
    const r = this.runner;
    return {
      primary: r.goalTracker.primaryGoal,
      subGoals: r.goalTracker.subGoals,
      progress: planProgress?.percentComplete || progressSummary.overallProgress,
      milestones: r.goalTracker.completedMilestones,
    };
  }

  /** Build plan section of report */
  buildPlanSection(planProgress) {
    const r = this.runner;
    if (!r.planner?.plan) return null;
    return {
      analysis: r.planner.plan.analysis,
      steps: r.planner.plan.steps,
      totalSteps: r.planner.plan.totalSteps,
      completed: planProgress?.completed || 0,
      failed: planProgress?.failed || 0,
    };
  }

  /** Build time section of report */
  buildTimeSection(timeStatus) {
    const r = this.runner;
    return {
      elapsed: timeStatus.elapsed,
      limit: r.phaseManager.formatDuration(r.phaseManager.timeLimit),
      percentUsed: timeStatus.percentTimeUsed,
    };
  }

  /** Build session section of report */
  buildSessionSection() {
    const r = this.runner;
    return {
      id: r.client.getSessionId(),
      iterations: r.iterationCount,
      messageCount: r.client.getHistory().length,
    };
  }

  /** Build verification section of report */
  buildVerificationSection() {
    const r = this.runner;
    return {
      enabled: (r.config.get('verification') || {}).enabled !== false,
      failures: r.verificationFailures,
      stats: r.verifier?.getStats() || null,
      finalStatus: r.finalSummary?.verified ? 'verified' : 'unverified',
    };
  }

  /** Build final verification section of report */
  buildFinalVerificationSection(finalVerification) {
    if (!finalVerification) return null;
    return {
      goalAchieved: finalVerification.goalVerification?.achieved,
      confidence: finalVerification.goalVerification?.confidence,
      functional: finalVerification.goalVerification?.functional,
      recommendation: finalVerification.goalVerification?.recommendation,
      gaps: finalVerification.goalVerification?.gaps,
      overallPassed: finalVerification.overallPassed,
    };
  }

  /** Get metrics from all clients */
  getClientMetrics() {
    const r = this.runner;
    return {
      worker: r.client.getMetrics(),
      supervisor: r.supervisorClient?.getMetrics() || null,
      planner: r.plannerClient?.getMetrics() || null,
    };
  }
}

export default ReportGenerator;
