/**
 * Tests for parallel-executor.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParallelExecutor } from '../parallel-executor.js';

describe('ParallelExecutor', () => {
  let executor;
  let mockDependencyAnalyzer;

  beforeEach(() => {
    mockDependencyAnalyzer = {
      getNextParallelBatch: vi.fn(() => []),
      analyzeDependencies: vi.fn((steps) => steps),
      getExecutionStats: vi.fn(() => ({})),
    };
    executor = new ParallelExecutor(mockDependencyAnalyzer);
  });

  describe('parallel mode', () => {
    it('should be disabled by default', () => {
      expect(executor.isParallelModeEnabled()).toBe(false);
    });

    it('should enable parallel mode', () => {
      executor.enableParallelMode();
      expect(executor.isParallelModeEnabled()).toBe(true);
    });

    it('should disable parallel mode', () => {
      executor.enableParallelMode();
      executor.disableParallelMode();
      expect(executor.isParallelModeEnabled()).toBe(false);
    });
  });

  describe('markStepInProgress', () => {
    it('should add step to in-progress set', () => {
      const step = { number: 1, status: 'pending' };
      executor.markStepInProgress(step);

      expect(executor.getInProgressCount()).toBe(1);
      expect(step.status).toBe('in_progress');
      expect(step.startTime).toBeDefined();
    });
  });

  describe('completeStep', () => {
    it('should mark step as completed and remove from in-progress', () => {
      const step = { number: 1, status: 'pending' };
      executor.markStepInProgress(step);
      executor.completeStep(step);

      expect(executor.getInProgressCount()).toBe(0);
      expect(step.status).toBe('completed');
      expect(step.endTime).toBeDefined();
      expect(step.duration).toBeDefined();
    });

    it('should track completed step numbers', () => {
      const step = { number: 5, status: 'pending' };
      executor.completeStep(step);

      expect(executor.getCompletedStepNumbers()).toContain(5);
    });
  });

  describe('failStep', () => {
    it('should mark step as failed', () => {
      const step = { number: 1, status: 'in_progress' };
      executor.failStep(step, 'Error occurred');

      expect(step.status).toBe('failed');
      expect(step.failReason).toBe('Error occurred');
      expect(step.endTime).toBeDefined();
    });

    it('should remove from in-progress', () => {
      const step = { number: 1, status: 'pending' };
      executor.markStepInProgress(step);
      executor.failStep(step, 'Error');

      expect(executor.getInProgressCount()).toBe(0);
    });
  });

  describe('hasInProgressSteps', () => {
    it('should return false when no steps in progress', () => {
      expect(executor.hasInProgressSteps()).toBe(false);
    });

    it('should return true when steps in progress', () => {
      executor.markStepInProgress({ number: 1 });
      expect(executor.hasInProgressSteps()).toBe(true);
    });
  });

  describe('getNextExecutableBatch', () => {
    it('should return empty array for null plan', () => {
      expect(executor.getNextExecutableBatch(null, () => null)).toEqual([]);
    });

    it('should return single step when parallel mode disabled', () => {
      const step = { number: 1, description: 'Step' };
      const getCurrentStep = vi.fn(() => step);

      const batch = executor.getNextExecutableBatch({ steps: [] }, getCurrentStep);

      expect(batch).toEqual([step]);
      expect(mockDependencyAnalyzer.getNextParallelBatch).not.toHaveBeenCalled();
    });

    it('should return empty when getCurrentStep returns null', () => {
      const batch = executor.getNextExecutableBatch({ steps: [] }, () => null);
      expect(batch).toEqual([]);
    });

    it('should use dependency analyzer when parallel mode enabled', () => {
      executor.enableParallelMode();
      mockDependencyAnalyzer.getNextParallelBatch.mockReturnValue([{ number: 1 }, { number: 2 }]);

      const plan = { steps: [{ number: 1, status: 'pending' }, { number: 2, status: 'pending' }] };
      const batch = executor.getNextExecutableBatch(plan, () => null);

      expect(mockDependencyAnalyzer.getNextParallelBatch).toHaveBeenCalled();
      expect(batch).toHaveLength(2);
    });
  });

  describe('injectSubtasks', () => {
    it('should return false for null plan or decomposition', () => {
      expect(executor.injectSubtasks(null, {})).toBe(false);
      expect(executor.injectSubtasks({}, null)).toBe(false);
    });

    it('should inject subtasks after parent step', () => {
      const plan = {
        steps: [
          { number: 1, description: 'Step 1' },
          { number: 2, description: 'Step 2' },
        ],
        totalSteps: 2,
      };
      const decomposition = {
        parentStep: { number: 1 },
        subtasks: [
          { number: 1.1, description: 'Subtask 1' },
          { number: 1.2, description: 'Subtask 2' },
        ],
        parallelSafe: false,
      };

      const result = executor.injectSubtasks(plan, decomposition);

      expect(result).toBe(true);
      expect(plan.steps).toHaveLength(4);
      expect(plan.steps[0].status).toBe('decomposed');
      expect(plan.steps[0].decomposedInto).toEqual([1.1, 1.2]);
      expect(plan.steps[1].number).toBe(1.1);
      expect(plan.totalSteps).toBe(4);
    });

    it('should re-analyze dependencies when parallel safe', () => {
      const plan = { steps: [{ number: 1 }], totalSteps: 1 };
      const decomposition = {
        parentStep: { number: 1 },
        subtasks: [{ number: 1.1 }],
        parallelSafe: true,
      };

      executor.injectSubtasks(plan, decomposition);

      expect(mockDependencyAnalyzer.analyzeDependencies).toHaveBeenCalled();
    });

    it('should return false when parent step not found', () => {
      const plan = { steps: [{ number: 2 }] };
      const decomposition = { parentStep: { number: 99 }, subtasks: [] };

      expect(executor.injectSubtasks(plan, decomposition)).toBe(false);
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      executor.markStepInProgress({ number: 1 });
      executor.completeStep({ number: 2 });

      executor.reset();

      expect(executor.getInProgressCount()).toBe(0);
      expect(executor.getCompletedStepNumbers()).toEqual([]);
    });
  });
});
