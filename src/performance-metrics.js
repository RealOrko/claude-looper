/**
 * Performance Metrics - Comprehensive tracking for autonomous runner
 *
 * Tracks:
 * - Execution timing and throughput
 * - Step completion rates and patterns
 * - Token usage efficiency
 * - Supervisor intervention frequency
 * - Error rates and recovery success
 * - Parallel execution efficiency
 */

export class PerformanceMetrics {
  constructor() {
    this.startTime = null;
    this.endTime = null;

    // Timing metrics
    this.timings = {
      planning: [],      // Plan creation times
      stepExecution: [], // Per-step execution times
      supervision: [],   // Supervisor check times
      verification: [],  // Verification times
      iterations: [],    // Full iteration times
    };

    // Step metrics
    this.steps = {
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      retriedViaSubPlan: 0,
      parallelBatches: 0,
      maxParallelSteps: 0,
    };

    // Token metrics
    this.tokens = {
      total: 0,
      saved: 0,
      perIteration: [],
      perStep: [],
    };

    // Supervision metrics
    this.supervision = {
      totalChecks: 0,
      interventions: 0,
      corrections: 0,
      escalations: 0,
      recoveryAttempts: 0,
      recoverySuccesses: 0,
      scoreHistory: [],
    };

    // Error metrics
    this.errors = {
      total: 0,
      byType: {},
      recoveredErrors: 0,
    };

    // Efficiency metrics
    this.efficiency = {
      stepsPerHour: 0,
      avgStepTime: 0,
      parallelSpeedup: 1.0,
      tokenEfficiency: 0,
    };

    // Iteration tracking
    this.currentIteration = 0;
    this.iterationStart = null;
  }

  /**
   * Start tracking a session
   */
  startSession() {
    this.startTime = Date.now();
  }

  /**
   * End tracking a session
   */
  endSession() {
    this.endTime = Date.now();
    this.calculateFinalMetrics();
  }

  /**
   * Start tracking an iteration
   */
  startIteration() {
    this.currentIteration++;
    this.iterationStart = Date.now();
  }

  /**
   * End tracking an iteration
   */
  endIteration(tokenUsage = null) {
    if (this.iterationStart) {
      const duration = Date.now() - this.iterationStart;
      this.timings.iterations.push({
        iteration: this.currentIteration,
        duration,
        timestamp: Date.now(),
      });

      if (tokenUsage) {
        this.tokens.perIteration.push({
          iteration: this.currentIteration,
          ...tokenUsage,
        });
        this.tokens.total += tokenUsage.total || 0;
      }
    }
    this.iterationStart = null;
  }

  /**
   * Record planning time
   */
  recordPlanningTime(duration, stepCount = 0) {
    this.timings.planning.push({
      duration,
      stepCount,
      timestamp: Date.now(),
    });
    this.steps.total = Math.max(this.steps.total, stepCount);
  }

  /**
   * Record step execution
   */
  recordStepExecution(stepNumber, status, duration, options = {}) {
    const { wasParallel = false, tokens = 0, complexity = 'medium' } = options;

    this.timings.stepExecution.push({
      stepNumber,
      status,
      duration,
      wasParallel,
      complexity,
      timestamp: Date.now(),
    });

    if (tokens > 0) {
      this.tokens.perStep.push({ stepNumber, tokens });
    }

    // Update step counts
    switch (status) {
      case 'completed':
        this.steps.completed++;
        break;
      case 'failed':
        this.steps.failed++;
        break;
      case 'skipped':
        this.steps.skipped++;
        break;
    }
  }

  /**
   * Record a parallel execution batch
   */
  recordParallelBatch(stepCount) {
    this.steps.parallelBatches++;
    this.steps.maxParallelSteps = Math.max(this.steps.maxParallelSteps, stepCount);
  }

