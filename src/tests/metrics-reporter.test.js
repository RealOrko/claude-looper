import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsReporter } from '../metrics-reporter.js';

describe('MetricsReporter', () => {
  let reporter;
  let mockCollector;

  beforeEach(() => {
    mockCollector = {
      startTime: Date.now() - 3600000,
      endTime: Date.now(),
      timings: {
        planning: [{ duration: 5000, stepCount: 10, timestamp: Date.now() }],
        stepExecution: [
          { stepNumber: 1, status: 'completed', duration: 10000, timestamp: Date.now() },
          { stepNumber: 2, status: 'completed', duration: 15000, timestamp: Date.now() },
        ],
        supervision: [{ duration: 500, timestamp: Date.now() }],
        verification: [{ duration: 2000, passed: true, timestamp: Date.now() }],
        iterations: [
          { iteration: 1, duration: 30000, timestamp: Date.now() },
          { iteration: 2, duration: 25000, timestamp: Date.now() },
        ],
      },
      steps: { total: 10, completed: 8, failed: 1, skipped: 1, retriedViaSubPlan: 2, parallelBatches: 3, maxParallelSteps: 4 },
      tokens: { total: 5000, saved: 1000, perIteration: [{ iteration: 1, total: 2500 }], perStep: [] },
      supervision: { totalChecks: 10, interventions: 2, corrections: 1, escalations: 0, recoveryAttempts: 3, recoverySuccesses: 2, scoreHistory: [80, 85, 90] },
      errors: { total: 5, byType: { timeout: 3, api_error: 2 }, recoveredErrors: 3 },
      efficiency: { stepsPerHour: 8, avgStepTime: 12500, parallelSpeedup: 1.5, tokenEfficiency: 20 },
      currentIteration: 10,
      calculateFinalMetrics: () => {},
    };
    reporter = new MetricsReporter(mockCollector);
  });

  describe('getSummary', () => {
    it('should return duration info', () => {
      const summary = reporter.getSummary();
      expect(summary.duration).toBeDefined();
      expect(summary.duration.totalMs).toBeTypeOf('number');
    });

    it('should return steps info', () => {
      const summary = reporter.getSummary();
      expect(summary.steps.total).toBe(10);
      expect(summary.steps.completed).toBe(8);
      expect(summary.steps.successRate).toBe(80);
    });

    it('should return parallel execution info', () => {
      const summary = reporter.getSummary();
      expect(summary.parallelExecution.batches).toBe(3);
      expect(summary.parallelExecution.maxConcurrent).toBe(4);
    });

    it('should return token info', () => {
      const summary = reporter.getSummary();
      expect(summary.tokens.total).toBe(5000);
      expect(summary.tokens.saved).toBe(1000);
    });

    it('should return supervision info', () => {
      const summary = reporter.getSummary();
      expect(summary.supervision.totalChecks).toBe(10);
      expect(summary.supervision.interventionRate).toBe(20);
      expect(summary.supervision.avgScore).toBe(85);
    });

    it('should return error info', () => {
      const summary = reporter.getSummary();
      expect(summary.errors.total).toBe(5);
      expect(summary.errors.recoveryRate).toBe(60);
    });

    it('should return efficiency info', () => {
      const summary = reporter.getSummary();
      expect(summary.efficiency.stepsPerHour).toBe(8);
      expect(summary.efficiency.iterations).toBe(10);
    });
  });

  describe('getTimingBreakdown', () => {
    it('should return all timing categories', () => {
      const breakdown = reporter.getTimingBreakdown();
      expect(breakdown.planning).toHaveLength(1);
      expect(breakdown.stepExecution).toHaveLength(2);
      expect(breakdown.supervision).toHaveLength(1);
      expect(breakdown.verification).toHaveLength(1);
    });

    it('should limit iterations to last 20', () => {
      mockCollector.timings.iterations = Array(30).fill({ iteration: 1, duration: 1000, timestamp: Date.now() });
      const breakdown = reporter.getTimingBreakdown();
      expect(breakdown.iterations).toHaveLength(20);
    });
  });

  describe('getTrends', () => {
    it('should analyze iteration trends', () => {
      mockCollector.timings.iterations = [
        ...Array(10).fill({ duration: 30000, timestamp: Date.now() }),
        ...Array(10).fill({ duration: 20000, timestamp: Date.now() }),
      ];
      const trends = reporter.getTrends();
      expect(trends.iteration.trend).toBe('improving');
    });

    it('should detect slowing iterations', () => {
      mockCollector.timings.iterations = [
        ...Array(10).fill({ duration: 20000, timestamp: Date.now() }),
        ...Array(10).fill({ duration: 30000, timestamp: Date.now() }),
      ];
      const trends = reporter.getTrends();
      expect(trends.iteration.trend).toBe('slowing');
    });

    it('should detect stable iterations', () => {
      mockCollector.timings.iterations = Array(20).fill({ duration: 25000, timestamp: Date.now() });
      const trends = reporter.getTrends();
      expect(trends.iteration.trend).toBe('stable');
    });

    it('should analyze score trends', () => {
      mockCollector.supervision.scoreHistory = [...Array(10).fill(70), ...Array(10).fill(85)];
      const trends = reporter.getTrends();
      expect(trends.score.trend).toBe('improving');
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      expect(reporter.formatDuration(500)).toBe('500ms');
    });

    it('should format seconds', () => {
      expect(reporter.formatDuration(5000)).toBe('5s');
    });

    it('should format minutes and seconds', () => {
      expect(reporter.formatDuration(90000)).toBe('1m 30s');
    });

    it('should format hours and minutes', () => {
      expect(reporter.formatDuration(5400000)).toBe('1h 30m');
    });
  });

  describe('getAverageDuration', () => {
    it('should calculate average', () => {
      const entries = [{ duration: 100 }, { duration: 200 }, { duration: 300 }];
      expect(reporter.getAverageDuration(entries)).toBe(200);
    });

    it('should return 0 for empty array', () => {
      expect(reporter.getAverageDuration([])).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(reporter.getAverageDuration(null)).toBe(0);
      expect(reporter.getAverageDuration(undefined)).toBe(0);
    });
  });

  describe('toJSON', () => {
    it('should include all sections', () => {
      const json = reporter.toJSON();
      expect(json.summary).toBeDefined();
      expect(json.timing).toBeDefined();
      expect(json.trends).toBeDefined();
      expect(json.raw).toBeDefined();
    });

    it('should include raw data', () => {
      const json = reporter.toJSON();
      expect(json.raw.steps).toBe(mockCollector.steps);
      expect(json.raw.tokens).toBe(mockCollector.tokens);
    });
  });
});
