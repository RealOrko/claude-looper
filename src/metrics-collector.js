/**
 * Metrics Collector - Core data collection for autonomous runner
 */
import { MetricsReporter } from './metrics-reporter.js';

export class MetricsCollector {
  constructor() {
    this.startTime = null;
    this.endTime = null;
    this.timings = {
      planning: [],
      stepExecution: [],
      supervision: [],
      verification: [],
      iterations: [],
    };
    this.steps = {
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      retriedViaSubPlan: 0,
      parallelBatches: 0,
      maxParallelSteps: 0,
    };
    this.tokens = {
      total: 0,
      saved: 0,
      perIteration: [],
      perStep: [],
    };
    this.supervision = {
      totalChecks: 0,
      interventions: 0,
      corrections: 0,
      escalations: 0,
      recoveryAttempts: 0,
      recoverySuccesses: 0,
      scoreHistory: [],
    };
    this.errors = {
      total: 0,
      byType: {},
      recoveredErrors: 0,
    };
    this.efficiency = {
      stepsPerHour: 0,
      avgStepTime: 0,
      parallelSpeedup: 1.0,
      tokenEfficiency: 0,
    };
    this.currentIteration = 0;
    this.iterationStart = null;
    this._reporter = new MetricsReporter(this);
  }

  startSession() { this.startTime = Date.now(); }
  endSession() { this.endTime = Date.now(); this.calculateFinalMetrics(); }
  startIteration() { this.currentIteration++; this.iterationStart = Date.now(); }

  endIteration(tokenUsage = null) {
    if (this.iterationStart) {
      const duration = Date.now() - this.iterationStart;
      this.timings.iterations.push({ iteration: this.currentIteration, duration, timestamp: Date.now() });
      if (tokenUsage) {
        this.tokens.perIteration.push({ iteration: this.currentIteration, ...tokenUsage });
        this.tokens.total += tokenUsage.total || 0;
      }
    }
    this.iterationStart = null;
  }

  recordPlanningTime(duration, stepCount = 0) {
    this.timings.planning.push({ duration, stepCount, timestamp: Date.now() });
    this.steps.total = Math.max(this.steps.total, stepCount);
  }

  recordStepExecution(stepNumber, status, duration, options = {}) {
    const { wasParallel = false, tokens = 0, complexity = 'medium' } = options;
    this.timings.stepExecution.push({ stepNumber, status, duration, wasParallel, complexity, timestamp: Date.now() });
    if (tokens > 0) this.tokens.perStep.push({ stepNumber, tokens });
    if (status === 'completed') this.steps.completed++;
    else if (status === 'failed') this.steps.failed++;
    else if (status === 'skipped') this.steps.skipped++;
  }

  recordParallelBatch(stepCount) {
    this.steps.parallelBatches++;
    this.steps.maxParallelSteps = Math.max(this.steps.maxParallelSteps, stepCount);
  }

  recordParallelExecution(batchSize, results) {
    this.recordParallelBatch(batchSize);
    const durations = results.filter(r => r.duration).map(r => r.duration);
    if (durations.length > 1) {
      const sumSerial = durations.reduce((a, b) => a + b, 0);
      const maxParallel = Math.max(...durations);
      this.efficiency.parallelSpeedup = Math.max(this.efficiency.parallelSpeedup, sumSerial / maxParallel);
    }
    for (const result of results) {
      if (result.step && result.duration) {
        const status = result.success ? 'completed' : result.blocked ? 'blocked' : 'unclear';
        this.recordStepExecution(result.step.number, status, result.duration, { wasParallel: true, complexity: result.step.complexity });
      }
    }
  }

  recordSupervision(result, duration) {
    this.supervision.totalChecks++;
    this.timings.supervision.push({ duration, timestamp: Date.now() });
    if (result.assessment?.score !== undefined) this.supervision.scoreHistory.push(result.assessment.score);
    if (result.needsIntervention) this.supervision.interventions++;
    if (result.correction) this.supervision.corrections++;
    if (result.escalated) this.supervision.escalations++;
    if (result.autoRecovery) this.supervision.recoveryAttempts++;
  }

  recordRecoverySuccess() { this.supervision.recoverySuccesses++; }

  recordVerification(duration, passed) {
    this.timings.verification.push({ duration, passed, timestamp: Date.now() });
  }

  recordError(type, recovered = false) {
    this.errors.total++;
    this.errors.byType[type] = (this.errors.byType[type] || 0) + 1;
    if (recovered) this.errors.recoveredErrors++;
  }

  recordTokenSavings(saved) { this.tokens.saved += saved; }
  recordSubPlanUsage() { this.steps.retriedViaSubPlan++; }

  calculateFinalMetrics() {
    const totalDuration = (this.endTime || Date.now()) - this.startTime;
    const hours = totalDuration / (1000 * 60 * 60);
    this.efficiency.stepsPerHour = hours > 0 ? Math.round(this.steps.completed / hours * 10) / 10 : 0;
    const stepTimes = this.timings.stepExecution.map(s => s.duration);
    this.efficiency.avgStepTime = stepTimes.length > 0
      ? Math.round(stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length)
      : 0;
    if (this.steps.parallelBatches > 0) {
      const sequentialEstimate = stepTimes.reduce((a, b) => a + b, 0);
      const actualStepTime = this.timings.stepExecution
        .filter(s => s.status === 'completed')
        .reduce((sum, s) => sum + s.duration, 0);
      if (actualStepTime > 0) {
        this.efficiency.parallelSpeedup = Math.round((sequentialEstimate / actualStepTime) * 100) / 100;
      }
    }
    if (this.tokens.total > 0) {
      this.efficiency.tokenEfficiency = Math.round((this.tokens.saved / (this.tokens.total + this.tokens.saved)) * 100);
    }
  }

  // Delegate reporting methods
  getSummary() { return this._reporter.getSummary(); }
  getTimingBreakdown() { return this._reporter.getTimingBreakdown(); }
  getTrends() { return this._reporter.getTrends(); }
  toJSON() { return this._reporter.toJSON(); }
}

export default MetricsCollector;
