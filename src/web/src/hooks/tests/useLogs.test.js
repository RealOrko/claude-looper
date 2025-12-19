/**
 * Tests for useLogs.js
 */
import { describe, it, expect } from 'vitest';
import { LOG_LEVELS } from '../useLogs.js';

describe('useLogs', () => {
  describe('LOG_LEVELS', () => {
    describe('icons', () => {
      it('should have all log level icons', () => {
        expect(LOG_LEVELS.icons.info).toBeDefined();
        expect(LOG_LEVELS.icons.success).toBeDefined();
        expect(LOG_LEVELS.icons.warning).toBeDefined();
        expect(LOG_LEVELS.icons.error).toBeDefined();
        expect(LOG_LEVELS.icons.output).toBeDefined();
        expect(LOG_LEVELS.icons.debug).toBeDefined();
      });
    });

    describe('colors', () => {
      it('should have all log level colors', () => {
        expect(LOG_LEVELS.colors.info).toBe('#3b82f6');
        expect(LOG_LEVELS.colors.success).toBe('#22c55e');
        expect(LOG_LEVELS.colors.warning).toBe('#f59e0b');
        expect(LOG_LEVELS.colors.error).toBe('#ef4444');
        expect(LOG_LEVELS.colors.output).toBe('#8b5cf6');
        expect(LOG_LEVELS.colors.debug).toBe('#6b7280');
      });
    });

    describe('priority', () => {
      it('should have correct priority ordering', () => {
        expect(LOG_LEVELS.priority.error).toBeGreaterThan(LOG_LEVELS.priority.warning);
        expect(LOG_LEVELS.priority.warning).toBeGreaterThan(LOG_LEVELS.priority.success);
        expect(LOG_LEVELS.priority.success).toBeGreaterThan(LOG_LEVELS.priority.info);
        expect(LOG_LEVELS.priority.info).toBeGreaterThan(LOG_LEVELS.priority.output);
        expect(LOG_LEVELS.priority.output).toBeGreaterThan(LOG_LEVELS.priority.debug);
      });
    });
  });
});
