/**
 * Tests for dashboard/event-handlers.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleProgressUpdate,
  handleSupervisionUpdate,
  buildEscalationDisplay,
  buildVerificationDisplay,
} from '../event-handlers.js';

// Mock terminal module
vi.mock('../../terminal.js', () => ({
  icons: {
    rocket: '🚀',
    target: '🎯',
    fire: '🔥',
    warning: '⚠️',
    error: '❌',
    success: '✓',
  },
  colors: {
    gray: '',
    cyan: '',
    green: '',
    yellow: '',
    red: '',
    white: '',
  },
  style: {
    reset: '',
    bold: '',
  },
}));

// Mock components
vi.mock('../../components.js', () => ({
  formatScore: (score) => String(score),
}));

describe('dashboard/event-handlers', () => {
  let state;
  let callbacks;

  beforeEach(() => {
    state = {
      status: 'initializing',
      startTime: null,
      iteration: 0,
      progress: 0,
      sessionId: null,
      scoreHistory: [],
      lastScore: null,
      consecutiveIssues: 0,
    };
    callbacks = {
      log: vi.fn(),
      renderStatus: vi.fn(),
    };
  });

  describe('handleProgressUpdate', () => {
    it('should handle started event', () => {
      const result = handleProgressUpdate(state, { type: 'started' }, callbacks);

      expect(state.status).toBe('running');
      expect(state.startTime).toBeDefined();
      expect(result.type).toBe('info');
      expect(result.message).toContain('Starting');
    });

    it('should handle iteration_complete event', () => {
      const result = handleProgressUpdate(state, {
        type: 'iteration_complete',
        iteration: 5,
        progress: { overallProgress: 60 },
        sessionId: 'test-session',
      }, callbacks);

      expect(state.iteration).toBe(5);
      expect(state.progress).toBe(60);
      expect(state.sessionId).toBe('test-session');
      expect(callbacks.renderStatus).toHaveBeenCalled();
      expect(result).toBe(null);
    });

    it('should handle verification_started event', () => {
      const result = handleProgressUpdate(state, { type: 'verification_started' }, callbacks);

      expect(state.status).toBe('verifying');
      expect(result.type).toBe('info');
      expect(result.message).toContain('Verifying');
    });

    it('should return null for unknown events', () => {
      const result = handleProgressUpdate(state, { type: 'unknown' }, callbacks);
      expect(result).toBe(null);
    });
  });

  describe('handleSupervisionUpdate', () => {
    it('should return null when no assessment', () => {
      const result = handleSupervisionUpdate(state, {}, callbacks);
      expect(result).toBe(null);
    });

    it('should update score history', () => {
      handleSupervisionUpdate(state, {
        assessment: { score: 75, action: 'CONTINUE' },
      }, callbacks);

      expect(state.scoreHistory).toContain(75);
      expect(state.lastScore).toBe(75);
    });

    it('should return null for CONTINUE action', () => {
      const result = handleSupervisionUpdate(state, {
        assessment: { score: 75, action: 'CONTINUE' },
      }, callbacks);

      expect(result).toBe(null);
      expect(callbacks.renderStatus).toHaveBeenCalled();
    });

    it('should return log entries for non-CONTINUE actions', () => {
      const result = handleSupervisionUpdate(state, {
        assessment: { score: 40, action: 'WARN', reason: 'Off track' },
        consecutiveIssues: 2,
      }, callbacks);

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
      expect(state.consecutiveIssues).toBe(2);
    });

    it('should use error severity for REFOCUS/CRITICAL', () => {
      const result = handleSupervisionUpdate(state, {
        assessment: { score: 20, action: 'REFOCUS' },
      }, callbacks);

      expect(result.some(entry => entry.type === 'error')).toBe(true);
    });
  });

  describe('buildEscalationDisplay', () => {
    it('should build abort display', () => {
      const display = buildEscalationDisplay({
        type: 'abort',
        message: 'Session aborted',
        consecutiveIssues: 5,
        score: 20,
      });

      expect(display.isCritical).toBe(true);
      expect(display.borderColor).toBe('red');
      expect(display.title).toBe('SESSION ABORTED');
      expect(display.message).toBe('Session aborted');
    });

    it('should build critical display', () => {
      const display = buildEscalationDisplay({
        type: 'critical',
        consecutiveIssues: 4,
        score: 30,
      });

      expect(display.isCritical).toBe(true);
      expect(display.borderColor).toBe('yellow');
      expect(display.title).toBe('CRITICAL WARNING');
    });

    it('should use default message', () => {
      const display = buildEscalationDisplay({ type: 'abort' });
      expect(display.message).toBe('Drift limit exceeded');
    });
  });

  describe('buildVerificationDisplay', () => {
    it('should build passed verification display', () => {
      const display = buildVerificationDisplay({
        passed: true,
        layers: {
          challenge: { passed: true },
          artifacts: { passed: true, verified: ['file1'], missing: [] },
          validation: { passed: true },
        },
      });

      expect(display.passed).toBe(true);
      expect(display.layers.challenge.passed).toBe(true);
      expect(display.layers.artifacts.verified).toBe(1);
      expect(display.layers.artifacts.missing).toBe(0);
    });

    it('should build failed verification display', () => {
      const display = buildVerificationDisplay({
        passed: false,
        failures: ['Tests failed', 'Missing files'],
        layers: {
          challenge: { passed: false },
        },
      });

      expect(display.passed).toBe(false);
      expect(display.failures).toEqual(['Tests failed', 'Missing files']);
      expect(display.layers.challenge.passed).toBe(false);
    });

    it('should handle skipped layers', () => {
      const display = buildVerificationDisplay({
        passed: true,
        layers: {
          artifacts: { skipped: true },
          validation: { skipped: true },
        },
      });

      expect(display.layers.artifacts.skipped).toBe(true);
      expect(display.layers.validation.skipped).toBe(true);
    });

    it('should handle missing layers', () => {
      const display = buildVerificationDisplay({
        passed: true,
        layers: {},
      });

      expect(display.layers.challenge).toBe(null);
      expect(display.layers.artifacts).toBe(null);
      expect(display.layers.validation).toBe(null);
    });
  });
});
