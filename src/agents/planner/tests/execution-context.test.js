/**
 * Tests for Execution Context Module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionContext } from '../execution-context.js';

describe('ExecutionContext', () => {
  let context;

  beforeEach(() => {
    context = new ExecutionContext();
  });

  describe('constructor', () => {
    it('should initialize with empty arrays', () => {
      expect(context.completedSteps).toEqual([]);
      expect(context.failedSteps).toEqual([]);
      expect(context.blockedReasons).toEqual([]);
      expect(context.successfulApproaches).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update completed steps', () => {
      context.update({ completedSteps: ['step-1', 'step-2'] });
      expect(context.completedSteps).toEqual(['step-1', 'step-2']);
    });

    it('should append to existing steps', () => {
      context.update({ completedSteps: ['step-1'] });
      context.update({ completedSteps: ['step-2'] });
      expect(context.completedSteps).toEqual(['step-1', 'step-2']);
    });

    it('should update failed steps', () => {
      context.update({ failedSteps: ['step-3'] });
      expect(context.failedSteps).toEqual(['step-3']);
    });

    it('should update successful approaches', () => {
      context.update({ successfulApproaches: [{ description: 'Approach 1' }] });
      expect(context.successfulApproaches).toHaveLength(1);
    });

    it('should handle empty updates', () => {
      context.update({});
      expect(context.completedSteps).toEqual([]);
    });

    it('should handle multiple update types at once', () => {
      context.update({
        completedSteps: ['step-1'],
        failedSteps: ['step-2'],
        successfulApproaches: [{ description: 'Pattern' }],
      });

      expect(context.completedSteps).toEqual(['step-1']);
      expect(context.failedSteps).toEqual(['step-2']);
      expect(context.successfulApproaches).toHaveLength(1);
    });
  });

  describe('recordBlockedReason', () => {
    it('should record blocked reason with timestamp', () => {
      context.recordBlockedReason('step-1', 'Network error', 1);

      expect(context.blockedReasons).toHaveLength(1);
      expect(context.blockedReasons[0].stepId).toBe('step-1');
      expect(context.blockedReasons[0].reason).toBe('Network error');
      expect(context.blockedReasons[0].depth).toBe(1);
      expect(context.blockedReasons[0].timestamp).toBeDefined();
    });

    it('should accumulate multiple blocked reasons', () => {
      context.recordBlockedReason('step-1', 'Error 1', 1);
      context.recordBlockedReason('step-2', 'Error 2', 2);

      expect(context.blockedReasons).toHaveLength(2);
    });
  });

  describe('recordSuccessfulApproach', () => {
    it('should record approach with timestamp', () => {
      context.recordSuccessfulApproach('Used caching', 'step-1');

      expect(context.successfulApproaches).toHaveLength(1);
      expect(context.successfulApproaches[0].description).toBe('Used caching');
      expect(context.successfulApproaches[0].stepId).toBe('step-1');
      expect(context.successfulApproaches[0].timestamp).toBeDefined();
    });

    it('should limit to 20 approaches', () => {
      for (let i = 0; i < 25; i++) {
        context.recordSuccessfulApproach(`Approach ${i}`, `step-${i}`);
      }

      expect(context.successfulApproaches).toHaveLength(20);
      expect(context.successfulApproaches[0].description).toBe('Approach 5');
      expect(context.successfulApproaches[19].description).toBe('Approach 24');
    });
  });

  describe('reset', () => {
    it('should clear all arrays', () => {
      context.update({ completedSteps: ['step-1'] });
      context.update({ failedSteps: ['step-2'] });
      context.recordBlockedReason('step-3', 'Error', 1);
      context.recordSuccessfulApproach('Approach', 'step-4');

      context.reset();

      expect(context.completedSteps).toEqual([]);
      expect(context.failedSteps).toEqual([]);
      expect(context.blockedReasons).toEqual([]);
      expect(context.successfulApproaches).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      context.update({ completedSteps: ['a', 'b'] });
      context.update({ failedSteps: ['c'] });
      context.recordBlockedReason('d', 'Error', 1);

      const stats = context.getStats();

      expect(stats.completedSteps).toBe(2);
      expect(stats.failedSteps).toBe(1);
      expect(stats.blockedReasons).toBe(1);
    });

    it('should return zeros for empty context', () => {
      const stats = context.getStats();

      expect(stats.completedSteps).toBe(0);
      expect(stats.failedSteps).toBe(0);
      expect(stats.blockedReasons).toBe(0);
    });
  });
});
