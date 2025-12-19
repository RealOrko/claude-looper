/**
 * Adaptive Optimizer - Strategy optimization based on task performance
 */
import { TaskClassifier, TaskType } from './task-classifier.js';
import { ExecutionStrategy, getStrategyParameters } from './execution-strategies.js';

export { TaskType } from './task-classifier.js';
export { ExecutionStrategy, getStrategyParameters } from './execution-strategies.js';

export class AdaptiveOptimizer {
  constructor() {
    this.classifier = new TaskClassifier();
    this.taskTypeStats = {};
    this.strategyStats = {};
    this.currentProfile = null;
    this.thresholds = {
      slowStepMs: 120000,
      highErrorRate: 0.2,
      lowSupervisionScore: 60,
      highTokenUsage: 50000,
      stuckIterations: 5,
    };
  }

  classifyTask(description) {
    return this.classifier.classify(description);
  }

  recordTaskPerformance(taskType, metrics) {
    if (!this.taskTypeStats[taskType]) {
      this.taskTypeStats[taskType] = {
        count: 0, totalDuration: 0, avgDuration: 0, successRate: 0,
        successCount: 0, avgTokens: 0, totalTokens: 0, avgIterations: 0,
        totalIterations: 0, errorTypes: {},
      };
    }
    const stats = this.taskTypeStats[taskType];
    stats.count++;
    stats.totalDuration += metrics.duration || 0;
    stats.avgDuration = stats.totalDuration / stats.count;
    if (metrics.success) stats.successCount++;
    stats.successRate = stats.successCount / stats.count;
    stats.totalTokens += metrics.tokens || 0;
    stats.avgTokens = stats.totalTokens / stats.count;
    stats.totalIterations += metrics.iterations || 1;
    stats.avgIterations = stats.totalIterations / stats.count;
    if (metrics.errorType) {
      stats.errorTypes[metrics.errorType] = (stats.errorTypes[metrics.errorType] || 0) + 1;
    }
  }

  recordStrategyEffectiveness(strategy, success, metrics = {}) {
    if (!this.strategyStats[strategy]) {
      this.strategyStats[strategy] = { uses: 0, successes: 0, avgDuration: 0, totalDuration: 0, successRate: 0 };
    }
    const stats = this.strategyStats[strategy];
    stats.uses++;
    if (success) stats.successes++;
    stats.successRate = stats.successes / stats.uses;
    if (metrics.duration) {
      stats.totalDuration += metrics.duration;
      stats.avgDuration = stats.totalDuration / stats.uses;
    }
  }

  getRecommendedStrategy(taskDescription, context = {}) {
    const taskType = this.classifyTask(taskDescription);
    const taskStats = this.taskTypeStats[taskType];
    const recommendations = { primary: ExecutionStrategy.DEFAULT, secondary: [], reasoning: [] };

    // Task-type based recommendations
    this._applyTaskTypeRecommendations(taskType, context, recommendations);

    // History-based adjustments
    if (taskStats) {
      this._applyHistoricalAdjustments(taskStats, recommendations);
    }

    // Context-based adjustments
    this._applyContextAdjustments(context, recommendations);

    return recommendations;
  }

  _applyTaskTypeRecommendations(taskType, context, rec) {
    switch (taskType) {
      case TaskType.BUG_FIX:
        rec.primary = ExecutionStrategy.CAREFUL_VALIDATION;
        rec.reasoning.push('Bug fixes benefit from thorough validation');
        break;
      case TaskType.REFACTORING:
        rec.primary = ExecutionStrategy.FREQUENT_CHECKPOINTS;
        rec.reasoning.push('Refactoring is risky; use frequent checkpoints');
        rec.secondary.push(ExecutionStrategy.SEQUENTIAL_SAFE);
        break;
      case TaskType.CODE_GENERATION:
        if (context.complexity === 'complex') {
          rec.primary = ExecutionStrategy.EXTENDED_TIMEOUT;
          rec.reasoning.push('Complex code generation may need more time');
        } else {
          rec.primary = ExecutionStrategy.PARALLEL_AGGRESSIVE;
          rec.reasoning.push('Simple code generation can be parallelized');
        }
        break;
      case TaskType.TESTING:
        rec.primary = ExecutionStrategy.FAST_ITERATION;
        rec.reasoning.push('Testing benefits from quick feedback loops');
        break;
      case TaskType.RESEARCH:
        rec.primary = ExecutionStrategy.MINIMAL_CONTEXT;
        rec.reasoning.push('Research tasks can generate lots of context');
        rec.secondary.push(ExecutionStrategy.EXTENDED_TIMEOUT);
        break;
      case TaskType.DOCUMENTATION:
        rec.primary = ExecutionStrategy.FAST_ITERATION;
        rec.reasoning.push('Documentation is low-risk, iterate quickly');
        break;
    }
  }

