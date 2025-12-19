import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatDurationCompact,
  formatTime,
  truncateText,
  formatPercent,
  formatNumber,
} from './formatters.js';

describe('formatDuration', () => {
  it('should return "0s" for falsy values', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(null)).toBe('0s');
    expect(formatDuration(undefined)).toBe('0s');
    expect(formatDuration(-100)).toBe('0s');
  });

  it('should format seconds only', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(45000)).toBe('45s');
  });

  it('should format minutes and seconds', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(125000)).toBe('2m 5s');
  });

  it('should format hours, minutes, and seconds', () => {
    expect(formatDuration(3600000)).toBe('1h 0m 0s');
    expect(formatDuration(3661000)).toBe('1h 1m 1s');
    expect(formatDuration(7320000)).toBe('2h 2m 0s');
  });
});

describe('formatDurationCompact', () => {
  it('should return "0:00" for falsy values', () => {
    expect(formatDurationCompact(0)).toBe('0:00');
    expect(formatDurationCompact(null)).toBe('0:00');
    expect(formatDurationCompact(undefined)).toBe('0:00');
    expect(formatDurationCompact(-100)).toBe('0:00');
  });

  it('should format as MM:SS for under an hour', () => {
    expect(formatDurationCompact(1000)).toBe('0:01');
    expect(formatDurationCompact(60000)).toBe('1:00');
    expect(formatDurationCompact(90000)).toBe('1:30');
    expect(formatDurationCompact(125000)).toBe('2:05');
  });

  it('should format as HH:MM:SS for over an hour', () => {
    expect(formatDurationCompact(3600000)).toBe('1:00:00');
    expect(formatDurationCompact(3661000)).toBe('1:01:01');
    expect(formatDurationCompact(7320000)).toBe('2:02:00');
  });
});

describe('formatTime', () => {
  it('should return empty string for falsy values', () => {
    expect(formatTime(0)).toBe('');
    expect(formatTime(null)).toBe('');
    expect(formatTime(undefined)).toBe('');
  });

  it('should format timestamp to time string', () => {
    // Use a known timestamp - midnight UTC on Jan 1, 2024
    const timestamp = new Date('2024-01-01T12:30:45Z').getTime();
    const result = formatTime(timestamp);
    // Check it contains time-like format (varies by timezone)
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('truncateText', () => {
  it('should return empty string for falsy values', () => {
    expect(truncateText(null)).toBe('');
    expect(truncateText(undefined)).toBe('');
    expect(truncateText('')).toBe('');
  });

  it('should not truncate short text', () => {
    expect(truncateText('Hello', 10)).toBe('Hello');
    expect(truncateText('Short', 50)).toBe('Short');
  });

  it('should truncate long text with ellipsis', () => {
    expect(truncateText('This is a very long text', 10)).toBe('This is...');
    expect(truncateText('Hello World', 8)).toBe('Hello...');
  });

  it('should use default max length of 50', () => {
    const longText = 'A'.repeat(60);
    expect(truncateText(longText).length).toBe(50);
    expect(truncateText(longText)).toMatch(/\.\.\.$/);
  });
});

describe('formatPercent', () => {
  it('should return "0%" for invalid values', () => {
    expect(formatPercent(null)).toBe('0%');
    expect(formatPercent(undefined)).toBe('0%');
    expect(formatPercent(NaN)).toBe('0%');
  });

  it('should format percentage with one decimal', () => {
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(50)).toBe('50.0%');
    expect(formatPercent(75.5)).toBe('75.5%');
    expect(formatPercent(100)).toBe('100.0%');
  });

  it('should handle floating point values', () => {
    expect(formatPercent(33.333)).toBe('33.3%');
    expect(formatPercent(66.666)).toBe('66.7%');
  });
});

describe('formatNumber', () => {
  it('should return "0" for invalid values', () => {
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
    expect(formatNumber(NaN)).toBe('0');
  });

  it('should format small numbers without separator', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(100)).toBe('100');
    expect(formatNumber(999)).toBe('999');
  });

  it('should format large numbers with thousand separators', () => {
    expect(formatNumber(1000)).toMatch(/1[,.]?000/);
    expect(formatNumber(1000000)).toMatch(/1[,.]?000[,.]?000/);
  });
});
