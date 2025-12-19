/**
 * Tests for DAG constants
 */
import { describe, it, expect } from 'vitest';
import {
  statusColorValues,
  complexityColors,
  DEFAULT_VIEWPORT,
  ZOOM_LIMITS,
  NODE_DEFAULTS,
} from '../constants.js';

describe('DAG constants', () => {
  describe('statusColorValues', () => {
    it('should have all required status colors', () => {
      expect(statusColorValues.completed).toBe('#22c55e');
      expect(statusColorValues.failed).toBe('#ef4444');
      expect(statusColorValues.blocked).toBe('#f59e0b');
      expect(statusColorValues.in_progress).toBe('#3b82f6');
      expect(statusColorValues.pending).toBe('#6b7280');
    });

    it('should have 5 status colors', () => {
      expect(Object.keys(statusColorValues)).toHaveLength(5);
    });
  });

  describe('complexityColors', () => {
    it('should have all complexity level colors', () => {
      expect(complexityColors.low).toBe('#22c55e');
      expect(complexityColors.medium).toBe('#f59e0b');
      expect(complexityColors.high).toBe('#ef4444');
    });

    it('should have 3 complexity colors', () => {
      expect(Object.keys(complexityColors)).toHaveLength(3);
    });
  });

  describe('DEFAULT_VIEWPORT', () => {
    it('should have default dimensions', () => {
      expect(DEFAULT_VIEWPORT.width).toBe(600);
      expect(DEFAULT_VIEWPORT.height).toBe(400);
    });
  });

  describe('ZOOM_LIMITS', () => {
    it('should have valid zoom limits', () => {
      expect(ZOOM_LIMITS.min).toBe(0.25);
      expect(ZOOM_LIMITS.max).toBe(3);
      expect(ZOOM_LIMITS.step).toBe(0.25);
    });

    it('should have min less than max', () => {
      expect(ZOOM_LIMITS.min).toBeLessThan(ZOOM_LIMITS.max);
    });
  });

  describe('NODE_DEFAULTS', () => {
    it('should have default node dimensions', () => {
      expect(NODE_DEFAULTS.width).toBe(180);
      expect(NODE_DEFAULTS.height).toBe(60);
    });
  });
});