  /**
   * Record supervision check
   */
  recordSupervision(result, duration) {
    this.supervision.totalChecks++;
    this.timings.supervision.push({ duration, timestamp: Date.now() });

    if (result.assessment?.score !== undefined) {
      this.supervision.scoreHistory.push(result.assessment.score);
    }

    if (result.needsIntervention) {
      this.supervision.interventions++;
    }

    if (result.correction) {
      this.supervision.corrections++;
    }

    if (result.escalated) {
      this.supervision.escalations++;
    }

    if (result.autoRecovery) {
      this.supervision.recoveryAttempts++;
    }
  }

  /**
   * Record recovery success
   */
  recordRecoverySuccess() {
    this.supervision.recoverySuccesses++;
  }

  /**
   * Record verification time
   */
  recordVerification(duration, passed) {
    this.timings.verification.push({
      duration,
      passed,
      timestamp: Date.now(),
    });
  }

  /**
   * Record an error
   */
  recordError(type, recovered = false) {
    this.errors.total++;
    this.errors.byType[type] = (this.errors.byType[type] || 0) + 1;
    if (recovered) {
      this.errors.recoveredErrors++;
    }
  }

  /**
   * Record token savings
   */
  recordTokenSavings(saved) {
    this.tokens.saved += saved;
  }

  /**
   * Record sub-plan usage
   */
  recordSubPlanUsage() {
    this.steps.retriedViaSubPlan++;
  }

  /**
   * Calculate final efficiency metrics
   */
  calculateFinalMetrics() {
    const totalDuration = (this.endTime || Date.now()) - this.startTime;
    const hours = totalDuration / (1000 * 60 * 60);

    // Steps per hour
    this.efficiency.stepsPerHour = hours > 0
      ? Math.round(this.steps.completed / hours * 10) / 10
      : 0;

    // Average step time
    const stepTimes = this.timings.stepExecution.map(s => s.duration);
    this.efficiency.avgStepTime = stepTimes.length > 0
      ? Math.round(stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length)
      : 0;

    // Parallel speedup estimate
    if (this.steps.parallelBatches > 0) {
      // Estimate sequential time vs actual time
      const sequentialEstimate = stepTimes.reduce((a, b) => a + b, 0);
      const actualStepTime = this.timings.stepExecution
        .filter(s => s.status === 'completed')
        .reduce((sum, s) => sum + s.duration, 0);

      if (actualStepTime > 0) {
        this.efficiency.parallelSpeedup =
          Math.round((sequentialEstimate / actualStepTime) * 100) / 100;
      }
    }

    // Token efficiency
    if (this.tokens.total > 0) {
      this.efficiency.tokenEfficiency =
        Math.round((this.tokens.saved / (this.tokens.total + this.tokens.saved)) * 100);
    }
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    this.calculateFinalMetrics();

    const totalDuration = (this.endTime || Date.now()) - this.startTime;

    return {
      duration: {
        total: this.formatDuration(totalDuration),
        totalMs: totalDuration,
        planning: this.getAverageDuration(this.timings.planning),
        avgIteration: this.getAverageDuration(this.timings.iterations),
        avgStep: this.efficiency.avgStepTime,
      },
      steps: {
        total: this.steps.total,
        completed: this.steps.completed,
        failed: this.steps.failed,
        skipped: this.steps.skipped,
        successRate: this.steps.total > 0
          ? Math.round((this.steps.completed / this.steps.total) * 100)
          : 0,
        retriedViaSubPlan: this.steps.retriedViaSubPlan,
      },
      parallelExecution: {
        batches: this.steps.parallelBatches,
        maxConcurrent: this.steps.maxParallelSteps,
        estimatedSpeedup: this.efficiency.parallelSpeedup + 'x',
      },
      tokens: {
        total: this.tokens.total,
        saved: this.tokens.saved,
        efficiency: this.efficiency.tokenEfficiency + '%',
        avgPerIteration: this.tokens.perIteration.length > 0
          ? Math.round(this.tokens.total / this.tokens.perIteration.length)
          : 0,
      },
      supervision: {
        totalChecks: this.supervision.totalChecks,
        interventions: this.supervision.interventions,
        interventionRate: this.supervision.totalChecks > 0
          ? Math.round((this.supervision.interventions / this.supervision.totalChecks) * 100)
          : 0,
        corrections: this.supervision.corrections,
        escalations: this.supervision.escalations,
        avgScore: this.supervision.scoreHistory.length > 0
          ? Math.round(
              this.supervision.scoreHistory.reduce((a, b) => a + b, 0) /
              this.supervision.scoreHistory.length
            )
          : null,
        recoverySuccessRate: this.supervision.recoveryAttempts > 0
          ? Math.round(
              (this.supervision.recoverySuccesses / this.supervision.recoveryAttempts) * 100
            )
          : null,
      },
      errors: {
        total: this.errors.total,
        recovered: this.errors.recoveredErrors,
        recoveryRate: this.errors.total > 0
          ? Math.round((this.errors.recoveredErrors / this.errors.total) * 100)
          : 100,
        byType: this.errors.byType,
      },
      efficiency: {
        stepsPerHour: this.efficiency.stepsPerHour,
        iterations: this.currentIteration,
        iterationsPerStep: this.steps.completed > 0
          ? Math.round((this.currentIteration / this.steps.completed) * 10) / 10
          : 0,
      },
    };
  }

