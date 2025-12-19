import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateCorrection, checkStagnation } from '../correction-generator.js';

describe('correction-generator', () => {
  describe('generateCorrection', () => {
    const baseContext = {
      goal: 'Build a web application',
      phase: 'Setup phase',
      thresholds: { warn: 2, intervene: 4, critical: 6, abort: 8 },
      consecutiveIssues: 3,
      totalCorrections: 2,
      avgScore: 65,
    };

    it('should return null for CONTINUE action', () => {
      const assessment = { action: 'CONTINUE', score: 85 };
      const result = generateCorrection(assessment, baseContext);
      expect(result).toBeNull();
    });

    it('should generate reminder for REMIND action', () => {
      const assessment = { action: 'REMIND', score: 55, reason: 'Stay on track' };
      const result = generateCorrection(assessment, baseContext);

      expect(result).toContain('## Quick Reminder');
      expect(result).toContain('Stay on track');
      expect(result).toContain('Build a web application');
      expect(result).toContain('Setup phase');
    });

    it('should generate reminder with default message', () => {
      const assessment = { action: 'REMIND', score: 55 };
      const result = generateCorrection(assessment, baseContext);

      expect(result).toContain('Stay focused on the goal');
    });

    it('should generate course correction for CORRECT action', () => {
      const assessment = { action: 'CORRECT', score: 40, productive: true, relevant: true };
      const result = generateCorrection(assessment, baseContext);

      expect(result).toContain('## Course Correction');
      expect(result).toContain('Score: 40/100');
      expect(result).toContain('Consecutive issues: 3/8');
    });

    it('should include productivity warning in CORRECT', () => {
      const assessment = { action: 'CORRECT', score: 40, productive: false, relevant: true };
      const result = generateCorrection(assessment, baseContext);

      expect(result).toContain('⚠️ Take concrete action');
    });

    it('should include relevance warning in CORRECT', () => {
      const assessment = { action: 'CORRECT', score: 40, productive: true, relevant: false };
      const result = generateCorrection(assessment, baseContext);

      expect(result).toContain('⚠️ This work doesn\'t appear relevant');
    });

    it('should generate refocus for REFOCUS action', () => {
      const assessment = { action: 'REFOCUS', score: 25 };
      const result = generateCorrection(assessment, baseContext);

      expect(result).toContain('## CRITICAL: REFOCUS REQUIRED');
      expect(result).toContain('drifted from the assigned task for 3 consecutive responses');
      expect(result).toContain('STOP ALL CURRENT WORK IMMEDIATELY');
      expect(result).toContain('Build a web application');
    });

    it('should generate critical warning for CRITICAL action', () => {
      const assessment = { action: 'CRITICAL', score: 20 };
      const result = generateCorrection(assessment, baseContext);

      expect(result).toContain('## CRITICAL ESCALATION - FINAL WARNING');
      expect(result).toContain('3/8 (ABORT threshold)');
      expect(result).toContain('ONE MORE OFF-TRACK RESPONSE WILL TERMINATE THIS SESSION');
    });

    it('should use assessment score when avgScore is null', () => {
      const assessment = { action: 'CRITICAL', score: 20 };
      const context = { ...baseContext, avgScore: null };
      const result = generateCorrection(assessment, context);

      expect(result).toContain('Average alignment score: 20/100');
    });

    it('should generate abort message for ABORT action', () => {
      const assessment = { action: 'ABORT' };
      const result = generateCorrection(assessment, baseContext);

      expect(result).toContain('## SESSION TERMINATED');
      expect(result).toContain('Consecutive issues: 3');
      expect(result).toContain('Total corrections issued: 2');
      expect(result).toContain('Average alignment score: 65/100');
    });

    it('should handle N/A for avgScore in ABORT', () => {
      const assessment = { action: 'ABORT' };
      const context = { ...baseContext, avgScore: null };
      const result = generateCorrection(assessment, context);

      expect(result).toContain('Average alignment score: N/A/100');
    });

    it('should return null for unknown action', () => {
      const assessment = { action: 'UNKNOWN' };
      const result = generateCorrection(assessment, baseContext);
      expect(result).toBeNull();
    });
  });

  describe('checkStagnation', () => {
    let originalNow;

    beforeEach(() => {
      originalNow = Date.now;
    });

    afterEach(() => {
      Date.now = originalNow;
    });

    it('should return not stagnant when idle time is below threshold', () => {
      const now = 1000000;
      Date.now = vi.fn().mockReturnValue(now);

      const lastRelevantAction = now - 1000; // 1 second ago
      const maxIdleMs = 60000; // 1 minute
      const context = {
        primaryGoal: 'Test goal',
        consecutiveIssues: 0,
        thresholds: { abort: 8 },
      };

      const result = checkStagnation(lastRelevantAction, maxIdleMs, context);

      expect(result.isStagnant).toBe(false);
    });

    it('should return stagnant when idle time exceeds threshold', () => {
      const now = 1000000;
      Date.now = vi.fn().mockReturnValue(now);

      const lastRelevantAction = now - 120000; // 2 minutes ago
      const maxIdleMs = 60000; // 1 minute
      const context = {
        primaryGoal: 'Build an app',
        consecutiveIssues: 2,
        thresholds: { abort: 8 },
      };

      const result = checkStagnation(lastRelevantAction, maxIdleMs, context);

      expect(result.isStagnant).toBe(true);
      expect(result.idleTime).toBe(120000);
      expect(result.prompt).toContain('## Stagnation Alert');
      expect(result.prompt).toContain('No significant progress detected for 2 minutes');
      expect(result.prompt).toContain('Build an app');
      expect(result.prompt).toContain('2/8');
    });

    it('should include recovery suggestions in stagnation prompt', () => {
      const now = 1000000;
      Date.now = vi.fn().mockReturnValue(now);

      const lastRelevantAction = now - 300000; // 5 minutes ago
      const maxIdleMs = 60000;
      const context = {
        primaryGoal: 'Test goal',
        consecutiveIssues: 1,
        thresholds: { abort: 8 },
      };

      const result = checkStagnation(lastRelevantAction, maxIdleMs, context);

      expect(result.prompt).toContain('Explain what\'s blocking you');
      expect(result.prompt).toContain('Try an alternative approach');
      expect(result.prompt).toContain('Move to the next sub-task');
    });

    it('should handle edge case at exact threshold', () => {
      const now = 1000000;
      Date.now = vi.fn().mockReturnValue(now);

      const lastRelevantAction = now - 60000; // exactly 1 minute ago
      const maxIdleMs = 60000;
      const context = {
        primaryGoal: 'Goal',
        consecutiveIssues: 0,
        thresholds: { abort: 8 },
      };

      const result = checkStagnation(lastRelevantAction, maxIdleMs, context);

      expect(result.isStagnant).toBe(false);
    });

    it('should handle one millisecond over threshold', () => {
      const now = 1000000;
      Date.now = vi.fn().mockReturnValue(now);

      const lastRelevantAction = now - 60001; // 1ms over threshold
      const maxIdleMs = 60000;
      const context = {
        primaryGoal: 'Goal',
        consecutiveIssues: 0,
        thresholds: { abort: 8 },
      };

      const result = checkStagnation(lastRelevantAction, maxIdleMs, context);

      expect(result.isStagnant).toBe(true);
    });
  });
});
