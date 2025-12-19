/**
 * Tests for GoalProgress utility functions
 */
import { describe, it, expect } from 'vitest';
import {
  getProgressColor,
  formatDuration,
  formatNumber,
  calculateStepBreakdown,
  calculateComplexityBreakdown,
} from '../utils.js';

describe('GoalProgress utils', () => {
  describe('getProgressColor', () => {
    it('should return green for 80% and above', () => {
      expect(getProgressColor(80)).toBe('#22c55e');
      expect(getProgressColor(90)).toBe('#22c55e');
      expect(getProgressColor(100)).toBe('#22c55e');
    });

    it('should return yellow/orange for 50-79%', () => {
      expect(getProgressColor(50)).toBe('#f59e0b');
      expect(getProgressColor(65)).toBe('#f59e0b');
      expect(getProgressColor(79)).toBe('#f59e0b');
    });

    it('should return blue for 20-49%', () => {
      expect(getProgressColor(20)).toBe('#3b82f6');
      expect(getProgressColor(35)).toBe('#3b82f6');
      expect(getProgressColor(49)).toBe('#3b82f6');
    });

    it('should return gray for below 20%', () => {
      expect(getProgressColor(0)).toBe('#6b7280');
      expect(getProgressColor(10)).toBe('#6b7280');
      expect(getProgressColor(19)).toBe('#6b7280');
    });
  });

  describe('formatDuration', () => {
    it('should return 0s for invalid values', () => {
      expect(formatDuration(null)).toBe('0s');
      expect(formatDuration(undefined)).toBe('0s');
      expect(formatDuration(-1000)).toBe('0s');
      expect(formatDuration(0)).toBe('0s');
    });

    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(30000)).toBe('30s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
    });

    it('should format hours, minutes, and seconds', () => {
      expect(formatDuration(3600000)).toBe('1h 0m 0s');
      expect(formatDuration(5400000)).toBe('1h 30m 0s');
    });
  });

  describe('formatNumber', () => {
    it('should return 0 for invalid values', () => {
      expect(formatNumber(null)).toBe('0');
      expect(formatNumber(undefined)).toBe('0');
      expect(formatNumber(0)).toBe('0');
    });

    it('should return number as string for small numbers', () => {
      expect(formatNumber(1)).toBe('1');
      expect(formatNumber(500)).toBe('500');
      expect(formatNumber(999)).toBe('999');
    });

    it('should format thousands with K suffix', () => {
      expect(formatNumber(1000)).toBe('1.0K');
      expect(formatNumber(5500)).toBe('5.5K');
      expect(formatNumber(999999)).toBe('1000.0K');
    });

    it('should format millions with M suffix', () => {
      expect(formatNumber(1000000)).toBe('1.0M');
      expect(formatNumber(2500000)).toBe('2.5M');
    });
  });

  describe('calculateStepBreakdown', () => {
    it('should return zeros for null/undefined plan', () => {
      const result = calculateStepBreakdown(null);
      expect(result).toEqual({ pending: 0, in_progress: 0, completed: 0, failed: 0, blocked: 0 });
    });

    it('should return zeros for plan without steps', () => {
      const result = calculateStepBreakdown({ steps: null });
      expect(result).toEqual({ pending: 0, in_progress: 0, completed: 0, failed: 0, blocked: 0 });
    });

    it('should count steps by status', () => {
      const plan = {
        steps: [
          { status: 'completed' },
          { status: 'completed' },
          { status: 'failed' },
          { status: 'in_progress' },
          { status: 'pending' },
          { status: 'blocked' },
        ],
      };
      const result = calculateStepBreakdown(plan);
      expect(result.completed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.in_progress).toBe(1);
      expect(result.pending).toBe(1);
      expect(result.blocked).toBe(1);
    });

    it('should default to pending for steps without status', () => {
      const plan = { steps: [{ number: 1 }, { number: 2 }] };
      const result = calculateStepBreakdown(plan);
      expect(result.pending).toBe(2);
    });
  });

  describe('calculateComplexityBreakdown', () => {
    it('should return zeros for null/undefined plan', () => {
      const result = calculateComplexityBreakdown(null);
      expect(result).toEqual({ low: 0, medium: 0, high: 0 });
    });

    it('should return zeros for plan without steps', () => {
      const result = calculateComplexityBreakdown({ steps: null });
      expect(result).toEqual({ low: 0, medium: 0, high: 0 });
    });

    it('should count steps by complexity', () => {
      const plan = {
        steps: [
          { complexity: 'low' },
          { complexity: 'low' },
          { complexity: 'medium' },
          { complexity: 'high' },
        ],
      };
      const result = calculateComplexityBreakdown(plan);
      expect(result.low).toBe(2);
      expect(result.medium).toBe(1);
      expect(result.high).toBe(1);
    });

    it('should default to medium for steps without complexity', () => {
      const plan = { steps: [{ number: 1 }, { number: 2 }] };
      const result = calculateComplexityBreakdown(plan);
      expect(result.medium).toBe(2);
    });
  });
});