  /**
   * Get detailed timing breakdown
   */
  getTimingBreakdown() {
    return {
      planning: this.timings.planning,
      stepExecution: this.timings.stepExecution,
      supervision: this.timings.supervision,
      verification: this.timings.verification,
      iterations: this.timings.iterations.slice(-20), // Last 20
    };
  }

  /**
   * Get performance trends
   */
  getTrends() {
    const recentIterations = this.timings.iterations.slice(-10);
    const olderIterations = this.timings.iterations.slice(-20, -10);

    const recentAvg = this.getAverageDuration(recentIterations);
    const olderAvg = this.getAverageDuration(olderIterations);

    let iterationTrend = 'stable';
    if (recentAvg > olderAvg * 1.2) iterationTrend = 'slowing';
    else if (recentAvg < olderAvg * 0.8) iterationTrend = 'improving';

    const recentScores = this.supervision.scoreHistory.slice(-10);
    const olderScores = this.supervision.scoreHistory.slice(-20, -10);

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

  /**
   * Helper: Get average duration from timing entries
   */
  getAverageDuration(entries) {
    if (!entries || entries.length === 0) return 0;
    const durations = entries.map(e => e.duration);
    return durations.reduce((a, b) => a + b, 0) / durations.length;
  }

  /**
   * Helper: Format duration for display
   */
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

  /**
   * Export metrics as JSON
   */
  toJSON() {
    return {
      summary: this.getSummary(),
      timing: this.getTimingBreakdown(),
      trends: this.getTrends(),
      raw: {
        steps: this.steps,
        tokens: this.tokens,
        supervision: this.supervision,
        errors: this.errors,
      },
    };
  }
}

// ========== Task Type Classification ==========

export const TaskType = {
  CODE_GENERATION: 'code_generation',
  CODE_MODIFICATION: 'code_modification',
  BUG_FIX: 'bug_fix',
  REFACTORING: 'refactoring',
  TESTING: 'testing',
  DOCUMENTATION: 'documentation',
  RESEARCH: 'research',
  CONFIGURATION: 'configuration',
  DEPLOYMENT: 'deployment',
  UNKNOWN: 'unknown',
};

// Task type patterns for classification
// Order matters - more specific patterns should come first
const TASK_PATTERNS = {
  [TaskType.TESTING]: [
    /write.*tests?|unit\s*tests?|test|verify|validate|assert|spec/i,
  ],
  [TaskType.BUG_FIX]: [
    /fix|bug|issue|error|broken|repair|resolve|patch/i,
  ],
  [TaskType.REFACTORING]: [
    /refactor|restructure|reorganize|clean.*up|simplify/i,
  ],
  [TaskType.CODE_GENERATION]: [
    /create|implement|build|add.*new|write.*function|develop/i,
  ],
  [TaskType.CODE_MODIFICATION]: [
    /update|modify|change|enhance|improve|extend/i,
  ],
  [TaskType.DOCUMENTATION]: [
    /document|readme|comment|explain|describe/i,
  ],
  [TaskType.RESEARCH]: [
    /research|analyze|investigate|explore|understand|study/i,
  ],
  [TaskType.CONFIGURATION]: [
    /config|setup|install|configure|environment|settings/i,
  ],
  [TaskType.DEPLOYMENT]: [
    /deploy|release|publish|build|package/i,
  ],
};

// ========== Adaptive Execution Strategies ==========

export const ExecutionStrategy = {
  FAST_ITERATION: 'fast_iteration',       // Quick iterations, minimal verification
  CAREFUL_VALIDATION: 'careful_validation', // Thorough validation, more supervision
  PARALLEL_AGGRESSIVE: 'parallel_aggressive', // Maximize parallelization
  SEQUENTIAL_SAFE: 'sequential_safe',      // Sequential execution, safer for complex tasks
  MINIMAL_CONTEXT: 'minimal_context',      // Reduce context to avoid limits
  EXTENDED_TIMEOUT: 'extended_timeout',    // Longer timeouts for complex operations
  FREQUENT_CHECKPOINTS: 'frequent_checkpoints', // More checkpoints for reliability
  DEFAULT: 'default',                       // Standard execution
};

/**
 * Adaptive Performance Optimizer
 *
 * Analyzes historical performance data and task characteristics
 * to recommend optimal execution strategies.
 */
export class AdaptiveOptimizer {
  constructor() {
    // Historical performance by task type
    this.taskTypeStats = {};

    // Strategy effectiveness tracking
    this.strategyStats = {};

    // Current execution profile
    this.currentProfile = null;

    // Baseline thresholds (adjusted based on history)
    this.thresholds = {
      slowStepMs: 120000,        // Step taking > 2 min is slow
      highErrorRate: 0.2,        // > 20% errors is concerning
      lowSupervisionScore: 60,   // Score < 60 needs attention
      highTokenUsage: 50000,     // Token usage per step
      stuckIterations: 5,        // Same step for 5+ iterations
    };
  }

