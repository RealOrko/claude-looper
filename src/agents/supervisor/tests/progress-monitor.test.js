/**
 * Tests for Progress Monitor Module
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProgressMonitor } from '../progress-monitor.js';

describe('ProgressMonitor', () => {
  let monitor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    monitor = new ProgressMonitor();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(monitor.checkpoints).toEqual([]);
      expect(monitor.stallThreshold).toBe(5 * 60 * 1000);
      expect(monitor.progressScores).toEqual([]);
      expect(monitor.stallCount).toBe(0);
    });

    it('should accept custom stall threshold', () => {
      const customMonitor = new ProgressMonitor({ stallThreshold: 10000 });
      expect(customMonitor.stallThreshold).toBe(10000);
    });
  });

  describe('recordCheckpoint', () => {
    it('should record a checkpoint with metrics', () => {
      const checkpoint = monitor.recordCheckpoint('planning', {
        completedSteps: 2,
        failedSteps: 0,
      });

      expect(checkpoint.phase).toBe('planning');
      expect(checkpoint.metrics.completedSteps).toBe(2);
      expect(checkpoint.timestamp).toBeDefined();
      expect(checkpoint.progressScore).toBeGreaterThan(0);
    });

    it('should add checkpoint to history', () => {
      monitor.recordCheckpoint('phase1', { completedSteps: 1 });
      monitor.recordCheckpoint('phase2', { completedSteps: 2 });

      expect(monitor.checkpoints).toHaveLength(2);
    });

    it('should update lastProgressTime on positive progress', () => {
      const initialTime = monitor.lastProgressTime;

      vi.advanceTimersByTime(1000);
      monitor.recordCheckpoint('test', { completedSteps: 1 });

      expect(monitor.lastProgressTime).toBeGreaterThan(initialTime);
    });

    it('should increment stallCount on no progress', () => {
      monitor.recordCheckpoint('test', {});
      monitor.recordCheckpoint('test', {});

      expect(monitor.stallCount).toBe(2);
    });

    it('should reset stallCount on progress', () => {
      monitor.recordCheckpoint('test', {});
      monitor.recordCheckpoint('test', {});
      monitor.recordCheckpoint('test', { completedSteps: 1 });

      expect(monitor.stallCount).toBe(0);
    });

    it('should limit checkpoints to 100', () => {
      for (let i = 0; i < 150; i++) {
        monitor.recordCheckpoint(`phase-${i}`, { completedSteps: 1 });
      }

      expect(monitor.checkpoints).toHaveLength(100);
    });

    it('should keep most recent checkpoints when trimming', () => {
      for (let i = 0; i < 105; i++) {
        monitor.recordCheckpoint(`phase-${i}`, { completedSteps: 1 });
      }

      expect(monitor.checkpoints[0].phase).toBe('phase-5');
      expect(monitor.checkpoints[99].phase).toBe('phase-104');
    });
  });

  describe('calculateProgressScore', () => {
    it('should return 0 for null metrics', () => {
      expect(monitor.calculateProgressScore(null)).toBe(0);
    });

    it('should return 0 for empty metrics', () => {
      expect(monitor.calculateProgressScore({})).toBe(0);
    });

    it('should add 10 per completed step', () => {
      const score = monitor.calculateProgressScore({ completedSteps: 3 });
      expect(score).toBe(30);
    });

    it('should subtract 5 per failed step', () => {
      const score = monitor.calculateProgressScore({ failedSteps: 2 });
      expect(score).toBe(-10);
    });

    it('should add 2 per fix cycle', () => {
      const score = monitor.calculateProgressScore({ fixCycles: 4 });
      expect(score).toBe(8);
    });

    it('should add 3 per verification passed', () => {
      const score = monitor.calculateProgressScore({ verificationsPassed: 5 });
      expect(score).toBe(15);
    });

    it('should combine all metrics correctly', () => {
      const score = monitor.calculateProgressScore({
        completedSteps: 2,  // +20
        failedSteps: 1,     // -5
        fixCycles: 3,       // +6
        verificationsPassed: 2, // +6
      });
      expect(score).toBe(27);
    });
  });

  describe('isStalled', () => {
    it('should return false initially', () => {
      expect(monitor.isStalled()).toBe(false);
    });

    it('should return true after stall threshold', () => {
      vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes
      expect(monitor.isStalled()).toBe(true);
    });

    it('should return false after progress is made', () => {
      vi.advanceTimersByTime(6 * 60 * 1000);
      expect(monitor.isStalled()).toBe(true);

      monitor.recordCheckpoint('test', { completedSteps: 1 });
      expect(monitor.isStalled()).toBe(false);
    });
  });

  describe('getStallDuration', () => {
    it('should return time since last progress', () => {
      vi.advanceTimersByTime(30000); // 30 seconds
      expect(monitor.getStallDuration()).toBe(30000);
    });

    it('should reset after progress', () => {
      vi.advanceTimersByTime(60000);
      monitor.recordCheckpoint('test', { completedSteps: 1 });
      expect(monitor.getStallDuration()).toBe(0);
    });
  });

  describe('getProgressTrend', () => {
    it('should return unknown with less than 3 scores', () => {
      monitor.recordCheckpoint('test', { completedSteps: 1 });
      monitor.recordCheckpoint('test', { completedSteps: 2 });

      expect(monitor.getProgressTrend()).toBe('unknown');
    });

    it('should return unknown when no older scores to compare', () => {
      for (let i = 0; i < 4; i++) {
        monitor.recordCheckpoint('test', { completedSteps: i });
      }

      expect(monitor.getProgressTrend()).toBe('unknown');
    });

    it('should return improving when recent scores are higher', () => {
      // Older scores (lower)
      for (let i = 0; i < 5; i++) {
        monitor.recordCheckpoint('test', { completedSteps: 1 });
      }
      // Recent scores (higher)
      for (let i = 0; i < 5; i++) {
        monitor.recordCheckpoint('test', { completedSteps: 5 });
      }

      expect(monitor.getProgressTrend()).toBe('improving');
    });

    it('should return declining when recent scores are lower', () => {
      // Older scores (higher)
      for (let i = 0; i < 5; i++) {
        monitor.recordCheckpoint('test', { completedSteps: 5 });
      }
      // Recent scores (lower)
      for (let i = 0; i < 5; i++) {
        monitor.recordCheckpoint('test', { completedSteps: 1 });
      }

      expect(monitor.getProgressTrend()).toBe('declining');
    });

    it('should return stable when scores are similar', () => {
      for (let i = 0; i < 10; i++) {
        monitor.recordCheckpoint('test', { completedSteps: 3 });
      }

      expect(monitor.getProgressTrend()).toBe('stable');
    });
  });

  describe('getSummary', () => {
    it('should return complete summary object', () => {
      monitor.recordCheckpoint('planning', { completedSteps: 1 });
      monitor.recordCheckpoint('execution', { completedSteps: 2 });

      const summary = monitor.getSummary();

      expect(summary).toHaveProperty('checkpointCount');
      expect(summary).toHaveProperty('isStalled');
      expect(summary).toHaveProperty('stallDuration');
      expect(summary).toHaveProperty('stallCount');
      expect(summary).toHaveProperty('trend');
      expect(summary).toHaveProperty('recentPhases');
      expect(summary).toHaveProperty('averageProgressScore');
    });

    it('should return correct checkpoint count', () => {
      monitor.recordCheckpoint('p1', { completedSteps: 1 });
      monitor.recordCheckpoint('p2', { completedSteps: 2 });
      monitor.recordCheckpoint('p3', { completedSteps: 3 });

      expect(monitor.getSummary().checkpointCount).toBe(3);
    });

    it('should return recent phases (max 5)', () => {
      for (let i = 0; i < 10; i++) {
        monitor.recordCheckpoint(`phase-${i}`, { completedSteps: 1 });
      }

      const summary = monitor.getSummary();
      expect(summary.recentPhases).toHaveLength(5);
      expect(summary.recentPhases).toEqual([
        'phase-5', 'phase-6', 'phase-7', 'phase-8', 'phase-9',
      ]);
    });

    it('should calculate average progress score', () => {
      monitor.recordCheckpoint('p1', { completedSteps: 1 }); // 10
      monitor.recordCheckpoint('p2', { completedSteps: 2 }); // 20
      monitor.recordCheckpoint('p3', { completedSteps: 3 }); // 30

      const summary = monitor.getSummary();
      expect(summary.averageProgressScore).toBe(20); // (10+20+30)/3
    });

    it('should return 0 average for no checkpoints', () => {
      expect(monitor.getSummary().averageProgressScore).toBe(0);
    });
  });

  describe('reset', () => {
    it('should clear all checkpoints', () => {
      monitor.recordCheckpoint('test', { completedSteps: 1 });
      monitor.reset();

      expect(monitor.checkpoints).toEqual([]);
    });

    it('should clear progress scores', () => {
      monitor.recordCheckpoint('test', { completedSteps: 1 });
      monitor.reset();

      expect(monitor.progressScores).toEqual([]);
    });

    it('should reset stall count', () => {
      monitor.recordCheckpoint('test', {});
      monitor.recordCheckpoint('test', {});
      monitor.reset();

      expect(monitor.stallCount).toBe(0);
    });

    it('should reset last progress time to now', () => {
      vi.advanceTimersByTime(60000);
      monitor.reset();

      expect(monitor.getStallDuration()).toBe(0);
    });
  });

  describe('getLastCheckpoint', () => {
    it('should return null when no checkpoints', () => {
      expect(monitor.getLastCheckpoint()).toBeNull();
    });

    it('should return most recent checkpoint', () => {
      monitor.recordCheckpoint('first', { completedSteps: 1 });
      monitor.recordCheckpoint('second', { completedSteps: 2 });

      const last = monitor.getLastCheckpoint();
      expect(last.phase).toBe('second');
    });
  });

  describe('getCheckpointsForPhase', () => {
    it('should return empty array for non-existent phase', () => {
      monitor.recordCheckpoint('other', { completedSteps: 1 });

      expect(monitor.getCheckpointsForPhase('test')).toEqual([]);
    });

    it('should return all checkpoints for a phase', () => {
      monitor.recordCheckpoint('planning', { completedSteps: 1 });
      monitor.recordCheckpoint('execution', { completedSteps: 2 });
      monitor.recordCheckpoint('planning', { completedSteps: 3 });

      const planningCheckpoints = monitor.getCheckpointsForPhase('planning');
      expect(planningCheckpoints).toHaveLength(2);
    });
  });

  describe('getTotalElapsedTime', () => {
    it('should return 0 when no checkpoints', () => {
      expect(monitor.getTotalElapsedTime()).toBe(0);
    });

    it('should return time since first checkpoint', () => {
      monitor.recordCheckpoint('first', { completedSteps: 1 });
      vi.advanceTimersByTime(30000);

      expect(monitor.getTotalElapsedTime()).toBe(30000);
    });
  });
});
