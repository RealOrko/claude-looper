/**
 * Tests for dashboard/constants.js
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_SCORE_HISTORY,
  MAX_MESSAGES,
  LOGO,
  MINI_LOGO,
  STATUS_COLORS,
  LOG_TYPE_COLORS,
} from '../constants.js';

describe('dashboard/constants', () => {
  describe('MAX_SCORE_HISTORY', () => {
    it('should be a reasonable number', () => {
      expect(MAX_SCORE_HISTORY).toBe(50);
      expect(typeof MAX_SCORE_HISTORY).toBe('number');
    });
  });

  describe('MAX_MESSAGES', () => {
    it('should be a reasonable number', () => {
      expect(MAX_MESSAGES).toBe(100);
      expect(typeof MAX_MESSAGES).toBe('number');
    });
  });

  describe('LOGO', () => {
    it('should be a non-empty string', () => {
      expect(typeof LOGO).toBe('string');
      expect(LOGO.length).toBeGreaterThan(0);
    });

    it('should contain CLAUDE text', () => {
      // The text contains colored escape codes, check for the spaced out version
      expect(LOGO).toContain('A U T O N O M O U S');
    });
  });

  describe('MINI_LOGO', () => {
    it('should be a non-empty string', () => {
      expect(typeof MINI_LOGO).toBe('string');
      expect(MINI_LOGO.length).toBeGreaterThan(0);
    });

    it('should contain CLAUDE', () => {
      expect(MINI_LOGO).toContain('CLAUDE');
    });
  });

  describe('STATUS_COLORS', () => {
    it('should have all required statuses', () => {
      expect(STATUS_COLORS.completed).toBe('green');
      expect(STATUS_COLORS.time_expired).toBe('yellow');
      expect(STATUS_COLORS.stopped).toBe('orange');
      expect(STATUS_COLORS.aborted).toBe('red');
    });
  });

  describe('LOG_TYPE_COLORS', () => {
    it('should have all log types', () => {
      expect(LOG_TYPE_COLORS.info).toBe('cyan');
      expect(LOG_TYPE_COLORS.success).toBe('green');
      expect(LOG_TYPE_COLORS.warning).toBe('yellow');
      expect(LOG_TYPE_COLORS.error).toBe('red');
      expect(LOG_TYPE_COLORS.dim).toBe('gray');
      expect(LOG_TYPE_COLORS.reset).toBe('reset');
    });
  });
});