  /**
   * Classify a task/step by type
   */
  classifyTask(description) {
    const desc = description.toLowerCase();

    for (const [type, patterns] of Object.entries(TASK_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(desc)) {
          return type;
        }
      }
    }

    return TaskType.UNKNOWN;
  }

  /**
   * Record task performance for learning
   */
  recordTaskPerformance(taskType, metrics) {
    if (!this.taskTypeStats[taskType]) {
      this.taskTypeStats[taskType] = {
        count: 0,
        totalDuration: 0,
        avgDuration: 0,
        successRate: 0,
        successCount: 0,
        avgTokens: 0,
        totalTokens: 0,
        avgIterations: 0,
        totalIterations: 0,
        errorTypes: {},
      };
    }

    const stats = this.taskTypeStats[taskType];
    stats.count++;
    stats.totalDuration += metrics.duration || 0;
    stats.avgDuration = stats.totalDuration / stats.count;

    if (metrics.success) {
      stats.successCount++;
    }
    stats.successRate = stats.successCount / stats.count;

    stats.totalTokens += metrics.tokens || 0;
    stats.avgTokens = stats.totalTokens / stats.count;

    stats.totalIterations += metrics.iterations || 1;
    stats.avgIterations = stats.totalIterations / stats.count;

    if (metrics.errorType) {
      stats.errorTypes[metrics.errorType] = (stats.errorTypes[metrics.errorType] || 0) + 1;
    }
  }

