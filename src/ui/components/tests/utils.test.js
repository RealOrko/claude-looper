/**
 * Tests for utils.js
 */
import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  STATUS_CONFIGS,
  LOG_CONFIGS,
  getProgressColor,
  getScoreColor,
} from '../utils.js';

describe('utils', () => {
  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms');
      expect(formatDuration(999)).toBe('999ms');
    });

    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(59000)).toBe('59s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(3599000)).toBe('59m 59s');
    });

    it('should format hours and minutes', () => {
      expect(formatDuration(3600000)).toBe('1h 0m');
      expect(formatDuration(5400000)).toBe('1h 30m');
      expect(formatDuration(7200000)).toBe('2h 0m');
    });
  });

  describe('STATUS_CONFIGS', () => {
    it('should have all required statuses', () => {
      expect(STATUS_CONFIGS.initializing).toBeDefined();
      expect(STATUS_CONFIGS.planning).toBeDefined();
      expect(STATUS_CONFIGS.running).toBeDefined();
      expect(STATUS_CONFIGS.verifying).toBeDefined();
      expect(STATUS_CONFIGS.completed).toBeDefined();
      expect(STATUS_CONFIGS.error).toBeDefined();
      expect(STATUS_CONFIGS.aborted).toBeDefined();
      expect(STATUS_CONFIGS.stopped).toBeDefined();
    });

    it('should have color and label for each status', () => {
      Object.values(STATUS_CONFIGS).forEach(config => {
        expect(config.color).toBeDefined();
        expect(config.label).toBeDefined();
      });
    });
  });

  describe('LOG_CONFIGS', () => {
    it('should have all log types', () => {
      expect(LOG_CONFIGS.info).toBeDefined();
      expect(LOG_CONFIGS.success).toBeDefined();
      expect(LOG_CONFIGS.warning).toBeDefined();
      expect(LOG_CONFIGS.error).toBeDefined();
      expect(LOG_CONFIGS.supervision).toBeDefined();
    });

    it('should have color and icon for each type', () => {
      Object.values(LOG_CONFIGS).forEach(config => {
        expect(config.color).toBeDefined();
        expect(config.icon).toBeDefined();
      });
    });
  });

  describe('getProgressColor', () => {
    it('should return green for high progress', () => {
      expect(getProgressColor(100)).toBe('green');
      expect(getProgressColor(70)).toBe('green');
    });

    it('should return yellow for medium progress', () => {
      expect(getProgressColor(69)).toBe('yellow');
      expect(getProgressColor(40)).toBe('yellow');
    });

    it('should return cyan for low progress', () => {
      expect(getProgressColor(39)).toBe('cyan');
      expect(getProgressColor(0)).toBe('cyan');
    });
  });

  describe('getScoreColor', () => {
    it('should return green for high scores', () => {
      expect(getScoreColor(100)).toBe('green');
      expect(getScoreColor(70)).toBe('green');
    });

    it('should return yellow for medium scores', () => {
      expect(getScoreColor(69)).toBe('yellow');
      expect(getScoreColor(40)).toBe('yellow');
    });

    it('should return red for low scores', () => {
      expect(getScoreColor(39)).toBe('red');
      expect(getScoreColor(0)).toBe('red');
    });
  });
});
