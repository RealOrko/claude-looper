import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProgressMonitor, generateCorrection, determineEscalation } from '../progress-monitor.js';

describe('ProgressMonitor', () => {
  let monitor;

  beforeEach(() => {
    monitor = new ProgressMonitor();
  });

  describe('constructor', () => {
    it('should initialize with defaults', () => {
      expect(monitor.checkpoints).toEqual([]);
      expect(monitor.stallThreshold).toBe(5 * 60 * 1000);
      expect(monitor.progressScores).toEqual([]);
      expect(monitor.stallCount).toBe(0);
    });

    it('should accept custom stall threshold', () => {
      const custom = new ProgressMonitor({ stallThreshold: 10000 });
      expect(custom.stallThreshold).toBe(10000);
    });
  });

  describe('recordCheckpoint', () => {
    it('should record a checkpoint with metrics', () => {
      const checkpoint = monitor.recordCheckpoint('working', { completedSteps: 2 });
      expect(monitor.checkpoints).toHaveLength(1);
      expect(checkpoint.phase).toBe('working');
      expect(checkpoint.progressScore).toBeGreaterThan(0);
    });

    it('should update lastProgressTime on positive progress', () => {
      monitor.lastProgressTime = Date.now() - 1000;
      const before = monitor.lastProgressTime;
      monitor.recordCheckpoint('working', { completedSteps: 1 });
      expect(monitor.lastProgressTime).toBeGreaterThan(before);
    });

    it('should increment stallCount when no progress', () => {
      monitor.recordCheckpoint('working', {});
      expect(monitor.stallCount).toBe(1);
    });

    it('should reset stallCount on positive progress', () => {
      monitor.stallCount = 5;
      monitor.recordCheckpoint('working', { completedSteps: 1 });
      expect(monitor.stallCount).toBe(0);
    });

    it('should trim checkpoints to 100 entries', () => {
      for (let i = 0; i < 110; i++) {
        monitor.recordCheckpoint('phase', { completedSteps: 1 });
      }
      expect(monitor.checkpoints).toHaveLength(100);
    });
  });

  describe('calculateProgressScore', () => {
    it('should return 0 for null metrics', () => {
      expect(monitor.calculateProgressScore(null)).toBe(0);
    });

    it('should add points for completed steps', () => {
      expect(monitor.calculateProgressScore({ completedSteps: 3 })).toBe(30);
    });

    it('should subtract points for failed steps', () => {
      expect(monitor.calculateProgressScore({ failedSteps: 2 })).toBe(-10);
    });

    it('should add points for fix cycles', () => {
      expect(monitor.calculateProgressScore({ fixCycles: 2 })).toBe(4);
    });

    it('should add points for passed verifications', () => {
      expect(monitor.calculateProgressScore({ verificationsPassed: 2 })).toBe(6);
    });

    it('should combine multiple metrics', () => {
      const score = monitor.calculateProgressScore({
        completedSteps: 1,
        failedSteps: 1,
        fixCycles: 1,
        verificationsPassed: 1,
      });
      expect(score).toBe(10 - 5 + 2 + 3);
    });
  });

  describe('isStalled', () => {
    it('should return false initially', () => {
      expect(monitor.isStalled()).toBe(false);
    });

    it('should return true after stall threshold passed', () => {
      monitor.lastProgressTime = Date.now() - 10 * 60 * 1000;
      expect(monitor.isStalled()).toBe(true);
    });
  });

  describe('getStallDuration', () => {
    it('should return time since last progress', () => {
      monitor.lastProgressTime = Date.now() - 1000;
      expect(monitor.getStallDuration()).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('getProgressTrend', () => {
    it('should return unknown with less than 3 scores', () => {
      monitor.progressScores = [10, 20];
      expect(monitor.getProgressTrend()).toBe('unknown');
    });

    it('should return improving when recent scores higher', () => {
      monitor.progressScores = [10, 10, 10, 10, 10, 20, 20, 20, 20, 20];
      expect(monitor.getProgressTrend()).toBe('improving');
    });

    it('should return declining when recent scores lower', () => {
      monitor.progressScores = [20, 20, 20, 20, 20, 10, 10, 10, 10, 10];
      expect(monitor.getProgressTrend()).toBe('declining');
    });

    it('should return stable when scores similar', () => {
      monitor.progressScores = [15, 15, 15, 15, 15, 15, 15, 15, 15, 15];
      expect(monitor.getProgressTrend()).toBe('stable');
    });
  });

  describe('getSummary', () => {
    it('should return summary object', () => {
      monitor.recordCheckpoint('working', { completedSteps: 1 });
      const summary = monitor.getSummary();

      expect(summary).toHaveProperty('checkpointCount');
      expect(summary).toHaveProperty('isStalled');
      expect(summary).toHaveProperty('stallDuration');
      expect(summary).toHaveProperty('stallCount');
      expect(summary).toHaveProperty('trend');
      expect(summary).toHaveProperty('recentPhases');
      expect(summary).toHaveProperty('averageProgressScore');
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      monitor.recordCheckpoint('phase', { completedSteps: 1 });
      monitor.stallCount = 5;
      monitor.reset();

      expect(monitor.checkpoints).toEqual([]);
      expect(monitor.progressScores).toEqual([]);
      expect(monitor.stallCount).toBe(0);
    });
  });
});

describe('generateCorrection', () => {
  const assessment = { score: 50, reason: 'Drifting off-task' };
  const goal = 'Complete the feature';
  const thresholds = { abort: 5, critical: 4, intervene: 3, warn: 2 };

  it('should generate REMIND correction', () => {
    const result = generateCorrection('remind', assessment, goal, 1, thresholds);
    expect(result.level).toBe('remind');
    expect(result.prompt).toContain('Quick Reminder');
  });

  it('should generate CORRECT correction', () => {
    const result = generateCorrection('correct', assessment, goal, 2, thresholds);
    expect(result.level).toBe('correct');
    expect(result.prompt).toContain('Course Correction');
  });

  it('should generate REFOCUS correction', () => {
    const result = generateCorrection('refocus', assessment, goal, 3, thresholds);
    expect(result.level).toBe('refocus');
    expect(result.prompt).toContain('REFOCUS REQUIRED');
  });

  it('should generate CRITICAL correction', () => {
    const result = generateCorrection('critical', assessment, goal, 4, thresholds);
    expect(result.level).toBe('critical');
    expect(result.prompt).toContain('FINAL WARNING');
  });

  it('should generate ABORT correction with shouldAbort flag', () => {
    const result = generateCorrection('abort', assessment, goal, 5, thresholds);
    expect(result.level).toBe('abort');
    expect(result.prompt).toContain('SESSION TERMINATED');
    expect(result.shouldAbort).toBe(true);
  });

  it('should return null for unknown level', () => {
    const result = generateCorrection('unknown', assessment, goal, 1, thresholds);
    expect(result).toBeNull();
  });
});

describe('determineEscalation', () => {
  const thresholds = { abort: 5, critical: 4, intervene: 3, warn: 2 };

  it('should return ABORT when at abort threshold', () => {
    expect(determineEscalation({}, 5, thresholds)).toBe('abort');
  });

  it('should return CRITICAL when at critical threshold', () => {
    expect(determineEscalation({}, 4, thresholds)).toBe('critical');
  });

  it('should return REFOCUS when at intervene threshold', () => {
    expect(determineEscalation({}, 3, thresholds)).toBe('refocus');
  });

  it('should return CORRECT when at warn threshold', () => {
    expect(determineEscalation({}, 2, thresholds)).toBe('correct');
  });

  it('should return REMIND when assessment action is REMIND', () => {
    expect(determineEscalation({ action: 'REMIND' }, 0, thresholds)).toBe('remind');
  });

  it('should return NONE otherwise', () => {
    expect(determineEscalation({}, 0, thresholds)).toBe('none');
  });
});
