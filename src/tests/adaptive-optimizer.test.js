import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptiveOptimizer, TaskType, ExecutionStrategy } from '../adaptive-optimizer.js';

describe('AdaptiveOptimizer', () => {
  let optimizer;

  beforeEach(() => {
    optimizer = new AdaptiveOptimizer();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(optimizer.taskTypeStats).toEqual({});
      expect(optimizer.strategyStats).toEqual({});
      expect(optimizer.currentProfile).toBeNull();
    });

    it('should have default thresholds', () => {
      expect(optimizer.thresholds.slowStepMs).toBe(120000);
      expect(optimizer.thresholds.highErrorRate).toBe(0.2);
      expect(optimizer.thresholds.lowSupervisionScore).toBe(60);
    });
  });

  describe('classifyTask', () => {
    it('should classify bug fix tasks', () => {
      expect(optimizer.classifyTask('Fix the login bug')).toBe(TaskType.BUG_FIX);
    });

    it('should classify testing tasks', () => {
      expect(optimizer.classifyTask('Write unit tests')).toBe(TaskType.TESTING);
    });

    it('should return UNKNOWN for unrecognized tasks', () => {
      expect(optimizer.classifyTask('random task')).toBe(TaskType.UNKNOWN);
    });
  });

  describe('recordTaskPerformance', () => {
    it('should track task statistics', () => {
      optimizer.recordTaskPerformance(TaskType.BUG_FIX, { duration: 10000, success: true });
      optimizer.recordTaskPerformance(TaskType.BUG_FIX, { duration: 20000, success: true });
      expect(optimizer.taskTypeStats[TaskType.BUG_FIX].count).toBe(2);
      expect(optimizer.taskTypeStats[TaskType.BUG_FIX].avgDuration).toBe(15000);
      expect(optimizer.taskTypeStats[TaskType.BUG_FIX].successRate).toBe(1);
    });

    it('should track failures', () => {
      optimizer.recordTaskPerformance(TaskType.BUG_FIX, { success: true });
      optimizer.recordTaskPerformance(TaskType.BUG_FIX, { success: false });
      expect(optimizer.taskTypeStats[TaskType.BUG_FIX].successRate).toBe(0.5);
    });

    it('should track error types', () => {
      optimizer.recordTaskPerformance(TaskType.BUG_FIX, { errorType: 'timeout' });
      optimizer.recordTaskPerformance(TaskType.BUG_FIX, { errorType: 'timeout' });
      expect(optimizer.taskTypeStats[TaskType.BUG_FIX].errorTypes.timeout).toBe(2);
    });
  });

  describe('recordStrategyEffectiveness', () => {
    it('should track strategy statistics', () => {
      optimizer.recordStrategyEffectiveness(ExecutionStrategy.FAST_ITERATION, true, { duration: 5000 });
      optimizer.recordStrategyEffectiveness(ExecutionStrategy.FAST_ITERATION, true, { duration: 3000 });
      expect(optimizer.strategyStats[ExecutionStrategy.FAST_ITERATION].uses).toBe(2);
      expect(optimizer.strategyStats[ExecutionStrategy.FAST_ITERATION].successRate).toBe(1);
    });

    it('should track failures', () => {
      optimizer.recordStrategyEffectiveness(ExecutionStrategy.FAST_ITERATION, true);
      optimizer.recordStrategyEffectiveness(ExecutionStrategy.FAST_ITERATION, false);
      expect(optimizer.strategyStats[ExecutionStrategy.FAST_ITERATION].successRate).toBe(0.5);
    });
  });

  describe('getRecommendedStrategy', () => {
    it('should recommend CAREFUL_VALIDATION for bug fixes', () => {
      const rec = optimizer.getRecommendedStrategy('Fix the login bug');
      expect(rec.primary).toBe(ExecutionStrategy.CAREFUL_VALIDATION);
    });

    it('should recommend FREQUENT_CHECKPOINTS for refactoring', () => {
      const rec = optimizer.getRecommendedStrategy('Refactor the module');
      expect(rec.primary).toBe(ExecutionStrategy.FREQUENT_CHECKPOINTS);
      expect(rec.secondary).toContain(ExecutionStrategy.SEQUENTIAL_SAFE);
    });

    it('should recommend FAST_ITERATION for testing', () => {
      const rec = optimizer.getRecommendedStrategy('Write unit tests');
      expect(rec.primary).toBe(ExecutionStrategy.FAST_ITERATION);
    });

    it('should recommend EXTENDED_TIMEOUT for complex code generation', () => {
      const rec = optimizer.getRecommendedStrategy('Create new API', { complexity: 'complex' });
      expect(rec.primary).toBe(ExecutionStrategy.EXTENDED_TIMEOUT);
    });

    it('should recommend PARALLEL_AGGRESSIVE for simple code generation', () => {
      const rec = optimizer.getRecommendedStrategy('Create new API');
      expect(rec.primary).toBe(ExecutionStrategy.PARALLEL_AGGRESSIVE);
    });

    it('should recommend MINIMAL_CONTEXT for research tasks', () => {
      const rec = optimizer.getRecommendedStrategy('Research best practices');
      expect(rec.primary).toBe(ExecutionStrategy.MINIMAL_CONTEXT);
    });

    it('should adjust based on historical data', () => {
      optimizer.taskTypeStats[TaskType.BUG_FIX] = { avgDuration: 200000, successRate: 0.5, avgIterations: 2 };
      const rec = optimizer.getRecommendedStrategy('Fix the bug');
      expect(rec.reasoning.some(r => r.includes('Low success rate'))).toBe(true);
    });

    it('should recommend SEQUENTIAL_SAFE for high error rate context', () => {
      const rec = optimizer.getRecommendedStrategy('Some task', { errorRate: 0.5 });
      expect(rec.primary).toBe(ExecutionStrategy.SEQUENTIAL_SAFE);
    });

    it('should suggest MINIMAL_CONTEXT for high context size', () => {
      const rec = optimizer.getRecommendedStrategy('Some task', { contextSize: 100000 });
      expect(rec.secondary).toContain(ExecutionStrategy.MINIMAL_CONTEXT);
    });
  });

  describe('getStrategyParameters', () => {
    it('should return parameters for valid strategy', () => {
      const params = optimizer.getStrategyParameters(ExecutionStrategy.FAST_ITERATION);
      expect(params.iterationDelay).toBe(500);
    });

    it('should return DEFAULT parameters for invalid strategy', () => {
      const params = optimizer.getStrategyParameters('invalid');
      expect(params.iterationDelay).toBe(1000);
    });
  });

  describe('createExecutionProfile', () => {
    it('should create execution profile', () => {
      const profile = optimizer.createExecutionProfile('Fix the login bug');
      expect(profile.taskType).toBe(TaskType.BUG_FIX);
      expect(profile.primaryStrategy).toBe(ExecutionStrategy.CAREFUL_VALIDATION);
      expect(profile.parameters).toBeDefined();
      expect(profile.createdAt).toBeTypeOf('number');
    });

    it('should store profile in currentProfile', () => {
      const profile = optimizer.createExecutionProfile('Write tests');
      expect(optimizer.currentProfile).toBe(profile);
    });
  });

  describe('adjustStrategy', () => {
    beforeEach(() => {
      optimizer.createExecutionProfile('Some task');
    });

    it('should return null without current profile', () => {
      optimizer.currentProfile = null;
      expect(optimizer.adjustStrategy({})).toBeNull();
    });

    it('should increase supervision for high error rate', () => {
      const adjustments = optimizer.adjustStrategy({ recentErrorRate: 0.5 });
      expect(adjustments).toContainEqual(expect.objectContaining({ change: 'increase_supervision' }));
    });

    it('should increase timeout when approaching limit', () => {
      const adjustments = optimizer.adjustStrategy({
        avgIterationTime: optimizer.currentProfile.parameters.timeout * 0.9,
      });
      expect(adjustments).toContainEqual(expect.objectContaining({ change: 'increase_timeout' }));
    });

    it('should switch strategy when stuck', () => {
      const adjustments = optimizer.adjustStrategy({ stuckIterations: 5 });
      expect(adjustments).toContainEqual(expect.objectContaining({ change: 'switch_strategy' }));
    });

    it('should add checkpoints for low supervision score', () => {
      const adjustments = optimizer.adjustStrategy({ supervisionScore: 30 });
      expect(adjustments).toContainEqual(expect.objectContaining({ change: 'add_checkpoints' }));
    });

    it('should return null when no adjustments needed', () => {
      const adjustments = optimizer.adjustStrategy({});
      expect(adjustments).toBeNull();
    });
  });

  describe('getInsights', () => {
    it('should return empty array when no data', () => {
      expect(optimizer.getInsights()).toEqual([]);
    });

    it('should warn about low success rate', () => {
      optimizer.taskTypeStats[TaskType.BUG_FIX] = { count: 5, successRate: 0.5, avgDuration: 50000 };
      const insights = optimizer.getInsights();
      expect(insights).toContainEqual(expect.objectContaining({
        type: 'warning',
        category: 'task_type',
      }));
    });

    it('should suggest extended timeout for long tasks', () => {
      optimizer.taskTypeStats[TaskType.BUG_FIX] = { count: 5, successRate: 0.9, avgDuration: 200000 };
      const insights = optimizer.getInsights();
      expect(insights).toContainEqual(expect.objectContaining({
        type: 'info',
        category: 'performance',
      }));
    });

    it('should identify best strategy', () => {
      optimizer.strategyStats[ExecutionStrategy.FAST_ITERATION] = { uses: 5, successRate: 0.9 };
      optimizer.strategyStats[ExecutionStrategy.CAREFUL_VALIDATION] = { uses: 5, successRate: 0.7 };
      const insights = optimizer.getInsights();
      expect(insights).toContainEqual(expect.objectContaining({
        type: 'info',
        category: 'strategy',
      }));
    });
  });

  describe('getSummary', () => {
    it('should return summary with all sections', () => {
      optimizer.recordTaskPerformance(TaskType.BUG_FIX, { duration: 10000, success: true });
      optimizer.recordStrategyEffectiveness(ExecutionStrategy.FAST_ITERATION, true);
      optimizer.createExecutionProfile('Test task');

      const summary = optimizer.getSummary();
      expect(summary.taskTypes).toBeDefined();
      expect(summary.strategies).toBeDefined();
      expect(summary.currentProfile).toBeDefined();
      expect(summary.insights).toBeDefined();
    });
  });
});
