/**
 * Tests for progress-handlers.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleProgressEvent } from '../progress-handlers.js';

describe('progress-handlers', () => {
  let state;
  let addLog;

  beforeEach(() => {
    state = {
      status: 'initializing',
      startTime: null,
      plan: null,
      currentStep: 0,
      progress: 0,
      iteration: 0,
      sessionId: null,
      elapsed: 0,
      remaining: '',
      subPlan: null,
      subPlanParent: null,
    };
    addLog = vi.fn();
  });

  describe('started event', () => {
    it('should set status to running', () => {
      handleProgressEvent(state, { type: 'started' }, addLog);
      expect(state.status).toBe('running');
      expect(state.startTime).toBeDefined();
    });

    it('should add log entry', () => {
      handleProgressEvent(state, { type: 'started' }, addLog);
      expect(addLog).toHaveBeenCalledWith('info', 'Starting autonomous execution...');
    });
  });

  describe('planning event', () => {
    it('should set status to planning', () => {
      handleProgressEvent(state, { type: 'planning' }, addLog);
      expect(state.status).toBe('planning');
    });

    it('should use custom message if provided', () => {
      handleProgressEvent(state, { type: 'planning', message: 'Custom message' }, addLog);
      expect(addLog).toHaveBeenCalledWith('info', 'Custom message');
    });
  });

  describe('plan_created event', () => {
    it('should store plan and set currentStep to 1', () => {
      const plan = { steps: [{ number: 1 }, { number: 2 }] };
      handleProgressEvent(state, { type: 'plan_created', plan }, addLog);
      expect(state.plan).toBe(plan);
      expect(state.currentStep).toBe(1);
    });

    it('should log step count', () => {
      const plan = { steps: [{ number: 1 }, { number: 2 }, { number: 3 }] };
      handleProgressEvent(state, { type: 'plan_created', plan }, addLog);
      expect(addLog).toHaveBeenCalledWith('success', 'Plan created with 3 steps');
    });
  });

  describe('resuming event', () => {
    it('should log resuming message', () => {
      handleProgressEvent(state, { type: 'resuming' }, addLog);
      expect(addLog).toHaveBeenCalledWith('info', 'Resuming session...');
    });

    it('should use custom message', () => {
      handleProgressEvent(state, { type: 'resuming', message: 'Resuming from step 5' }, addLog);
      expect(addLog).toHaveBeenCalledWith('info', 'Resuming from step 5');
    });
  });

  describe('plan_restored event', () => {
    it('should restore plan and progress', () => {
      const plan = { steps: [{ number: 1 }, { number: 2 }] };
      handleProgressEvent(state, {
        type: 'plan_restored',
        plan,
        currentStep: 2,
        completedSteps: [1],
      }, addLog);

      expect(state.plan).toBe(plan);
      expect(state.currentStep).toBe(2);
      expect(state.progress).toBe(50);
    });
  });

  describe('step_verification_pending event', () => {
    it('should log verification pending', () => {
      handleProgressEvent(state, { type: 'step_verification_pending', step: { number: 3 } }, addLog);
      expect(addLog).toHaveBeenCalledWith('info', 'Verifying step 3...');
    });
  });

  describe('step_verification_started event', () => {
    it('should set status to verifying', () => {
      handleProgressEvent(state, { type: 'step_verification_started' }, addLog);
      expect(state.status).toBe('verifying');
    });
  });

  describe('step_complete event', () => {
    it('should set status to running', () => {
      handleProgressEvent(state, { type: 'step_complete' }, addLog);
      expect(state.status).toBe('running');
    });

    it('should log step completion', () => {
      handleProgressEvent(state, { type: 'step_complete', step: { number: 2 } }, addLog);
      expect(addLog).toHaveBeenCalledWith('success', 'Step 2 complete');
    });

    it('should add verified suffix when verification present', () => {
      handleProgressEvent(state, {
        type: 'step_complete',
        step: { number: 2 },
        verification: true,
      }, addLog);
      expect(addLog).toHaveBeenCalledWith('success', 'Step 2 complete (verified)');
    });

    it('should update plan step status', () => {
      state.plan = { steps: [{ number: 1, status: 'pending' }, { number: 2, status: 'pending' }] };
      handleProgressEvent(state, { type: 'step_complete', step: { number: 1 } }, addLog);
      expect(state.plan.steps[0].status).toBe('completed');
    });

    it('should update progress from data', () => {
      handleProgressEvent(state, {
        type: 'step_complete',
        step: { number: 1 },
        progress: { current: 2, percentComplete: 50 },
      }, addLog);
      expect(state.currentStep).toBe(2);
      expect(state.progress).toBe(50);
    });
  });

  describe('step_rejected event', () => {
    it('should set status to running and log warning', () => {
      handleProgressEvent(state, {
        type: 'step_rejected',
        step: { number: 1 },
        reason: 'Test failed',
      }, addLog);
      expect(state.status).toBe('running');
      expect(addLog).toHaveBeenCalledWith('warning', 'Step 1 rejected: Test failed');
    });
  });

  describe('step_blocked_replanning event', () => {
    it('should log blocked message', () => {
      handleProgressEvent(state, {
        type: 'step_blocked_replanning',
        step: { number: 3 },
      }, addLog);
      expect(addLog).toHaveBeenCalledWith('warning', 'Step 3 blocked, creating sub-plan...');
    });
  });

  describe('subplan_creating event', () => {
    it('should set status to planning', () => {
      handleProgressEvent(state, { type: 'subplan_creating' }, addLog);
      expect(state.status).toBe('planning');
      expect(addLog).toHaveBeenCalledWith('info', 'Creating alternative approach...');
    });
  });

  describe('subplan_created event', () => {
    it('should store subplan info', () => {
      const subPlan = { steps: [{ number: 1 }] };
      handleProgressEvent(state, {
        type: 'subplan_created',
        subPlan,
        parentStep: 3,
      }, addLog);
      expect(state.status).toBe('running');
      expect(state.subPlan).toBe(subPlan);
      expect(state.subPlanParent).toBe(3);
    });
  });

  describe('subplan_failed event', () => {
    it('should clear subplan and update progress', () => {
      state.subPlan = { steps: [] };
      state.subPlanParent = 3;
      handleProgressEvent(state, {
        type: 'subplan_failed',
        step: { number: 3 },
        reason: 'Could not complete',
        progress: { current: 4, percentComplete: 60 },
      }, addLog);
      expect(state.status).toBe('running');
      expect(state.subPlan).toBe(null);
      expect(state.subPlanParent).toBe(null);
      expect(state.currentStep).toBe(4);
    });
  });

  describe('step_failed event', () => {
    it('should log error and update plan step', () => {
      state.plan = { steps: [{ number: 1, status: 'pending' }] };
      handleProgressEvent(state, {
        type: 'step_failed',
        step: { number: 1 },
        reason: 'Error occurred',
      }, addLog);
      expect(addLog).toHaveBeenCalledWith('error', 'Step 1 failed: Error occurred');
      expect(state.plan.steps[0].status).toBe('failed');
      expect(state.plan.steps[0].failReason).toBe('Error occurred');
    });
  });

  describe('step_blocked event', () => {
    it('should log warning and update current step', () => {
      handleProgressEvent(state, {
        type: 'step_blocked',
        step: { number: 2 },
        reason: 'Dependency missing',
        progress: { current: 3 },
      }, addLog);
      expect(addLog).toHaveBeenCalledWith('warning', 'Step 2 blocked: Dependency missing');
      expect(state.currentStep).toBe(3);
    });
  });

  describe('iteration_complete event', () => {
    it('should update iteration and progress', () => {
      handleProgressEvent(state, {
        type: 'iteration_complete',
        iteration: 5,
        planProgress: { percentComplete: 60, current: 3 },
        sessionId: 'test-session',
        time: { elapsedMs: 30000, remaining: '5m' },
      }, addLog);
      expect(state.iteration).toBe(5);
      expect(state.progress).toBe(60);
      expect(state.currentStep).toBe(3);
      expect(state.sessionId).toBe('test-session');
      expect(state.elapsed).toBe(30000);
      expect(state.remaining).toBe('5m');
    });
  });

  describe('verification_started event', () => {
    it('should set status to verifying', () => {
      handleProgressEvent(state, { type: 'verification_started' }, addLog);
      expect(state.status).toBe('verifying');
      expect(addLog).toHaveBeenCalledWith('info', 'Verifying completion claim...');
    });
  });

  describe('plan_review events', () => {
    it('should handle plan_review_started', () => {
      handleProgressEvent(state, { type: 'plan_review_started' }, addLog);
      expect(addLog).toHaveBeenCalledWith('info', 'Reviewing execution plan...');
    });

    it('should handle plan_review_complete approved', () => {
      handleProgressEvent(state, {
        type: 'plan_review_complete',
        review: { approved: true },
      }, addLog);
      expect(addLog).toHaveBeenCalledWith('success', 'Plan review: approved');
    });

    it('should handle plan_review_complete flagged', () => {
      handleProgressEvent(state, {
        type: 'plan_review_complete',
        review: { approved: false },
      }, addLog);
      expect(addLog).toHaveBeenCalledWith('warning', 'Plan review: flagged');
    });

    it('should handle plan_review_warning with issues', () => {
      handleProgressEvent(state, {
        type: 'plan_review_warning',
        issues: ['Issue 1', 'Issue 2', 'Issue 3'],
      }, addLog);
      expect(addLog).toHaveBeenCalledWith('warning', 'Plan issues: Issue 1, Issue 2');
    });

    it('should handle plan_review_warning with missing steps', () => {
      handleProgressEvent(state, {
        type: 'plan_review_warning',
        missingSteps: ['Step A', 'Step B'],
      }, addLog);
      expect(addLog).toHaveBeenCalledWith('warning', 'Missing steps: Step A, Step B');
    });
  });

  describe('final_verification events', () => {
    it('should handle final_verification_started', () => {
      handleProgressEvent(state, { type: 'final_verification_started' }, addLog);
      expect(state.status).toBe('verifying');
      expect(addLog).toHaveBeenCalledWith('info', 'Running final verification...');
    });

    it('should handle goal_verification_complete success', () => {
      handleProgressEvent(state, {
        type: 'goal_verification_complete',
        result: { achieved: true, confidence: 'high' },
      }, addLog);
      expect(addLog).toHaveBeenCalledWith('success', 'Goal verified (high confidence)');
    });

    it('should handle goal_verification_complete failure', () => {
      handleProgressEvent(state, {
        type: 'goal_verification_complete',
        result: { achieved: false, reason: 'Tests still failing' },
      }, addLog);
      expect(addLog).toHaveBeenCalledWith('warning', 'Goal not verified: Tests still failing');
    });

    it('should handle final_verification_passed', () => {
      handleProgressEvent(state, { type: 'final_verification_passed' }, addLog);
      expect(state.status).toBe('completed');
      expect(addLog).toHaveBeenCalledWith('success', 'Final verification PASSED');
    });

    it('should handle final_verification_failed', () => {
      handleProgressEvent(state, {
        type: 'final_verification_failed',
        reason: 'Verification failed due to test errors',
      }, addLog);
      expect(state.status).toBe('error');
      expect(addLog).toHaveBeenCalledWith('error', 'Final verification FAILED: Verification failed due to test errors');
    });
  });
});