  _applyHistoricalAdjustments(stats, rec) {
    if (stats.avgDuration > this.thresholds.slowStepMs) {
      rec.secondary.push(ExecutionStrategy.EXTENDED_TIMEOUT);
      rec.reasoning.push(`Historical avg duration (${Math.round(stats.avgDuration/1000)}s) exceeds threshold`);
    }
    if (stats.successRate < (1 - this.thresholds.highErrorRate)) {
      rec.primary = ExecutionStrategy.CAREFUL_VALIDATION;
      rec.reasoning.push(`Low success rate (${Math.round(stats.successRate * 100)}%) for this task type`);
    }
    if (stats.avgIterations > this.thresholds.stuckIterations) {
      rec.secondary.push(ExecutionStrategy.FREQUENT_CHECKPOINTS);
      rec.reasoning.push(`High avg iterations (${stats.avgIterations.toFixed(1)}) suggests getting stuck`);
    }
  }

  _applyContextAdjustments(context, rec) {
    if (context.errorRate > this.thresholds.highErrorRate) {
      rec.primary = ExecutionStrategy.SEQUENTIAL_SAFE;
      rec.reasoning.push('High recent error rate - switch to safer execution');
    }
    if (context.supervisionScore && context.supervisionScore < this.thresholds.lowSupervisionScore) {
      rec.secondary.push(ExecutionStrategy.CAREFUL_VALIDATION);
      rec.reasoning.push('Low supervision scores suggest more validation needed');
    }
    if (context.contextSize > this.thresholds.highTokenUsage) {
      rec.secondary.push(ExecutionStrategy.MINIMAL_CONTEXT);
      rec.reasoning.push('High context size - consider context optimization');
    }
  }

  getStrategyParameters(strategy) {
    return getStrategyParameters(strategy);
  }

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

  adjustStrategy(currentMetrics) {
    if (!this.currentProfile) return null;
    const adjustments = [];
    if (currentMetrics.recentErrorRate > 0.3) {
      adjustments.push({ change: 'increase_supervision', reason: 'High recent error rate', newValue: 1 });
    }
    if (currentMetrics.avgIterationTime > this.currentProfile.parameters.timeout * 0.8) {
      adjustments.push({ change: 'increase_timeout', reason: 'Approaching timeout limit', newValue: this.currentProfile.parameters.timeout * 1.5 });
    }
    if (currentMetrics.stuckIterations > 3) {
      adjustments.push({ change: 'switch_strategy', reason: 'Stuck on same step', newStrategy: ExecutionStrategy.SEQUENTIAL_SAFE });
    }
    if (currentMetrics.supervisionScore < 50) {
      adjustments.push({ change: 'add_checkpoints', reason: 'Low supervision scores', newValue: 1 });
    }
    for (const adj of adjustments) {
      this._applyAdjustment(adj);
    }
    return adjustments.length > 0 ? adjustments : null;
  }

  _applyAdjustment(adj) {
    switch (adj.change) {
      case 'increase_supervision':
        this.currentProfile.parameters.supervisionFrequency = adj.newValue;
        break;
      case 'increase_timeout':
        this.currentProfile.parameters.timeout = adj.newValue;
        break;
      case 'switch_strategy':
        this.currentProfile.primaryStrategy = adj.newStrategy;
        Object.assign(this.currentProfile.parameters, this.getStrategyParameters(adj.newStrategy));
        break;
      case 'add_checkpoints':
        this.currentProfile.parameters.checkpointFrequency = adj.newValue;
        break;
    }
  }

  getInsights() {
    const insights = [];
    for (const [type, stats] of Object.entries(this.taskTypeStats)) {
      if (stats.count >= 3) {
        if (stats.successRate < 0.7) {
          insights.push({ type: 'warning', category: 'task_type', message: `${type} tasks have low success rate (${Math.round(stats.successRate * 100)}%)`, suggestion: 'Consider using CAREFUL_VALIDATION strategy' });
        }
        if (stats.avgDuration > 180000) {
          insights.push({ type: 'info', category: 'performance', message: `${type} tasks average ${Math.round(stats.avgDuration / 1000)}s to complete`, suggestion: 'These tasks may benefit from EXTENDED_TIMEOUT strategy' });
        }
      }
    }
    let bestStrategy = null, bestSuccessRate = 0;
    for (const [strategy, stats] of Object.entries(this.strategyStats)) {
      if (stats.uses >= 3 && stats.successRate > bestSuccessRate) {
        bestStrategy = strategy;
        bestSuccessRate = stats.successRate;
      }
    }
    if (bestStrategy) {
      insights.push({ type: 'info', category: 'strategy', message: `${bestStrategy} is your most effective strategy (${Math.round(bestSuccessRate * 100)}% success)`, suggestion: 'Consider using this strategy more often' });
    }
    return insights;
  }

  getSummary() {
    return {
      taskTypes: Object.fromEntries(Object.entries(this.taskTypeStats).map(([type, stats]) => [type, { count: stats.count, successRate: Math.round(stats.successRate * 100) + '%', avgDuration: Math.round(stats.avgDuration / 1000) + 's', avgIterations: stats.avgIterations.toFixed(1) }])),
      strategies: Object.fromEntries(Object.entries(this.strategyStats).map(([strategy, stats]) => [strategy, { uses: stats.uses, successRate: Math.round(stats.successRate * 100) + '%' }])),
      currentProfile: this.currentProfile,
      insights: this.getInsights(),
    };
  }
}

export default AdaptiveOptimizer;
