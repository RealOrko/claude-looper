/**
 * Tests for ws-progress-handler.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleProgressEvent,
  handleMessageEvent,
  handleErrorEvent,
  handleSupervisionEvent,
  handleEscalationEvent,
  handleVerificationEvent,
  handleCompleteEvent,
} from '../ws-progress-handler.js';
import { createInitialState } from '../ws-state.js';

describe('ws-progress-handler', () => {
  let state;
  let realDateNow;

  beforeEach(() => {
    state = createInitialState();
    realDateNow = Date.now;
    Date.now = vi.fn(() => 1000);
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  describe('handleProgressEvent', () => {
    it('should handle initialized event', () => {
      const data = { type: 'initialized', goal: 'Test goal', subGoals: ['sub1'], timeLimit: '2h', sessionId: 'sess123', workingDirectory: '/test' };
      const newState = handleProgressEvent(state, data);

      expect(newState.status).toBe('initializing');
      expect(newState.goal).toBe('Test goal');
      expect(newState.subGoals).toEqual(['sub1']);
      expect(newState.timeLimit).toBe('2h');
      expect(newState.session).toBe('sess123');
      expect(newState.workingDirectory).toBe('/test');
      expect(newState.logs.length).toBe(1);
    });

    it('should handle started event and call onStartTimeUpdates', () => {
      const callbacks = { onStartTimeUpdates: vi.fn() };
      const newState = handleProgressEvent(state, { type: 'started' }, callbacks);

      expect(newState.status).toBe('executing');
      expect(newState.timeElapsed).toBe(0);
      expect(callbacks.onStartTimeUpdates).toHaveBeenCalled();
    });

    it('should handle planning event', () => {
      const callbacks = { onStartTimeUpdates: vi.fn() };
      const newState = handleProgressEvent(state, { type: 'planning', message: 'Creating plan' }, callbacks);

      expect(newState.status).toBe('planning');
      expect(callbacks.onStartTimeUpdates).toHaveBeenCalled();
    });

    it('should handle plan_created event', () => {
      const plan = { steps: [{ number: 1 }, { number: 2 }] };
      const newState = handleProgressEvent(state, { type: 'plan_created', plan });

      expect(newState.plan).toEqual(plan);
      expect(newState.status).toBe('executing');
      expect(newState.logs[0].message).toContain('2 steps');
    });

    it('should handle step_started event', () => {
      const step = { number: 1, description: 'Test step' };
      const newState = handleProgressEvent(state, { type: 'step_started', step });

      expect(newState.currentStep).toEqual(step);
    });

    it('should handle step_complete event', () => {
      state.plan = { steps: [{ number: 1, status: 'pending' }] };
      const step = { number: 1, description: 'Done' };
      const newState = handleProgressEvent(state, { type: 'step_complete', step });

      expect(newState.completedSteps).toHaveLength(1);
      expect(newState.currentStep).toBe(null);
      expect(newState.plan.steps[0].status).toBe('completed');
    });

    it('should handle step_failed event', () => {
      state.plan = { steps: [{ number: 1, status: 'pending' }] };
      const step = { number: 1, description: 'Failed step' };
      const newState = handleProgressEvent(state, { type: 'step_failed', step, reason: 'Error occurred' });

      expect(newState.failedSteps).toHaveLength(1);
      expect(newState.failedSteps[0].reason).toBe('Error occurred');
      expect(newState.currentStep).toBe(null);
      expect(newState.plan.steps[0].status).toBe('failed');
    });

    it('should handle step_rejected event same as step_failed', () => {
      state.plan = { steps: [{ number: 1, status: 'pending' }] };
      const step = { number: 1 };
      const newState = handleProgressEvent(state, { type: 'step_rejected', step, reason: 'Rejected' });

      expect(newState.failedSteps).toHaveLength(1);
    });

    it('should handle step_blocked event', () => {
      state.plan = { steps: [{ number: 1, status: 'pending' }] };
      const newState = handleProgressEvent(state, { type: 'step_blocked', step: { number: 1 }, reason: 'Blocked' });

      expect(newState.plan.steps[0].status).toBe('blocked');
    });

    it('should handle verification events', () => {
      let newState = handleProgressEvent(state, { type: 'step_verification_pending', step: { number: 1 } });
      expect(newState.logs.length).toBe(1);

      newState = handleProgressEvent(state, { type: 'step_verification_started', step: { number: 1 } });
      expect(newState.logs.length).toBe(1);
    });

    it('should handle subplan_created event', () => {
      const newState = handleProgressEvent(state, { type: 'subplan_created', subPlan: { steps: [1, 2] } });
      expect(newState.logs[0].message).toContain('2 sub-steps');
    });

    it('should handle final_verification_started event', () => {
      const newState = handleProgressEvent(state, { type: 'final_verification_started' });
      expect(newState.status).toBe('verifying');
    });

    it('should handle goal_verification_complete event - achieved', () => {
      const result = { achieved: true, confidence: 'HIGH' };
      const newState = handleProgressEvent(state, { type: 'goal_verification_complete', result });

      expect(newState.verification.goal).toEqual(result);
      expect(newState.logs[0].level).toBe('success');
      expect(newState.logs[0].message).toContain('✓');
    });

    it('should handle goal_verification_complete event - not achieved', () => {
      const result = { achieved: false, confidence: 'LOW' };
      const newState = handleProgressEvent(state, { type: 'goal_verification_complete', result });

      expect(newState.logs[0].level).toBe('warning');
      expect(newState.logs[0].message).toContain('✗');
    });

    it('should handle final_verification_passed event', () => {
      const newState = handleProgressEvent(state, { type: 'final_verification_passed' });
      expect(newState.logs[0].level).toBe('success');
      expect(newState.logs[0].message).toContain('PASSED');
    });

    it('should handle final_verification_failed event', () => {
      const newState = handleProgressEvent(state, { type: 'final_verification_failed', reason: 'Tests failed' });
      expect(newState.logs[0].level).toBe('error');
      expect(newState.logs[0].message).toContain('FAILED');
    });

    it('should handle retry_loop_started event', () => {
      const newState = handleProgressEvent(state, { type: 'retry_loop_started', maxAttempts: 5, overallTimeLimit: 10000 });

      expect(newState.retryMode.enabled).toBe(true);
      expect(newState.retryMode.maxAttempts).toBe(5);
      expect(newState.retryMode.overallTimeLimit).toBe(10000);
    });

    it('should handle attempt_starting event', () => {
      state.retryMode = { enabled: true, currentAttempt: 0, maxAttempts: 3, attempts: [] };
      const newState = handleProgressEvent(state, { type: 'attempt_starting', attemptNumber: 1, timeRemaining: 5000, maxAttempts: 3 });

      expect(newState.retryMode.currentAttempt).toBe(1);
      expect(newState.retryMode.timeRemaining).toBe(5000);
    });

    it('should handle attempt_completed event', () => {
      state.retryMode = { enabled: true, currentAttempt: 1, maxAttempts: 3, attempts: [] };
      const newState = handleProgressEvent(state, {
        type: 'attempt_completed',
        attemptNumber: 1,
        status: 'completed',
        confidence: 'HIGH',
        duration: 1000,
        completedSteps: 5,
        failedSteps: 0,
      });

      expect(newState.retryMode.attempts).toHaveLength(1);
      expect(newState.retryMode.attempts[0].confidence).toBe('HIGH');
      expect(newState.logs[0].level).toBe('success');
    });

    it('should handle retry_loop_completed event and call onStopTimeUpdates', () => {
      const callbacks = { onStopTimeUpdates: vi.fn() };
      const newState = handleProgressEvent(state,
        { type: 'retry_loop_completed', overallSuccess: true, finalConfidence: 'HIGH', totalAttempts: 2 },
        callbacks
      );

      expect(newState.status).toBe('completed');
      expect(callbacks.onStopTimeUpdates).toHaveBeenCalled();
    });

    it('should handle time_exhausted event', () => {
      const newState = handleProgressEvent(state, { type: 'time_exhausted', totalAttempts: 3 });
      expect(newState.logs[0].message).toContain('3 attempts');
    });

    it('should handle fix_cycle_started event', () => {
      const newState = handleProgressEvent(state, { type: 'fix_cycle_started', cycle: 2, issues: ['a', 'b'] });
      expect(newState.logs[0].message).toContain('Fix cycle 2');
    });

    it('should update progress from planProgress', () => {
      const newState = handleProgressEvent(state, { type: 'planning', planProgress: { current: 3, total: 10 } });
      expect(newState.progress).toBe(30);
    });

    it('should update progress from direct progress value', () => {
      const newState = handleProgressEvent(state, { type: 'planning', progress: 75 });
      expect(newState.progress).toBe(75);
    });

    it('should update timing fields', () => {
      const newState = handleProgressEvent(state, { type: 'planning', elapsed: 5000, remaining: 15000 });
      expect(newState.timeElapsed).toBe(5000);
      expect(newState.timeRemaining).toBe(15000);
    });

    it('should update iteration', () => {
      const newState = handleProgressEvent(state, { type: 'planning', iteration: 5 });
      expect(newState.iteration).toBe(5);
    });
  });

  describe('handleMessageEvent', () => {
    it('should update lastMessage and logs', () => {
      const newState = handleMessageEvent(state, { content: 'Test message', iteration: 5 });

      expect(newState.lastMessage.content).toBe('Test message');
      expect(newState.lastMessage.iteration).toBe(5);
      expect(newState.iteration).toBe(5);
      expect(newState.logs[0].level).toBe('message');
    });

    it('should truncate long messages in logs', () => {
      const longContent = 'x'.repeat(300);
      const newState = handleMessageEvent(state, { content: longContent, iteration: 1 });

      expect(newState.logs[0].message.length).toBeLessThan(longContent.length);
      expect(newState.logs[0].message).toContain('...');
    });

    it('should preserve existing iteration if not provided', () => {
      state.iteration = 10;
      const newState = handleMessageEvent(state, { content: 'msg' });
      expect(newState.iteration).toBe(10);
    });
  });

  describe('handleErrorEvent', () => {
    it('should update lastError and logs', () => {
      const newState = handleErrorEvent(state, { error: 'Test error' });

      expect(newState.lastError.error).toBe('Test error');
      expect(newState.lastError.timestamp).toBe(1000);
      expect(newState.logs[0].level).toBe('error');
      expect(newState.logs[0].message).toBe('Test error');
    });
  });

  describe('handleSupervisionEvent', () => {
    it('should update supervision and logs', () => {
      const data = { assessment: { action: 'continue', reason: 'On track' } };
      const newState = handleSupervisionEvent(state, data);

      expect(newState.supervision).toEqual(data);
      expect(newState.logs[0].level).toBe('supervision');
      expect(newState.logs[0].message).toContain('continue');
    });

    it('should handle missing assessment', () => {
      const newState = handleSupervisionEvent(state, {});
      expect(newState.logs[0].message).toContain('unknown');
    });
  });

  describe('handleEscalationEvent', () => {
    it('should add escalation log with message', () => {
      const newState = handleEscalationEvent(state, { message: 'Critical issue' });
      expect(newState.logs[0].level).toBe('escalation');
      expect(newState.logs[0].message).toBe('Critical issue');
    });

    it('should fallback to type if no message', () => {
      const newState = handleEscalationEvent(state, { type: 'timeout' });
      expect(newState.logs[0].message).toBe('timeout');
    });
  });

  describe('handleVerificationEvent', () => {
    it('should update verification and logs', () => {
      const data = { passed: true, score: 95 };
      const newState = handleVerificationEvent(state, data);

      expect(newState.verification).toEqual(data);
      expect(newState.logs[0].level).toBe('verification');
      expect(newState.logs[0].message).toContain('true');
    });
  });

  describe('handleCompleteEvent', () => {
    it('should set status to completed and call onStopTimeUpdates', () => {
      const callbacks = { onStopTimeUpdates: vi.fn() };
      const data = { status: 'completed', summary: 'Done' };
      const newState = handleCompleteEvent(state, data, callbacks);

      expect(newState.status).toBe('completed');
      expect(newState.finalReport).toEqual(data);
      expect(newState.logs[0].level).toBe('complete');
      expect(callbacks.onStopTimeUpdates).toHaveBeenCalled();
    });

    it('should set status to failed for non-completed', () => {
      const newState = handleCompleteEvent(state, { status: 'failed' });
      expect(newState.status).toBe('failed');
    });
  });
});