  /**
   * Record strategy effectiveness
   */
  recordStrategyEffectiveness(strategy, success, metrics = {}) {
    if (!this.strategyStats[strategy]) {
      this.strategyStats[strategy] = {
        uses: 0,
        successes: 0,
        avgDuration: 0,
        totalDuration: 0,
        successRate: 0,
      };
    }

    const stats = this.strategyStats[strategy];
    stats.uses++;
    if (success) {
      stats.successes++;
    }
    stats.successRate = stats.successes / stats.uses;

    if (metrics.duration) {
      stats.totalDuration += metrics.duration;
      stats.avgDuration = stats.totalDuration / stats.uses;
    }
  }

  /**
   * Get recommended strategy based on task type and context
   */
  getRecommendedStrategy(taskDescription, context = {}) {
    const taskType = this.classifyTask(taskDescription);
    const taskStats = this.taskTypeStats[taskType];

    const recommendations = {
      primary: ExecutionStrategy.DEFAULT,
      secondary: [],
      reasoning: [],
    };

    // Consider task type patterns
    switch (taskType) {
      case TaskType.BUG_FIX:
        recommendations.primary = ExecutionStrategy.CAREFUL_VALIDATION;
        recommendations.reasoning.push('Bug fixes benefit from thorough validation');
        break;

      case TaskType.REFACTORING:
        recommendations.primary = ExecutionStrategy.FREQUENT_CHECKPOINTS;
        recommendations.reasoning.push('Refactoring is risky; use frequent checkpoints');
        recommendations.secondary.push(ExecutionStrategy.SEQUENTIAL_SAFE);
        break;

      case TaskType.CODE_GENERATION:
        if (context.complexity === 'complex') {
          recommendations.primary = ExecutionStrategy.EXTENDED_TIMEOUT;
          recommendations.reasoning.push('Complex code generation may need more time');
        } else {
          recommendations.primary = ExecutionStrategy.PARALLEL_AGGRESSIVE;
          recommendations.reasoning.push('Simple code generation can be parallelized');
        }
        break;

      case TaskType.TESTING:
        recommendations.primary = ExecutionStrategy.FAST_ITERATION;
        recommendations.reasoning.push('Testing benefits from quick feedback loops');
        break;

      case TaskType.RESEARCH:
        recommendations.primary = ExecutionStrategy.MINIMAL_CONTEXT;
        recommendations.reasoning.push('Research tasks can generate lots of context');
        recommendations.secondary.push(ExecutionStrategy.EXTENDED_TIMEOUT);
        break;

      case TaskType.DOCUMENTATION:
        recommendations.primary = ExecutionStrategy.FAST_ITERATION;
        recommendations.reasoning.push('Documentation is low-risk, iterate quickly');
        break;
    }

    // Adjust based on historical performance
    if (taskStats) {
      if (taskStats.avgDuration > this.thresholds.slowStepMs) {
        recommendations.secondary.push(ExecutionStrategy.EXTENDED_TIMEOUT);
        recommendations.reasoning.push(
          `Historical avg duration (${Math.round(taskStats.avgDuration/1000)}s) exceeds threshold`
        );
      }

      if (taskStats.successRate < (1 - this.thresholds.highErrorRate)) {
        recommendations.primary = ExecutionStrategy.CAREFUL_VALIDATION;
        recommendations.reasoning.push(
          `Low success rate (${Math.round(taskStats.successRate * 100)}%) for this task type`
        );
      }

      if (taskStats.avgIterations > this.thresholds.stuckIterations) {
        recommendations.secondary.push(ExecutionStrategy.FREQUENT_CHECKPOINTS);
        recommendations.reasoning.push(
          `High avg iterations (${taskStats.avgIterations.toFixed(1)}) suggests getting stuck`
        );
      }
    }

    // Adjust based on current context
    if (context.errorRate > this.thresholds.highErrorRate) {
      recommendations.primary = ExecutionStrategy.SEQUENTIAL_SAFE;
      recommendations.reasoning.push('High recent error rate - switch to safer execution');
    }

    if (context.supervisionScore && context.supervisionScore < this.thresholds.lowSupervisionScore) {
      recommendations.secondary.push(ExecutionStrategy.CAREFUL_VALIDATION);
      recommendations.reasoning.push('Low supervision scores suggest more validation needed');
    }

    if (context.contextSize > this.thresholds.highTokenUsage) {
      recommendations.secondary.push(ExecutionStrategy.MINIMAL_CONTEXT);
      recommendations.reasoning.push('High context size - consider context optimization');
    }

    return recommendations;
  }

