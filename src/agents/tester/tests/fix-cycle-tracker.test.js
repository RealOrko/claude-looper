import { describe, it, expect, beforeEach } from 'vitest';
import { FixCycleTracker } from '../fix-cycle-tracker.js';
import { FixCycleStatus } from '../../interfaces.js';

describe('FixCycleTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new FixCycleTracker(3);
  });

  describe('constructor', () => {
    it('should initialize with default max cycles', () => {
      const defaultTracker = new FixCycleTracker();
      expect(defaultTracker.maxFixCycles).toBe(3);
    });

    it('should initialize with custom max cycles', () => {
      const customTracker = new FixCycleTracker(5);
      expect(customTracker.maxFixCycles).toBe(5);
    });

    it('should initialize empty learning context', () => {
      const context = tracker.getLearningContext();
      expect(context.commonIssues).toHaveLength(0);
      expect(context.successfulFixes).toHaveLength(0);
      expect(context.failedApproaches).toHaveLength(0);
    });
  });

  describe('initializeFixCycle', () => {
    it('should create new tracker for step', () => {
      const info = tracker.initializeFixCycle('step_1');

      expect(info.attempts).toBe(0);
      expect(info.status).toBe(FixCycleStatus.NOT_STARTED);
      expect(info.previousPlans).toHaveLength(0);
    });

    it('should increment attempts when previous fix plan provided', () => {
      tracker.initializeFixCycle('step_1');
      const info = tracker.initializeFixCycle('step_1', { id: 'plan_1', issues: [1, 2] });

      expect(info.attempts).toBe(1);
      expect(info.previousPlans).toHaveLength(1);
    });

    it('should track multiple attempts', () => {
      tracker.initializeFixCycle('step_1');
      tracker.initializeFixCycle('step_1', { id: 'plan_1' });
      tracker.initializeFixCycle('step_1', { id: 'plan_2' });
      const info = tracker.initializeFixCycle('step_1', { id: 'plan_3' });

      expect(info.attempts).toBe(3);
      expect(info.previousPlans).toHaveLength(3);
    });
  });

  describe('updateFixCycleStatus', () => {
    it('should update status to resolved', () => {
      tracker.initializeFixCycle('step_1');
      tracker.updateFixCycleStatus('step_1', 'resolved', []);

      const info = tracker.get('step_1');
      expect(info.status).toBe(FixCycleStatus.RESOLVED);
    });

    it('should update status to in_progress', () => {
      tracker.initializeFixCycle('step_1');
      tracker.updateFixCycleStatus('step_1', 'in_progress', ['issue1']);

      const info = tracker.get('step_1');
      expect(info.status).toBe(FixCycleStatus.IN_PROGRESS);
      expect(info.issues).toContain('issue1');
    });

    it('should set max_attempts_reached when exceeded', () => {
      tracker.initializeFixCycle('step_1');
      tracker.initializeFixCycle('step_1', { id: '1' });
      tracker.initializeFixCycle('step_1', { id: '2' });
      tracker.initializeFixCycle('step_1', { id: '3' });
      tracker.updateFixCycleStatus('step_1', 'other');

      const info = tracker.get('step_1');
      expect(info.status).toBe(FixCycleStatus.MAX_ATTEMPTS_REACHED);
    });
  });

  describe('getFixCycleStatus', () => {
    it('should return default status for unknown step', () => {
      const status = tracker.getFixCycleStatus('unknown_step');

      expect(status.status).toBe(FixCycleStatus.NOT_STARTED);
      expect(status.attempts).toBe(0);
      expect(status.canRetry).toBe(true);
    });

    it('should return correct canRetry when attempts remain', () => {
      tracker.initializeFixCycle('step_1');
      tracker.initializeFixCycle('step_1', { id: '1' });

      const status = tracker.getFixCycleStatus('step_1');
      expect(status.canRetry).toBe(true);
    });

    it('should return canRetry false when max reached', () => {
      tracker.initializeFixCycle('step_1');
      for (let i = 0; i < 3; i++) {
        tracker.initializeFixCycle('step_1', { id: `plan_${i}` });
      }

      const status = tracker.getFixCycleStatus('step_1');
      expect(status.canRetry).toBe(false);
    });

    it('should return canRetry false when resolved', () => {
      tracker.initializeFixCycle('step_1');
      tracker.updateFixCycleStatus('step_1', 'resolved');

      const status = tracker.getFixCycleStatus('step_1');
      expect(status.canRetry).toBe(false);
    });
  });

  describe('recordSuccessfulFix', () => {
    it('should record successful fix', () => {
      tracker.recordSuccessfulFix('step_1', {
        suggestedApproach: 'Refactored the function',
        issues: [{ category: 'logic_error' }],
      });

      const context = tracker.getLearningContext();
      expect(context.successfulFixes).toHaveLength(1);
      expect(context.successfulFixes[0].approach).toBe('Refactored the function');
    });

    it('should not record if no fix plan', () => {
      tracker.recordSuccessfulFix('step_1', null);

      const context = tracker.getLearningContext();
      expect(context.successfulFixes).toHaveLength(0);
    });

    it('should limit successful fixes to 20', () => {
      for (let i = 0; i < 25; i++) {
        tracker.recordSuccessfulFix(`step_${i}`, { suggestedApproach: `Approach ${i}` });
      }

      const context = tracker.getLearningContext();
      expect(context.successfulFixes).toHaveLength(20);
    });
  });

  describe('recordFailedApproach', () => {
    it('should record failed approach', () => {
      tracker.recordFailedApproach('step_1', 'Tried brute force', 'Too slow');

      const context = tracker.getLearningContext();
      expect(context.failedApproaches).toHaveLength(1);
      expect(context.failedApproaches[0].approach).toBe('Tried brute force');
      expect(context.failedApproaches[0].reason).toBe('Too slow');
    });

    it('should limit failed approaches to 20', () => {
      for (let i = 0; i < 25; i++) {
        tracker.recordFailedApproach(`step_${i}`, `Approach ${i}`, 'Failed');
      }

      const context = tracker.getLearningContext();
      expect(context.failedApproaches).toHaveLength(20);
    });
  });

  describe('addToCommonIssues', () => {
    it('should add common issue', () => {
      tracker.addToCommonIssues('Null pointer exception in main function');

      const context = tracker.getLearningContext();
      expect(context.commonIssues).toHaveLength(1);
    });

    it('should truncate to 100 characters', () => {
      const longDescription = 'A'.repeat(200);
      tracker.addToCommonIssues(longDescription);

      const context = tracker.getLearningContext();
      expect(context.commonIssues[0].length).toBe(100);
    });

    it('should not add duplicates', () => {
      tracker.addToCommonIssues('Same issue');
      tracker.addToCommonIssues('Same issue');

      const context = tracker.getLearningContext();
      expect(context.commonIssues).toHaveLength(1);
    });

    it('should limit to 10 common issues', () => {
      for (let i = 0; i < 15; i++) {
        tracker.addToCommonIssues(`Issue ${i}`);
      }

      const context = tracker.getLearningContext();
      expect(context.commonIssues).toHaveLength(10);
    });
  });

  describe('reset', () => {
    it('should clear all trackers', () => {
      tracker.initializeFixCycle('step_1');
      tracker.initializeFixCycle('step_2');

      tracker.reset();

      expect(tracker.size).toBe(0);
    });
  });

  describe('size', () => {
    it('should return number of tracked cycles', () => {
      expect(tracker.size).toBe(0);

      tracker.initializeFixCycle('step_1');
      expect(tracker.size).toBe(1);

      tracker.initializeFixCycle('step_2');
      expect(tracker.size).toBe(2);
    });
  });

  describe('get', () => {
    it('should return tracker for step', () => {
      tracker.initializeFixCycle('step_1');
      const info = tracker.get('step_1');

      expect(info).toBeDefined();
      expect(info.attempts).toBe(0);
    });

    it('should return undefined for unknown step', () => {
      expect(tracker.get('unknown')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for existing step', () => {
      tracker.initializeFixCycle('step_1');
      expect(tracker.has('step_1')).toBe(true);
    });

    it('should return false for unknown step', () => {
      expect(tracker.has('unknown')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      tracker.initializeFixCycle('step_1');
      tracker.updateFixCycleStatus('step_1', 'resolved');

      tracker.initializeFixCycle('step_2');
      tracker.updateFixCycleStatus('step_2', 'in_progress');

      tracker.initializeFixCycle('step_3');
      for (let i = 0; i < 3; i++) {
        tracker.initializeFixCycle('step_3', { id: `p${i}` });
      }
      tracker.updateFixCycleStatus('step_3', 'other');

      const stats = tracker.getStats();

      expect(stats.totalCycles).toBe(3);
      expect(stats.resolved).toBe(1);
      expect(stats.inProgress).toBe(1);
      expect(stats.maxAttemptsReached).toBe(1);
    });
  });
});
