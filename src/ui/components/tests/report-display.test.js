/**
 * Tests for report-display.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { displayReport } from '../report-display.js';

describe('report-display', () => {
  let consoleLogMock;

  beforeEach(() => {
    consoleLogMock = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogMock.mockRestore();
  });

  describe('displayReport', () => {
    it('should display basic report info', () => {
      displayReport({
        status: 'completed',
        goal: { progress: 100 },
        session: { iterations: 5 },
        time: { elapsed: '10m' },
      });

      expect(consoleLogMock).toHaveBeenCalledWith('  Status: COMPLETED');
      expect(consoleLogMock).toHaveBeenCalledWith('  Progress: 100%');
      expect(consoleLogMock).toHaveBeenCalledWith('  Iterations: 5');
      expect(consoleLogMock).toHaveBeenCalledWith('  Time: 10m');
    });

    it('should handle missing report data', () => {
      displayReport({});

      expect(consoleLogMock).toHaveBeenCalledWith('  Status: UNKNOWN');
      expect(consoleLogMock).toHaveBeenCalledWith('  Progress: 0%');
      expect(consoleLogMock).toHaveBeenCalledWith('  Iterations: 0');
      expect(consoleLogMock).toHaveBeenCalledWith('  Time: N/A');
    });

    it('should display plan summary', () => {
      displayReport({
        plan: {
          completed: 3,
          totalSteps: 5,
          failed: 1,
          steps: [
            { number: 1, description: 'Step 1', status: 'completed' },
            { number: 2, description: 'Step 2', status: 'failed', failReason: 'Error' },
          ],
        },
      });

      expect(consoleLogMock).toHaveBeenCalledWith('  Plan: 3/5 steps completed');
      expect(consoleLogMock).toHaveBeenCalledWith('  Failed Steps: 1');
    });

    it('should display final verification results', () => {
      displayReport({
        finalVerification: {
          goalAchieved: true,
          confidence: 'high',
          functional: 'yes',
          recommendation: 'accept',
          overallPassed: true,
        },
      });

      const calls = consoleLogMock.mock.calls.map(c => c[0]);
      expect(calls).toContain('  \x1b[1mFinal Verification:\x1b[0m');
      expect(calls.some(c => c.includes('Goal Achieved: Yes'))).toBe(true);
      expect(calls.some(c => c.includes('Confidence: high'))).toBe(true);
    });

    it('should display gaps if present', () => {
      displayReport({
        finalVerification: {
          goalAchieved: false,
          gaps: 'Missing tests',
          overallPassed: false,
        },
      });

      const calls = consoleLogMock.mock.calls.map(c => c[0]);
      expect(calls.some(c => c.includes('Gaps: Missing tests'))).toBe(true);
    });

    it('should display abort reason', () => {
      displayReport({
        abortReason: 'Time limit exceeded',
      });

      expect(consoleLogMock).toHaveBeenCalledWith('  Abort Reason: Time limit exceeded');
    });

    it('should handle null report', () => {
      displayReport(null);
      // Should not throw
      expect(consoleLogMock).toHaveBeenCalled();
    });
  });
});
