/**
 * Tests for ws-state.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createInitialState,
  createStateSnapshot,
  updatePlanStepStatus,
  addLogEntry,
  parseTimeLimit,
} from '../ws-state.js';

describe('ws-state', () => {
  describe('createInitialState', () => {
    it('should create state with default values', () => {
      const state = createInitialState();
      expect(state.status).toBe('idle');
      expect(state.goal).toBe(null);
      expect(state.subGoals).toEqual([]);
      expect(state.plan).toBe(null);
      expect(state.currentStep).toBe(null);
      expect(state.completedSteps).toEqual([]);
      expect(state.failedSteps).toEqual([]);
      expect(state.progress).toBe(0);
      expect(state.timeLimit).toBe(null);
      expect(state.timeElapsed).toBe(0);
      expect(state.timeRemaining).toBe(null);
      expect(state.iteration).toBe(0);
      expect(state.session).toBe(null);
      expect(state.lastMessage).toBe(null);
      expect(state.lastError).toBe(null);
      expect(state.supervision).toBe(null);
      expect(state.verification).toBe(null);
      expect(state.logs).toEqual([]);
    });

    it('should create state with retryMode defaults', () => {
      const state = createInitialState();
      expect(state.retryMode).toEqual({
        enabled: false,
        currentAttempt: 0,
        maxAttempts: 0,
        attempts: [],
      });
    });

    it('should create independent state objects', () => {
      const state1 = createInitialState();
      const state2 = createInitialState();
      state1.goal = 'test';
      expect(state2.goal).toBe(null);
    });
  });

  describe('createStateSnapshot', () => {
    it('should create a deep copy of state', () => {
      const state = {
        ...createInitialState(),
        goal: 'Test goal',
        plan: { steps: [{ number: 1, description: 'Step 1' }] },
        completedSteps: [{ number: 1 }],
        failedSteps: [{ number: 2, reason: 'failed' }],
        subGoals: ['sub1', 'sub2'],
        logs: [{ id: 1, message: 'log1' }],
        lastMessage: { content: 'msg', iteration: 1 },
        lastError: { error: 'err', timestamp: 123 },
        supervision: { action: 'continue' },
        verification: { passed: true },
        retryMode: { enabled: true, currentAttempt: 1, maxAttempts: 3, attempts: [{ number: 1 }] },
      };

      const snapshot = createStateSnapshot(state);

      // Should have same values
      expect(snapshot.goal).toBe('Test goal');
      expect(snapshot.plan.steps).toHaveLength(1);
      expect(snapshot.completedSteps).toHaveLength(1);
      expect(snapshot.failedSteps).toHaveLength(1);
      expect(snapshot.logs).toHaveLength(1);

      // Should be independent copies
      snapshot.plan.steps[0].description = 'Modified';
      expect(state.plan.steps[0].description).toBe('Step 1');

      snapshot.completedSteps.push({ number: 2 });
      expect(state.completedSteps).toHaveLength(1);
    });

    it('should handle null plan', () => {
      const state = createInitialState();
      const snapshot = createStateSnapshot(state);
      expect(snapshot.plan).toBe(null);
    });

    it('should handle plan with no steps', () => {
      const state = { ...createInitialState(), plan: {} };
      const snapshot = createStateSnapshot(state);
      expect(snapshot.plan).toEqual({ steps: [] });
    });
  });

  describe('updatePlanStepStatus', () => {
    it('should update step status', () => {
      const plan = {
        steps: [
          { number: 1, description: 'Step 1', status: 'pending' },
          { number: 2, description: 'Step 2', status: 'pending' },
        ],
      };

      const updated = updatePlanStepStatus(plan, 1, 'completed');
      expect(updated.steps[0].status).toBe('completed');
      expect(updated.steps[1].status).toBe('pending');
    });

    it('should add reason for failed steps', () => {
      const plan = {
        steps: [{ number: 1, description: 'Step 1', status: 'pending' }],
      };

      const updated = updatePlanStepStatus(plan, 1, 'failed', 'Test error');
      expect(updated.steps[0].status).toBe('failed');
      expect(updated.steps[0].failReason).toBe('Test error');
    });

    it('should not modify original plan', () => {
      const plan = {
        steps: [{ number: 1, description: 'Step 1', status: 'pending' }],
      };

      updatePlanStepStatus(plan, 1, 'completed');
      expect(plan.steps[0].status).toBe('pending');
    });

    it('should return plan if no steps', () => {
      expect(updatePlanStepStatus(null, 1, 'completed')).toBe(null);
      expect(updatePlanStepStatus({}, 1, 'completed')).toEqual({});
    });

    it('should not add failReason if not provided', () => {
      const plan = { steps: [{ number: 1, status: 'pending' }] };
      const updated = updatePlanStepStatus(plan, 1, 'blocked');
      expect(updated.steps[0].failReason).toBeUndefined();
    });
  });

  describe('addLogEntry', () => {
    let realDateNow;

    beforeEach(() => {
      realDateNow = Date.now;
      Date.now = vi.fn(() => 1000);
    });

    afterEach(() => {
      Date.now = realDateNow;
    });

    it('should add a log entry', () => {
      const logs = [];
      const newLogs = addLogEntry(logs, 'info', 'Test message');

      expect(newLogs).toHaveLength(1);
      expect(newLogs[0].level).toBe('info');
      expect(newLogs[0].message).toBe('Test message');
      expect(newLogs[0].timestamp).toBe(1000);
      expect(newLogs[0].id).toBeDefined();
    });

    it('should not modify original array', () => {
      const logs = [{ id: 1, message: 'old' }];
      const newLogs = addLogEntry(logs, 'info', 'new');
      expect(logs).toHaveLength(1);
      expect(newLogs).toHaveLength(2);
    });

    it('should limit logs to 500 entries', () => {
      let logs = [];
      for (let i = 0; i < 550; i++) {
        logs = addLogEntry(logs, 'info', `Log ${i}`);
      }
      expect(logs.length).toBe(500);
      expect(logs[0].message).toBe('Log 50');
      expect(logs[499].message).toBe('Log 549');
    });
  });

  describe('parseTimeLimit', () => {
    it('should parse minutes', () => {
      expect(parseTimeLimit('30m')).toBe(30 * 60 * 1000);
      expect(parseTimeLimit('1m')).toBe(60 * 1000);
    });

    it('should parse hours', () => {
      expect(parseTimeLimit('2h')).toBe(2 * 60 * 60 * 1000);
      expect(parseTimeLimit('1h')).toBe(60 * 60 * 1000);
    });

    it('should parse days', () => {
      expect(parseTimeLimit('1d')).toBe(24 * 60 * 60 * 1000);
      expect(parseTimeLimit('2d')).toBe(2 * 24 * 60 * 60 * 1000);
    });

    it('should default to hours when no unit', () => {
      expect(parseTimeLimit('2')).toBe(2 * 60 * 60 * 1000);
    });

    it('should return default 2h for invalid input', () => {
      expect(parseTimeLimit('invalid')).toBe(2 * 60 * 60 * 1000);
    });

    it('should return 0 for empty/null input', () => {
      expect(parseTimeLimit('')).toBe(0);
      expect(parseTimeLimit(null)).toBe(0);
      expect(parseTimeLimit(undefined)).toBe(0);
    });
  });
});
