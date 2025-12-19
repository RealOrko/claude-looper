/**
 * Tests for MetricsPanel utility functions
 */
import { describe, it, expect } from 'vitest';
import {
  formatDuration, formatTime, parseDuration,
  calculateDerivedMetrics, calculateStepTimings,
  calculateComplexityStats, calculateRetryHistory
} from '../utils.js';

describe('MetricsPanel utils', () => {
  describe('formatDuration', () => {
    it('should return 0s for invalid values', () => {
      expect(formatDuration(null)).toBe('0s');
      expect(formatDuration(undefined)).toBe('0s');
      expect(formatDuration(-1000)).toBe('0s');
    });

    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(30000)).toBe('30s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
    });

    it('should format hours, minutes and seconds', () => {
      expect(formatDuration(3600000)).toBe('1h 0m 0s');
      expect(formatDuration(3661000)).toBe('1h 1m 1s');
    });
  });

  describe('formatTime', () => {
    it('should return empty string for invalid values', () => {
      expect(formatTime(null)).toBe('');
      expect(formatTime(undefined)).toBe('');
    });

    it('should format timestamp to time string', () => {
      const timestamp = new Date('2024-01-01T10:30:45.000Z').getTime();
      const result = formatTime(timestamp);
      expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('parseDuration', () => {
    it('should return 0 for invalid values', () => {
      expect(parseDuration(null)).toBe(0);
      expect(parseDuration('')).toBe(0);
      expect(parseDuration('invalid')).toBe(0);
    });

    it('should parse hours', () => {
      expect(parseDuration('1h')).toBe(3600000);
      expect(parseDuration('2h')).toBe(7200000);
    });

    it('should parse minutes', () => {
      expect(parseDuration('30m')).toBe(1800000);
      expect(parseDuration('1m')).toBe(60000);
    });

    it('should parse seconds', () => {
      expect(parseDuration('30s')).toBe(30000);
      expect(parseDuration('1s')).toBe(1000);
    });
  });

  describe('calculateDerivedMetrics', () => {
    it('should calculate metrics from state', () => {
      const result = calculateDerivedMetrics({
        plan: { steps: [{}, {}, {}] },
        completedSteps: [{}, {}],
        failedSteps: [{}],
        timeElapsed: 60000,
        iteration: 5,
      });

      expect(result.totalSteps).toBe(3);
      expect(result.completed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.pending).toBe(0);
    });

    it('should handle empty state', () => {
      const result = calculateDerivedMetrics({});
      expect(result.totalSteps).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.successRate).toBe(100);
    });
  });

  describe('calculateStepTimings', () => {
    it('should return empty array for no steps', () => {
      expect(calculateStepTimings(null)).toEqual([]);
      expect(calculateStepTimings([])).toEqual([]);
    });

    it('should calculate step timings', () => {
      const steps = [
        { number: 1, duration: 5000, complexity: 'low' },
        { number: 2, duration: 10000, complexity: 'high' },
      ];
      const result = calculateStepTimings(steps);
      expect(result).toHaveLength(2);
      expect(result[0].duration).toBe(5);
      expect(result[1].duration).toBe(10);
    });
  });

  describe('calculateComplexityStats', () => {
    it('should return empty array for no steps', () => {
      expect(calculateComplexityStats(null)).toEqual([]);
      expect(calculateComplexityStats([])).toEqual([]);
    });

    it('should calculate complexity statistics', () => {
      const steps = [
        { duration: 5000, complexity: 'low' },
        { duration: 10000, complexity: 'low' },
        { duration: 20000, complexity: 'high' },
      ];
      const result = calculateComplexityStats(steps);
      const lowStats = result.find(s => s.complexity === 'low');
      expect(lowStats.count).toBe(2);
      expect(lowStats.avgTime).toBe(8); // (5+10)/2 = 7.5 rounded
    });
  });

  describe('calculateRetryHistory', () => {
    it('should return empty array for no retries', () => {
      expect(calculateRetryHistory(null)).toEqual([]);
      expect(calculateRetryHistory({})).toEqual([]);
    });

    it('should calculate retry history', () => {
      const retryMode = {
        attempts: [
          { number: 1, confidence: 'LOW', duration: 5000, completedSteps: 3, failedSteps: 1 },
          { number: 2, confidence: 'HIGH', duration: 3000, completedSteps: 4, failedSteps: 0 },
        ]
      };
      const result = calculateRetryHistory(retryMode);
      expect(result).toHaveLength(2);
      expect(result[0].number).toBe(1);
      expect(result[0].duration).toBe(5);
    });
  });
});
