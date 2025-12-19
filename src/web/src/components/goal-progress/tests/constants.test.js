/**
 * Tests for GoalProgress constants
 */
import { describe, it, expect } from 'vitest';
import { confidenceLevelData, statusConfigData } from '../constants.js';

describe('GoalProgress constants', () => {
  describe('confidenceLevelData', () => {
    it('should have all confidence levels', () => {
      expect(confidenceLevelData.HIGH).toBeDefined();
      expect(confidenceLevelData.MEDIUM).toBeDefined();
      expect(confidenceLevelData.LOW).toBeDefined();
      expect(confidenceLevelData.UNKNOWN).toBeDefined();
    });

    it('should have correct colors for each level', () => {
      expect(confidenceLevelData.HIGH.color).toBe('#22c55e');
      expect(confidenceLevelData.MEDIUM.color).toBe('#f59e0b');
      expect(confidenceLevelData.LOW.color).toBe('#ef4444');
      expect(confidenceLevelData.UNKNOWN.color).toBe('#6b7280');
    });

    it('should have correct labels for each level', () => {
      expect(confidenceLevelData.HIGH.label).toBe('High');
      expect(confidenceLevelData.MEDIUM.label).toBe('Medium');
      expect(confidenceLevelData.LOW.label).toBe('Low');
      expect(confidenceLevelData.UNKNOWN.label).toBe('Unknown');
    });

    it('should have value ordering HIGH > MEDIUM > LOW > UNKNOWN', () => {
      expect(confidenceLevelData.HIGH.value).toBeGreaterThan(confidenceLevelData.MEDIUM.value);
      expect(confidenceLevelData.MEDIUM.value).toBeGreaterThan(confidenceLevelData.LOW.value);
      expect(confidenceLevelData.LOW.value).toBeGreaterThan(confidenceLevelData.UNKNOWN.value);
    });

    it('should have iconName for each level', () => {
      expect(confidenceLevelData.HIGH.iconName).toBe('CheckCircle2');
      expect(confidenceLevelData.MEDIUM.iconName).toBe('AlertTriangle');
      expect(confidenceLevelData.LOW.iconName).toBe('XCircle');
      expect(confidenceLevelData.UNKNOWN.iconName).toBe('Activity');
    });
  });

  describe('statusConfigData', () => {
    it('should have all status configurations', () => {
      expect(statusConfigData.idle).toBeDefined();
      expect(statusConfigData.initializing).toBeDefined();
      expect(statusConfigData.planning).toBeDefined();
      expect(statusConfigData.executing).toBeDefined();
      expect(statusConfigData.verifying).toBeDefined();
      expect(statusConfigData.completed).toBeDefined();
      expect(statusConfigData.failed).toBeDefined();
    });

    it('should have iconName, color, and label for each status', () => {
      Object.values(statusConfigData).forEach(config => {
        expect(config.iconName).toBeDefined();
        expect(config.color).toBeDefined();
        expect(config.label).toBeDefined();
      });
    });

    it('should have correct labels', () => {
      expect(statusConfigData.idle.label).toBe('Idle');
      expect(statusConfigData.executing.label).toBe('Executing');
      expect(statusConfigData.completed.label).toBe('Completed');
      expect(statusConfigData.failed.label).toBe('Failed');
    });

    it('should use green for success states', () => {
      expect(statusConfigData.completed.color).toBe('#22c55e');
      expect(statusConfigData.executing.color).toBe('#22c55e');
    });

    it('should use red for failed state', () => {
      expect(statusConfigData.failed.color).toBe('#ef4444');
    });

    it('should have correct icon names', () => {
      expect(statusConfigData.idle.iconName).toBe('Pause');
      expect(statusConfigData.executing.iconName).toBe('FastForward');
      expect(statusConfigData.failed.iconName).toBe('XCircle');
    });
  });
});
