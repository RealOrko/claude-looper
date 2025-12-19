/**
 * Metrics Reporter - Summary and reporting utilities for metrics
 */

export class MetricsReporter {
  constructor(collector) {
    this.collector = collector;
  }

  getSummary() {
    this.collector.calculateFinalMetrics();
    const c = this.collector;
    const totalDuration = (c.endTime || Date.now()) - c.startTime;
    return {
      duration: {
        total: this.formatDuration(totalDuration),
        totalMs: totalDuration,
        planning: this.getAverageDuration(c.timings.planning),
        avgIteration: this.getAverageDuration(c.timings.iterations),
        avgStep: c.efficiency.avgStepTime,
      },
      steps: {
        total: c.steps.total,
        completed: c.steps.completed,
        failed: c.steps.failed,
        skipped: c.steps.skipped,
        successRate: c.steps.total > 0
          ? Math.round((c.steps.completed / c.steps.total) * 100)
          : 0,
        retriedViaSubPlan: c.steps.retriedViaSubPlan,
      },
      parallelExecution: {
        batches: c.steps.parallelBatches,
        maxConcurrent: c.steps.maxParallelSteps,
        estimatedSpeedup: c.efficiency.parallelSpeedup + 'x',
      },
      tokens: {
        total: c.tokens.total,
        saved: c.tokens.saved,
        efficiency: c.efficiency.tokenEfficiency + '%',
        avgPerIteration: c.tokens.perIteration.length > 0
          ? Math.round(c.tokens.total / c.tokens.perIteration.length)
          : 0,
      },
      supervision: {
        totalChecks: c.supervision.totalChecks,
        interventions: c.supervision.interventions,
        interventionRate: c.supervision.totalChecks > 0
          ? Math.round((c.supervision.interventions / c.supervision.totalChecks) * 100)
          : 0,
        corrections: c.supervision.corrections,
        escalations: c.supervision.escalations,
        avgScore: c.supervision.scoreHistory.length > 0
          ? Math.round(
              c.supervision.scoreHistory.reduce((a, b) => a + b, 0) /
              c.supervision.scoreHistory.length
            )
          : null,
        recoverySuccessRate: c.supervision.recoveryAttempts > 0
          ? Math.round(
              (c.supervision.recoverySuccesses / c.supervision.recoveryAttempts) * 100
            )
          : null,
      },
      errors: {
        total: c.errors.total,
        recovered: c.errors.recoveredErrors,
        recoveryRate: c.errors.total > 0
          ? Math.round((c.errors.recoveredErrors / c.errors.total) * 100)
          : 100,
        byType: c.errors.byType,
      },
      efficiency: {
        stepsPerHour: c.efficiency.stepsPerHour,
        iterations: c.currentIteration,
        iterationsPerStep: c.steps.completed > 0
          ? Math.round((c.currentIteration / c.steps.completed) * 10) / 10
          : 0,
      },
    };
  }

  getTimingBreakdown() {
    const c = this.collector;
    return {
      planning: c.timings.planning,
      stepExecution: c.timings.stepExecution,
      supervision: c.timings.supervision,
      verification: c.timings.verification,
      iterations: c.timings.iterations.slice(-20),
    };
  }

  getTrends() {
    const c = this.collector;
    const recentIterations = c.timings.iterations.slice(-10);
    const olderIterations = c.timings.iterations.slice(-20, -10);
    const recentAvg = this.getAverageDuration(recentIterations);
    const olderAvg = this.getAverageDuration(olderIterations);
    let iterationTrend = 'stable';
    if (recentAvg > olderAvg * 1.2) iterationTrend = 'slowing';
    else if (recentAvg < olderAvg * 0.8) iterationTrend = 'improving';
    const recentScores = c.supervision.scoreHistory.slice(-10);
    const olderScores = c.supervision.scoreHistory.slice(-20, -10);
    const recentScoreAvg = recentScores.length > 0
      ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length
      : null;
    const olderScoreAvg = olderScores.length > 0
      ? olderScores.reduce((a, b) => a + b, 0) / olderScores.length
      : null;
    let scoreTrend = 'stable';
    if (recentScoreAvg && olderScoreAvg) {
      if (recentScoreAvg > olderScoreAvg + 5) scoreTrend = 'improving';
      else if (recentScoreAvg < olderScoreAvg - 5) scoreTrend = 'declining';
    }
    return {
      iteration: {
        trend: iterationTrend,
        recentAvg: Math.round(recentAvg),
        olderAvg: Math.round(olderAvg),
      },
      score: {
        trend: scoreTrend,
        recentAvg: recentScoreAvg ? Math.round(recentScoreAvg) : null,
        olderAvg: olderScoreAvg ? Math.round(olderScoreAvg) : null,
      },
    };
  }

  getAverageDuration(entries) {
    if (!entries || entries.length === 0) return 0;
    const durations = entries.map(e => e.duration);
    return durations.reduce((a, b) => a + b, 0) / durations.length;
  }

  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) {
      const mins = Math.floor(ms / 60000);
      const secs = Math.round((ms % 60000) / 1000);
      return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(ms / 3600000);
    const mins = Math.round((ms % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  }

  toJSON() {
    return {
      summary: this.getSummary(),
      timing: this.getTimingBreakdown(),
      trends: this.getTrends(),
      raw: {
        steps: this.collector.steps,
        tokens: this.collector.tokens,
        supervision: this.collector.supervision,
        errors: this.collector.errors,
      },
    };
  }
}

export default MetricsReporter;