  /**
   * Get strategy parameters
   */
  getStrategyParameters(strategy) {
    const params = {
      [ExecutionStrategy.FAST_ITERATION]: {
        iterationDelay: 500,
        supervisionFrequency: 3,      // Every 3rd iteration
        checkpointFrequency: 5,
        timeout: 60000,
        parallelEnabled: true,
        maxParallel: 4,
      },
      [ExecutionStrategy.CAREFUL_VALIDATION]: {
        iterationDelay: 2000,
        supervisionFrequency: 1,      // Every iteration
        checkpointFrequency: 2,
        timeout: 180000,
        parallelEnabled: false,
        verificationLevel: 'thorough',
      },
      [ExecutionStrategy.PARALLEL_AGGRESSIVE]: {
        iterationDelay: 500,
        supervisionFrequency: 2,
        checkpointFrequency: 3,
        timeout: 120000,
        parallelEnabled: true,
        maxParallel: 6,
      },
      [ExecutionStrategy.SEQUENTIAL_SAFE]: {
        iterationDelay: 2000,
        supervisionFrequency: 1,
        checkpointFrequency: 1,
        timeout: 180000,
        parallelEnabled: false,
        verificationLevel: 'thorough',
      },
      [ExecutionStrategy.MINIMAL_CONTEXT]: {
        iterationDelay: 1000,
        supervisionFrequency: 2,
        checkpointFrequency: 3,
        timeout: 120000,
        contextTrimming: true,
        maxContextTokens: 30000,
      },
      [ExecutionStrategy.EXTENDED_TIMEOUT]: {
        iterationDelay: 1000,
        supervisionFrequency: 2,
        checkpointFrequency: 3,
        timeout: 300000,             // 5 minutes
        parallelEnabled: true,
        maxParallel: 2,
      },
      [ExecutionStrategy.FREQUENT_CHECKPOINTS]: {
        iterationDelay: 1000,
        supervisionFrequency: 1,
        checkpointFrequency: 1,       // Every step
        timeout: 120000,
        parallelEnabled: true,
        maxParallel: 3,
      },
      [ExecutionStrategy.DEFAULT]: {
        iterationDelay: 1000,
        supervisionFrequency: 2,
        checkpointFrequency: 3,
        timeout: 120000,
        parallelEnabled: true,
        maxParallel: 3,
      },
    };

    return params[strategy] || params[ExecutionStrategy.DEFAULT];
  }

  /**
   * Create an execution profile for a task
   */
  createExecutionProfile(taskDescription, context = {}) {
    const taskType = this.classifyTask(taskDescription);
    const recommendations = this.getRecommendedStrategy(taskDescription, context);
    const parameters = this.getStrategyParameters(recommendations.primary);

    this.currentProfile = {
      taskType,
      primaryStrategy: recommendations.primary,
      secondaryStrategies: recommendations.secondary,
      reasoning: recommendations.reasoning,
      parameters,
      createdAt: Date.now(),
    };

    return this.currentProfile;
  }

