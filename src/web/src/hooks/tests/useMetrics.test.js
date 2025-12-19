/**
 * Tests for useMetrics.js
 */
import { describe, it, expect } from 'vitest';
import { parseDuration, formatDuration } from '../useMetrics.js';

describe('useMetrics', () => {
  describe('parseDuration', () => {
    it('should parse seconds', () => {
      expect(parseDuration('30s')).toBe(30000);
      expect(parseDuration('1s')).toBe(1000);
    });

    it('should parse minutes', () => {
      expect(parseDuration('30m')).toBe(30 * 60 * 1000);
      expect(parseDuration('1m')).toBe(60 * 1000);
    });

    it('should parse hours', () => {
      expect(parseDuration('2h')).toBe(2 * 60 * 60 * 1000);
      expect(parseDuration('1h')).toBe(60 * 60 * 1000);
    });

    it('should parse days', () => {
      expect(parseDuration('1d')).toBe(24 * 60 * 60 * 1000);
    });

    it('should default to hours without unit', () => {
      expect(parseDuration('2')).toBe(2 * 60 * 60 * 1000);
    });

    it('should return 0 for invalid input', () => {
      expect(parseDuration('')).toBe(0);
      expect(parseDuration(null)).toBe(0);
      expect(parseDuration('invalid')).toBe(0);
    });

    it('should handle number input', () => {
      expect(parseDuration(5000)).toBe(5000);
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(30000)).toBe('30s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('should format hours and minutes', () => {
      expect(formatDuration(3600000)).toBe('1h 0m 0s');
      expect(formatDuration(5400000)).toBe('1h 30m 0s');
    });

    it('should return 0s for invalid input', () => {
      expect(formatDuration(0)).toBe('0s');
      expect(formatDuration(null)).toBe('0s');
      expect(formatDuration(-1000)).toBe('0s');
    });
  });
});
