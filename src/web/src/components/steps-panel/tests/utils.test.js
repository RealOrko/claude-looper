/**
 * Tests for StepsPanel utility functions
 */
import { describe, it, expect } from 'vitest';
import { formatDuration, truncateText, calculateStepStats } from '../utils.js';

describe('StepsPanel utils', () => {
  describe('formatDuration', () => {
    it('should return 0s for invalid values', () => {
      expect(formatDuration(null)).toBe('0s');
      expect(formatDuration(undefined)).toBe('0s');
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

  describe('truncateText', () => {
    it('should return empty string for invalid values', () => {
      expect(truncateText(null)).toBe('');
      expect(truncateText(undefined)).toBe('');
      expect(truncateText('')).toBe('');
    });

    it('should return full text if shorter than max', () => {
      expect(truncateText('hello', 10)).toBe('hello');
    });

    it('should truncate with ellipsis if longer than max', () => {
      expect(truncateText('hello world', 8)).toBe('hello...');
    });
  });

  describe('calculateStepStats', () => {
    it('should calculate step statistics', () => {
      const steps = [
        { status: 'completed' },
        { status: 'completed' },
        { status: 'failed' },
        { status: 'blocked' },
        { status: 'in_progress' },
        { status: 'pending' },
        { }, // no status defaults to pending
      ];
      const result = calculateStepStats(steps);
      expect(result.completed).toBe(2);
      expect(result.failed).toBe(2); // failed + blocked
      expect(result.inProgress).toBe(1);
      expect(result.pending).toBe(2); // pending + no status
    });

    it('should handle empty steps', () => {
      const result = calculateStepStats([]);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.inProgress).toBe(0);
      expect(result.pending).toBe(0);
    });
  });
});
