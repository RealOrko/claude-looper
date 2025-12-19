/**
 * Tests for sub-plan-manager.js
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SubPlanManager } from '../sub-plan-manager.js';

describe('SubPlanManager', () => {
  let manager;

  beforeEach(() => {
    manager = new SubPlanManager();
  });

  describe('initial state', () => {
    it('should not be in sub-plan initially', () => {
      expect(manager.isInSubPlan()).toBe(false);
    });

    it('should allow sub-plan attempt initially', () => {
      expect(manager.canAttemptSubPlan()).toBe(true);
    });
  });

  describe('setSubPlan', () => {
    it('should set sub-plan and parent step', () => {
      const subPlan = { steps: [{ number: 1, description: 'Sub step' }], totalSteps: 1 };
      const parentStep = { number: 5, description: 'Parent' };

      manager.setSubPlan(subPlan, parentStep);

      expect(manager.isInSubPlan()).toBe(true);
      expect(manager.getParentStep()).toBe(parentStep);
      expect(manager.getSubPlan()).toBe(subPlan);
    });

    it('should mark attempt as made', () => {
      manager.setSubPlan({ steps: [] }, { number: 1 });
      expect(manager.canAttemptSubPlan()).toBe(false);
    });
  });

  describe('getCurrentSubStep', () => {
    it('should return null when not in sub-plan', () => {
      expect(manager.getCurrentSubStep()).toBe(null);
    });

    it('should return current sub-step with markers', () => {
      const subPlan = { steps: [{ number: 1, description: 'Step', complexity: 'simple', status: 'pending' }], totalSteps: 1 };
      const parent = { number: 3, description: 'Parent' };
      manager.setSubPlan(subPlan, parent);

      const step = manager.getCurrentSubStep();

      expect(step.isSubStep).toBe(true);
      expect(step.parentStep).toBe(parent);
      expect(step.description).toBe('Step');
    });

    it('should return null when all sub-steps complete', () => {
      manager.setSubPlan({ steps: [], totalSteps: 0 }, { number: 1 });
      expect(manager.getCurrentSubStep()).toBe(null);
    });
  });

  describe('advanceSubStep', () => {
    it('should mark current step completed and advance', () => {
      const subPlan = {
        steps: [
          { number: 1, description: 'Step 1', status: 'pending' },
          { number: 2, description: 'Step 2', status: 'pending' },
        ],
        totalSteps: 2,
      };
      manager.setSubPlan(subPlan, { number: 1 });

      manager.advanceSubStep();

      expect(subPlan.steps[0].status).toBe('completed');
      expect(manager.getCurrentSubStep().description).toBe('Step 2');
    });
  });

  describe('isSubPlanComplete', () => {
    it('should return true when all steps done', () => {
      manager.setSubPlan({ steps: [{ status: 'pending' }], totalSteps: 1 }, { number: 1 });
      manager.advanceSubStep();

      expect(manager.isSubPlanComplete()).toBe(true);
    });

    it('should return false when steps remaining', () => {
      manager.setSubPlan({ steps: [{ status: 'pending' }, { status: 'pending' }], totalSteps: 2 }, { number: 1 });

      expect(manager.isSubPlanComplete()).toBe(false);
    });
  });

  describe('failCurrentSubStep', () => {
    it('should mark current step as failed', () => {
      const subPlan = { steps: [{ number: 1, status: 'pending' }], totalSteps: 1 };
      manager.setSubPlan(subPlan, { number: 1 });

      manager.failCurrentSubStep('Error occurred');

      expect(subPlan.steps[0].status).toBe('failed');
      expect(subPlan.steps[0].failReason).toBe('Error occurred');
    });
  });

  describe('getSubPlanProgress', () => {
    it('should return null when not in sub-plan', () => {
      expect(manager.getSubPlanProgress()).toBe(null);
    });

    it('should return progress info', () => {
      manager.setSubPlan({ steps: [{}, {}], totalSteps: 2 }, { number: 5 });

      const progress = manager.getSubPlanProgress();

      expect(progress.current).toBe(1);
      expect(progress.total).toBe(2);
      expect(progress.parentStep).toBe(5);
    });
  });

  describe('clearSubPlan', () => {
    it('should clear sub-plan state', () => {
      manager.setSubPlan({ steps: [] }, { number: 1 });
      manager.clearSubPlan();

      expect(manager.isInSubPlan()).toBe(false);
      expect(manager.getSubPlan()).toBe(null);
      expect(manager.getParentStep()).toBe(null);
    });

    it('should preserve attempted flag', () => {
      manager.setSubPlan({ steps: [] }, { number: 1 });
      manager.clearSubPlan();

      expect(manager.canAttemptSubPlan()).toBe(false);
    });
  });

  describe('resetAttemptedFlag', () => {
    it('should reset attempted flag', () => {
      manager.markAttempted();
      expect(manager.canAttemptSubPlan()).toBe(false);

      manager.resetAttemptedFlag();
      expect(manager.canAttemptSubPlan()).toBe(true);
    });
  });

  describe('markAttempted', () => {
    it('should mark as attempted without setting plan', () => {
      manager.markAttempted();

      expect(manager.canAttemptSubPlan()).toBe(false);
      expect(manager.isInSubPlan()).toBe(false);
    });
  });

  describe('getSubPlanExecutionPrompt', () => {
    it('should return null when not in sub-plan', () => {
      // Not in sub-plan - getCurrentSubStep returns null
      expect(manager.getSubPlanExecutionPrompt()).toBe(null);
    });

    it('should return execution prompt with context', () => {
      manager.setSubPlan(
        { steps: [{ description: 'Do task', complexity: 'simple', status: 'pending' }], totalSteps: 1 },
        { description: 'Original blocked step' }
      );

      const prompt = manager.getSubPlanExecutionPrompt();

      expect(prompt).toContain('SUB-STEP 1 OF 1');
      expect(prompt).toContain('Original blocked step');
      expect(prompt).toContain('Do task');
      expect(prompt).toContain('STEP COMPLETE');
      expect(prompt).toContain('STEP BLOCKED');
    });

    it('should include completed sub-steps', () => {
      manager.setSubPlan(
        {
          steps: [
            { description: 'First', status: 'completed' },
            { description: 'Second', status: 'pending' },
          ],
          totalSteps: 2,
        },
        { description: 'Parent' }
      );
      manager.advanceSubStep(); // Advance to second step

      const prompt = manager.getSubPlanExecutionPrompt();

      expect(prompt).toContain('✓ First');
    });
  });
});
