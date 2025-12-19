/**
 * Tests for initialState.js
 */
import { describe, it, expect } from 'vitest';
import { initialState, detectStepChanges } from '../initialState.js';

describe('initialState', () => {
  describe('initialState object', () => {
    it('should have all required fields', () => {
      expect(initialState.status).toBe('idle');
      expect(initialState.goal).toBe(null);
      expect(initialState.logs).toEqual([]);
      expect(initialState.progress).toBe(0);
      expect(initialState.iteration).toBe(0);
      expect(initialState.errors).toEqual([]);
    });

    it('should have metrics object', () => {
      expect(initialState.metrics).toBeDefined();
      expect(initialState.metrics.iterations).toBe(0);
      expect(initialState.metrics.stepsCompleted).toBe(0);
      expect(initialState.metrics.stepsFailed).toBe(0);
    });

    it('should have stepChanges tracking', () => {
      expect(initialState.stepChanges).toBeDefined();
      expect(initialState.stepChanges.changedSteps).toEqual([]);
      expect(initialState.stepChanges.newSteps).toEqual([]);
      expect(initialState.stepChanges.statusTransitions).toEqual([]);
    });

    it('should have retryMode tracking', () => {
      expect(initialState.retryMode).toBeDefined();
      expect(initialState.retryMode.enabled).toBe(false);
      expect(initialState.retryMode.attempts).toEqual([]);
    });
  });

  describe('detectStepChanges', () => {
    it('should return empty arrays for null plans', () => {
      const result = detectStepChanges(null, null);
      expect(result.changedSteps).toEqual([]);
      expect(result.newSteps).toEqual([]);
      expect(result.statusTransitions).toEqual([]);
    });

    it('should return empty arrays for plan without steps', () => {
      const result = detectStepChanges({}, { steps: null });
      expect(result.changedSteps).toEqual([]);
    });

    it('should detect new steps', () => {
      const prevPlan = { steps: [] };
      const newPlan = { steps: [{ number: 1, status: 'pending' }] };

      const result = detectStepChanges(prevPlan, newPlan);

      expect(result.newSteps).toContain(1);
      expect(result.changedSteps).toContain(1);
    });

    it('should detect status changes', () => {
      const prevPlan = { steps: [{ number: 1, status: 'pending' }] };
      const newPlan = { steps: [{ number: 1, status: 'completed' }] };

      const result = detectStepChanges(prevPlan, newPlan);

      expect(result.changedSteps).toContain(1);
      expect(result.statusTransitions).toHaveLength(1);
      expect(result.statusTransitions[0].from).toBe('pending');
      expect(result.statusTransitions[0].to).toBe('completed');
    });

    it('should not detect unchanged steps', () => {
      const prevPlan = { steps: [{ number: 1, status: 'pending' }] };
      const newPlan = { steps: [{ number: 1, status: 'pending' }] };

      const result = detectStepChanges(prevPlan, newPlan);

      expect(result.changedSteps).toEqual([]);
      expect(result.newSteps).toEqual([]);
    });

    it('should handle multiple step changes', () => {
      const prevPlan = {
        steps: [
          { number: 1, status: 'completed' },
          { number: 2, status: 'pending' },
        ],
      };
      const newPlan = {
        steps: [
          { number: 1, status: 'completed' },
          { number: 2, status: 'completed' },
          { number: 3, status: 'pending' },
        ],
      };

      const result = detectStepChanges(prevPlan, newPlan);

      expect(result.changedSteps).toContain(2);
      expect(result.changedSteps).toContain(3);
      expect(result.newSteps).toContain(3);
      expect(result.statusTransitions).toHaveLength(1);
    });
  });
});
