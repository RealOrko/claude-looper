import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsCollector } from '../metrics-collector.js';

describe('MetricsCollector', () => {
  let collector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(collector.startTime).toBeNull();
      expect(collector.endTime).toBeNull();
      expect(collector.currentIteration).toBe(0);
      expect(collector.steps.total).toBe(0);
      expect(collector.tokens.total).toBe(0);
    });
  });

  describe('session management', () => {
    it('should start session with timestamp', () => {
      collector.startSession();
      expect(collector.startTime).toBeTypeOf('number');
    });

    it('should end session and calculate metrics', () => {
      collector.startSession();
      collector.endSession();
      expect(collector.endTime).toBeTypeOf('number');
    });
  });

  describe('iteration tracking', () => {
    it('should track iterations', () => {
      collector.startIteration();
      expect(collector.currentIteration).toBe(1);
      expect(collector.iterationStart).toBeTypeOf('number');
    });

    it('should record iteration end with duration', () => {
      collector.startIteration();
      collector.endIteration();
      expect(collector.timings.iterations).toHaveLength(1);
      expect(collector.timings.iterations[0].iteration).toBe(1);
    });

    it('should track token usage per iteration', () => {
      collector.startIteration();
      collector.endIteration({ total: 1000 });
      expect(collector.tokens.total).toBe(1000);
      expect(collector.tokens.perIteration).toHaveLength(1);
    });
  });

  describe('planning time tracking', () => {
    it('should record planning time', () => {
      collector.recordPlanningTime(5000, 10);
      expect(collector.timings.planning).toHaveLength(1);
      expect(collector.steps.total).toBe(10);
    });

    it('should keep max step count', () => {
      collector.recordPlanningTime(1000, 5);
      collector.recordPlanningTime(1000, 10);
      collector.recordPlanningTime(1000, 7);
      expect(collector.steps.total).toBe(10);
    });
  });

  describe('step execution tracking', () => {
    it('should record completed steps', () => {
      collector.recordStepExecution(1, 'completed', 5000);
      expect(collector.steps.completed).toBe(1);
      expect(collector.timings.stepExecution).toHaveLength(1);
    });

    it('should record failed steps', () => {
      collector.recordStepExecution(1, 'failed', 3000);
      expect(collector.steps.failed).toBe(1);
    });

    it('should record skipped steps', () => {
      collector.recordStepExecution(1, 'skipped', 100);
      expect(collector.steps.skipped).toBe(1);
    });

    it('should track token usage per step', () => {
      collector.recordStepExecution(1, 'completed', 5000, { tokens: 500 });
      expect(collector.tokens.perStep).toHaveLength(1);
    });
  });

  describe('parallel execution tracking', () => {
    it('should record parallel batches', () => {
      collector.recordParallelBatch(3);
      expect(collector.steps.parallelBatches).toBe(1);
      expect(collector.steps.maxParallelSteps).toBe(3);
    });

    it('should track max parallel steps', () => {
      collector.recordParallelBatch(2);
      collector.recordParallelBatch(4);
      collector.recordParallelBatch(3);
      expect(collector.steps.maxParallelSteps).toBe(4);
    });

    it('should calculate parallel speedup', () => {
      const results = [
        { step: { number: 1, complexity: 'medium' }, duration: 1000, success: true },
        { step: { number: 2, complexity: 'medium' }, duration: 1500, success: true },
      ];
      collector.recordParallelExecution(2, results);
      expect(collector.efficiency.parallelSpeedup).toBeGreaterThan(1);
    });
  });

  describe('supervision tracking', () => {
    it('should record supervision checks', () => {
      collector.recordSupervision({ assessment: { score: 85 } }, 500);
      expect(collector.supervision.totalChecks).toBe(1);
      expect(collector.supervision.scoreHistory).toContain(85);
    });

    it('should track interventions', () => {
      collector.recordSupervision({ needsIntervention: true }, 500);
      expect(collector.supervision.interventions).toBe(1);
    });

    it('should track corrections', () => {
      collector.recordSupervision({ correction: true }, 500);
      expect(collector.supervision.corrections).toBe(1);
    });

    it('should track escalations', () => {
      collector.recordSupervision({ escalated: true }, 500);
      expect(collector.supervision.escalations).toBe(1);
    });

    it('should track recovery attempts', () => {
      collector.recordSupervision({ autoRecovery: true }, 500);
      expect(collector.supervision.recoveryAttempts).toBe(1);
    });

    it('should record recovery success', () => {
      collector.recordRecoverySuccess();
      expect(collector.supervision.recoverySuccesses).toBe(1);
    });
  });

  describe('verification tracking', () => {
    it('should record verification results', () => {
      collector.recordVerification(2000, true);
      expect(collector.timings.verification).toHaveLength(1);
      expect(collector.timings.verification[0].passed).toBe(true);
    });
  });

  describe('error tracking', () => {
    it('should record errors by type', () => {
      collector.recordError('timeout');
      collector.recordError('timeout');
      collector.recordError('api_error');
      expect(collector.errors.total).toBe(3);
      expect(collector.errors.byType.timeout).toBe(2);
      expect(collector.errors.byType.api_error).toBe(1);
    });

    it('should track recovered errors', () => {
      collector.recordError('timeout', true);
      expect(collector.errors.recoveredErrors).toBe(1);
    });
  });

  describe('token savings', () => {
    it('should track token savings', () => {
      collector.recordTokenSavings(500);
      collector.recordTokenSavings(300);
      expect(collector.tokens.saved).toBe(800);
    });
  });

  describe('sub-plan tracking', () => {
    it('should track sub-plan usage', () => {
      collector.recordSubPlanUsage();
      collector.recordSubPlanUsage();
      expect(collector.steps.retriedViaSubPlan).toBe(2);
    });
  });

  describe('final metrics calculation', () => {
    it('should calculate steps per hour', () => {
      collector.startTime = Date.now() - 3600000; // 1 hour ago
      collector.steps.completed = 10;
      collector.calculateFinalMetrics();
      expect(collector.efficiency.stepsPerHour).toBeCloseTo(10, 0);
    });

    it('should calculate average step time', () => {
      collector.recordStepExecution(1, 'completed', 1000);
      collector.recordStepExecution(2, 'completed', 2000);
      collector.recordStepExecution(3, 'completed', 3000);
      collector.calculateFinalMetrics();
      expect(collector.efficiency.avgStepTime).toBe(2000);
    });

    it('should calculate token efficiency', () => {
      collector.tokens.total = 800;
      collector.tokens.saved = 200;
      collector.calculateFinalMetrics();
      expect(collector.efficiency.tokenEfficiency).toBe(20);
    });
  });

  describe('reporting methods', () => {
    it('should delegate getSummary to reporter', () => {
      collector.startSession();
      const summary = collector.getSummary();
      expect(summary).toHaveProperty('duration');
      expect(summary).toHaveProperty('steps');
      expect(summary).toHaveProperty('tokens');
    });

    it('should delegate getTimingBreakdown to reporter', () => {
      const breakdown = collector.getTimingBreakdown();
      expect(breakdown).toHaveProperty('planning');
      expect(breakdown).toHaveProperty('stepExecution');
    });

    it('should delegate getTrends to reporter', () => {
      const trends = collector.getTrends();
      expect(trends).toHaveProperty('iteration');
      expect(trends).toHaveProperty('score');
    });

    it('should delegate toJSON to reporter', () => {
      collector.startSession();
      const json = collector.toJSON();
      expect(json).toHaveProperty('summary');
      expect(json).toHaveProperty('timing');
      expect(json).toHaveProperty('trends');
      expect(json).toHaveProperty('raw');
    });
  });
});
