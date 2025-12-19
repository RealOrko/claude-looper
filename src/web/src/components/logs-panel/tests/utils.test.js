/**
 * Tests for LogsPanel utility functions
 */
import { describe, it, expect } from 'vitest';
import {
  formatTime, createSearchMatcher, filterLogs,
  groupLogsByIteration, countByLevel, formatLogsForDownload
} from '../utils.js';

describe('LogsPanel utils', () => {
  describe('formatTime', () => {
    it('should return empty string for invalid values', () => {
      expect(formatTime(null)).toBe('');
      expect(formatTime(undefined)).toBe('');
    });

    it('should format timestamp with milliseconds', () => {
      const timestamp = new Date('2024-01-01T10:30:45.123Z').getTime();
      const result = formatTime(timestamp);
      expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('createSearchMatcher', () => {
    it('should return null for empty query', () => {
      expect(createSearchMatcher('', false, false)).toBeNull();
      expect(createSearchMatcher(null, false, false)).toBeNull();
    });

    it('should create case-insensitive regex by default', () => {
      const matcher = createSearchMatcher('test', false, false);
      expect(matcher.test('TEST')).toBe(true);
      matcher.lastIndex = 0; // Reset for global regex
      expect(matcher.test('test')).toBe(true);
    });

    it('should create case-sensitive regex when requested', () => {
      const matcher = createSearchMatcher('Test', false, true);
      expect(matcher.test('Test')).toBe(true);
      matcher.lastIndex = 0;
      expect(matcher.test('test')).toBe(false);
    });

    it('should handle regex mode', () => {
      const matcher = createSearchMatcher('test.*end', true, false);
      expect(matcher.test('test123end')).toBe(true);
      matcher.lastIndex = 0;
      expect(matcher.test('testend')).toBe(true);
    });

    it('should escape special chars in non-regex mode', () => {
      const matcher = createSearchMatcher('test.file', false, false);
      expect(matcher.test('test.file')).toBe(true);
      expect(matcher.test('testXfile')).toBe(false);
    });
  });

  describe('filterLogs', () => {
    const logs = [
      { level: 'info', message: 'Info message' },
      { level: 'error', message: 'Error message' },
      { level: 'warning', message: 'Warning message' },
      { level: 'debug', message: 'Debug message' },
    ];

    it('should filter by specific level', () => {
      const result = filterLogs(logs, 'error', 'debug', null);
      expect(result).toHaveLength(1);
      expect(result[0].level).toBe('error');
    });

    it('should filter by minimum level', () => {
      const result = filterLogs(logs, 'all', 'warning', null);
      expect(result).toHaveLength(2); // error and warning
    });

    it('should filter by search matcher', () => {
      const matcher = /Error/i;
      const result = filterLogs(logs, 'all', 'debug', matcher);
      expect(result).toHaveLength(1);
      expect(result[0].message).toBe('Error message');
    });
  });

  describe('groupLogsByIteration', () => {
    it('should group logs by iteration', () => {
      const logs = [
        { id: 1, iteration: 1 },
        { id: 2, iteration: 1 },
        { id: 3, iteration: 2 },
        { id: 4, iteration: 0 },
      ];
      const result = groupLogsByIteration(logs);
      expect(result).toHaveLength(3);
      // Should be sorted descending by iteration
      expect(result[0][0]).toBe(2);
      expect(result[0][1]).toHaveLength(1);
    });
  });

  describe('countByLevel', () => {
    it('should count logs by level', () => {
      const logs = [
        { level: 'info' },
        { level: 'info' },
        { level: 'error' },
      ];
      const result = countByLevel(logs);
      expect(result.info).toBe(2);
      expect(result.error).toBe(1);
    });
  });

  describe('formatLogsForDownload', () => {
    it('should format logs for download', () => {
      const logs = [
        { timestamp: Date.now(), level: 'info', message: 'Test', iteration: 1 },
      ];
      const result = formatLogsForDownload(logs);
      expect(result).toContain('[INFO]');
      expect(result).toContain('[#1]');
      expect(result).toContain('Test');
    });
  });
});