  /**
   * Adjust strategy based on real-time performance
   */
  adjustStrategy(currentMetrics) {
    if (!this.currentProfile) return null;

    const adjustments = [];

    // Check if current strategy is working
    if (currentMetrics.recentErrorRate > 0.3) {
      adjustments.push({
        change: 'increase_supervision',
        reason: 'High recent error rate',
        newValue: 1, // supervisionFrequency
      });
    }

    if (currentMetrics.avgIterationTime > this.currentProfile.parameters.timeout * 0.8) {
      adjustments.push({
        change: 'increase_timeout',
        reason: 'Approaching timeout limit',
        newValue: this.currentProfile.parameters.timeout * 1.5,
      });
    }

    if (currentMetrics.stuckIterations > 3) {
      adjustments.push({
        change: 'switch_strategy',
        reason: 'Stuck on same step',
        newStrategy: ExecutionStrategy.SEQUENTIAL_SAFE,
      });
    }

    if (currentMetrics.supervisionScore < 50) {
      adjustments.push({
        change: 'add_checkpoints',
        reason: 'Low supervision scores',
        newValue: 1, // checkpointFrequency
      });
    }

    // Apply adjustments
    for (const adj of adjustments) {
      switch (adj.change) {
        case 'increase_supervision':
          this.currentProfile.parameters.supervisionFrequency = adj.newValue;
          break;
        case 'increase_timeout':
          this.currentProfile.parameters.timeout = adj.newValue;
          break;
        case 'switch_strategy':
          this.currentProfile.primaryStrategy = adj.newStrategy;
          Object.assign(
            this.currentProfile.parameters,
            this.getStrategyParameters(adj.newStrategy)
          );
          break;
        case 'add_checkpoints':
          this.currentProfile.parameters.checkpointFrequency = adj.newValue;
          break;
      }
    }

    return adjustments.length > 0 ? adjustments : null;
  }

  /**
   * Get performance insights
   */
  getInsights() {
    const insights = [];

    // Analyze task type performance
    for (const [type, stats] of Object.entries(this.taskTypeStats)) {
      if (stats.count >= 3) {
        if (stats.successRate < 0.7) {
          insights.push({
            type: 'warning',
            category: 'task_type',
            message: `${type} tasks have low success rate (${Math.round(stats.successRate * 100)}%)`,
            suggestion: 'Consider using CAREFUL_VALIDATION strategy for these tasks',
          });
        }

        if (stats.avgDuration > 180000) {
          insights.push({
            type: 'info',
            category: 'performance',
            message: `${type} tasks average ${Math.round(stats.avgDuration / 1000)}s to complete`,
            suggestion: 'These tasks may benefit from EXTENDED_TIMEOUT strategy',
          });
        }
      }
    }

    // Analyze strategy effectiveness
    let bestStrategy = null;
    let bestSuccessRate = 0;

    for (const [strategy, stats] of Object.entries(this.strategyStats)) {
      if (stats.uses >= 3 && stats.successRate > bestSuccessRate) {
        bestStrategy = strategy;
        bestSuccessRate = stats.successRate;
      }
    }

    if (bestStrategy) {
      insights.push({
        type: 'info',
        category: 'strategy',
        message: `${bestStrategy} is your most effective strategy (${Math.round(bestSuccessRate * 100)}% success)`,
        suggestion: 'Consider using this strategy more often',
      });
    }

    return insights;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    return {
      taskTypes: Object.fromEntries(
        Object.entries(this.taskTypeStats).map(([type, stats]) => [
          type,
          {
            count: stats.count,
            successRate: Math.round(stats.successRate * 100) + '%',
            avgDuration: Math.round(stats.avgDuration / 1000) + 's',
            avgIterations: stats.avgIterations.toFixed(1),
          },
        ])
      ),
      strategies: Object.fromEntries(
        Object.entries(this.strategyStats).map(([strategy, stats]) => [
          strategy,
          {
            uses: stats.uses,
            successRate: Math.round(stats.successRate * 100) + '%',
          },
        ])
      ),
      currentProfile: this.currentProfile,
      insights: this.getInsights(),
    };
  }
}

export default PerformanceMetrics;
