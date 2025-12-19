/**
 * Tests for dashboard/time-utils.js
 */
import { describe, it, expect } from 'vitest';
import { parseTimeLimit, formatDuration, calculateTimeInfo, getTimeColor } from '../time-utils.js';

describe('dashboard/time-utils', () => {
  describe('parseTimeLimit', () => {
    it('should parse minutes', () => {
      expect(parseTimeLimit('30m')).toBe(30 * 60 * 1000);
      expect(parseTimeLimit('1m')).toBe(60 * 1000);
      expect(parseTimeLimit('90m')).toBe(90 * 60 * 1000);
    });

    it('should parse hours', () => {
      expect(parseTimeLimit('1h')).toBe(60 * 60 * 1000);
      expect(parseTimeLimit('2h')).toBe(2 * 60 * 60 * 1000);
    });

    it('should parse days', () => {
      expect(parseTimeLimit('1d')).toBe(24 * 60 * 60 * 1000);
    });

    it('should default to hours without unit', () => {
      expect(parseTimeLimit('2')).toBe(2 * 60 * 60 * 1000);
    });

    it('should return default 2h for invalid input', () => {
      expect(parseTimeLimit('invalid')).toBe(2 * 60 * 60 * 1000);
      expect(parseTimeLimit('')).toBe(2 * 60 * 60 * 1000);
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms');
      expect(formatDuration(999)).toBe('999ms');
    });

    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(45000)).toBe('45s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('should format hours and minutes', () => {
      expect(formatDuration(3600000)).toBe('1h 0m');
      expect(formatDuration(5400000)).toBe('1h 30m');
      expect(formatDuration(7200000)).toBe('2h 0m');
    });
  });

  describe('calculateTimeInfo', () => {
    it('should calculate time info correctly', () => {
      const info = calculateTimeInfo(1800000, '1h'); // 30min elapsed of 1h

      expect(info.elapsed).toBe('30m 0s');
      expect(info.remaining).toBe('30m 0s');
      expect(info.percentUsed).toBe(50);
      expect(info.percentRemaining).toBe(50);
    });

    it('should handle zero elapsed time', () => {
      const info = calculateTimeInfo(0, '1h');

      expect(info.percentUsed).toBe(0);
      expect(info.percentRemaining).toBe(100);
    });

    it('should cap remaining at 0', () => {
      const info = calculateTimeInfo(7200000, '1h'); // 2h elapsed of 1h

      expect(info.remaining).toBe('0ms');
      expect(info.percentRemaining).toBe(0);
    });
  });

  describe('getTimeColor', () => {
    it('should return green for > 20% remaining', () => {
      expect(getTimeColor(50)).toBe('green');
      expect(getTimeColor(21)).toBe('green');
    });

    it('should return yellow for 5-20% remaining', () => {
      expect(getTimeColor(20)).toBe('yellow');
      expect(getTimeColor(6)).toBe('yellow');
    });

    it('should return red for <= 5% remaining', () => {
      expect(getTimeColor(5)).toBe('red');
      expect(getTimeColor(0)).toBe('red');
    });
  });
});
