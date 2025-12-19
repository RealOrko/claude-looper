/**
 * Tests for quality-gates.js
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EscalationLevel,
  QualityGateType,
  QualityThresholds,
  PLAN_QUALITY_THRESHOLD,
  QualityGateResult,
  PlanQualityAssessment,
  ProgressMonitor,
  generateCorrection,
  determineEscalation,
} from '../quality-gates.js';

describe('Constants', () => {
  describe('EscalationLevel', () => {
    it('should have all escalation levels', () => {
      expect(EscalationLevel.NONE).toBe('none');
      expect(EscalationLevel.REMIND).toBe('remind');
      expect(EscalationLevel.CORRECT).toBe('correct');
      expect(EscalationLevel.REFOCUS).toBe('refocus');
      expect(EscalationLevel.CRITICAL).toBe('critical');
      expect(EscalationLevel.ABORT).toBe('abort');
    });
  });

  describe('QualityGateType', () => {
    it('should have all gate types', () => {
      expect(QualityGateType.PLAN_APPROVAL).toBe('plan_approval');
      expect(QualityGateType.CODE_APPROVAL).toBe('code_approval');
      expect(QualityGateType.STEP_COMPLETION).toBe('step_completion');
      expect(QualityGateType.GOAL_ACHIEVEMENT).toBe('goal_achievement');
    });
  });

  describe('QualityThresholds', () => {
    it('should have thresholds for all gate types', () => {
      expect(QualityThresholds[QualityGateType.PLAN_APPROVAL]).toBe(70);
      expect(QualityThresholds[QualityGateType.CODE_APPROVAL]).toBe(60);
      expect(QualityThresholds[QualityGateType.STEP_COMPLETION]).toBe(70);
      expect(QualityThresholds[QualityGateType.GOAL_ACHIEVEMENT]).toBe(80);
    });
  });

  describe('PLAN_QUALITY_THRESHOLD', () => {
    it('should be 70', () => {
      expect(PLAN_QUALITY_THRESHOLD).toBe(70);
    });
  });
});

describe('QualityGateResult', () => {
  let gate;

  beforeEach(() => {
    gate = new QualityGateResult(QualityGateType.PLAN_APPROVAL, 'plan_123');
  });

  describe('constructor', () => {
    it('should initialize with defaults', () => {
      expect(gate.gateType).toBe('plan_approval');
      expect(gate.targetId).toBe('plan_123');
      expect(gate.threshold).toBe(70);
      expect(gate.passed).toBe(false);
      expect(gate.decision).toBe('pending');
    });

    it('should use default threshold for unknown gate type', () => {
      const unknownGate = new QualityGateResult('unknown', 'id');
      expect(unknownGate.threshold).toBe(70);
    });
  });

  describe('evaluate', () => {
    it('should pass when score >= threshold', () => {
      gate.evaluate(75, [], []);
      expect(gate.passed).toBe(true);
      expect(gate.decision).toBe('approved');
    });

    it('should not pass when score < threshold', () => {
      gate.evaluate(65, ['Issue 1'], []);
      expect(gate.passed).toBe(false);
      expect(gate.decision).toBe('needs_revision');
    });

    it('should reject when score is very low', () => {
      gate.evaluate(40, ['Critical issue'], []);
      expect(gate.decision).toBe('rejected');
    });

    it('should store issues and suggestions', () => {
      gate.evaluate(60, ['Issue'], ['Suggestion']);
      expect(gate.issues).toEqual(['Issue']);
      expect(gate.suggestions).toEqual(['Suggestion']);
    });
  });

  describe('getSummary', () => {
    it('should return summary object', () => {
      gate.evaluate(80, ['Minor issue'], []);
      const summary = gate.getSummary();

      expect(summary.gateType).toBe('plan_approval');
      expect(summary.passed).toBe(true);
      expect(summary.score).toBe(80);
      expect(summary.threshold).toBe(70);
      expect(summary.issueCount).toBe(1);
    });
  });
});

describe('PlanQualityAssessment', () => {
  let assessment;
  const mockPlan = { id: 'plan_123' };

  beforeEach(() => {
    assessment = new PlanQualityAssessment(mockPlan);
  });

  describe('constructor', () => {
    it('should initialize with defaults', () => {
      expect(assessment.planId).toBe('plan_123');
      expect(assessment.score).toBe(0);
      expect(assessment.issues).toEqual([]);
      expect(assessment.approved).toBe(false);
    });
  });

  describe('addIssue', () => {
    it('should add issue with severity', () => {
      assessment.addIssue('critical', 'Major bug');
      expect(assessment.issues).toHaveLength(1);
      expect(assessment.issues[0].severity).toBe('critical');
    });
  });

  describe('addStrength', () => {
    it('should add strength', () => {
      assessment.addStrength('Good test coverage');
      expect(assessment.strengths).toContain('Good test coverage');
    });
  });

  describe('addSuggestion', () => {
    it('should add suggestion', () => {
      assessment.addSuggestion('Add more tests');
      expect(assessment.suggestions).toContain('Add more tests');
    });
  });

  describe('calculateScore', () => {
    it('should start at 100 and deduct for issues', () => {
      assessment.addIssue('minor', 'Small thing');
      const score = assessment.calculateScore();
      expect(score).toBe(95);
    });

    it('should deduct 30 for critical issues', () => {
      assessment.addIssue('critical', 'Critical bug');
      expect(assessment.calculateScore()).toBe(70);
    });

    it('should deduct 15 for major issues', () => {
      assessment.addIssue('major', 'Major bug');
      expect(assessment.calculateScore()).toBe(85);
    });

    it('should approve when score >= 70', () => {
      assessment.addIssue('minor', 'Small');
      assessment.calculateScore();
      expect(assessment.approved).toBe(true);
    });

    it('should not approve when score < 70', () => {
      assessment.addIssue('critical', 'Critical 1');
      assessment.addIssue('critical', 'Critical 2');
      assessment.calculateScore();
      expect(assessment.approved).toBe(false);
    });

    it('should clamp score to 0-100', () => {
      for (let i = 0; i < 10; i++) {
        assessment.addIssue('critical', `Issue ${i}`);
      }
      expect(assessment.calculateScore()).toBe(0);
    });
  });

  describe('getSummary', () => {
    it('should return summary', () => {
      assessment.addIssue('minor', 'Issue');
      assessment.addStrength('Strength');
      assessment.calculateScore();

      const summary = assessment.getSummary();
      expect(summary.planId).toBe('plan_123');
      expect(summary.issueCount).toBe(1);
      expect(summary.strengthCount).toBe(1);
    });
  });
});

describe('ProgressMonitor', () => {
  let monitor;

  beforeEach(() => {
    monitor = new ProgressMonitor({ stallThreshold: 1000 }); // 1 second for testing
  });

  describe('constructor', () => {
    it('should initialize with defaults', () => {
      expect(monitor.checkpoints).toEqual([]);
      expect(monitor.stallCount).toBe(0);
    });

    it('should use default stall threshold', () => {
      const defaultMonitor = new ProgressMonitor();
      expect(defaultMonitor.stallThreshold).toBe(5 * 60 * 1000);
    });
  });

  describe('recordCheckpoint', () => {
    it('should record checkpoint', () => {
      const checkpoint = monitor.recordCheckpoint('coding', { completedSteps: 1 });
      expect(monitor.checkpoints).toHaveLength(1);
      expect(checkpoint.phase).toBe('coding');
    });

    it('should reset stall count on progress', () => {
      monitor.stallCount = 3;
      monitor.recordCheckpoint('coding', { completedSteps: 1 });
      expect(monitor.stallCount).toBe(0);
    });

    it('should increment stall count on no progress', () => {
      monitor.recordCheckpoint('idle', { completedSteps: 0 });
      expect(monitor.stallCount).toBe(1);
    });

    it('should limit checkpoint history', () => {
      for (let i = 0; i < 150; i++) {
        monitor.recordCheckpoint('phase', { completedSteps: i });
      }
      expect(monitor.checkpoints.length).toBe(100);
    });
  });

  describe('calculateProgressScore', () => {
    it('should return 0 for null metrics', () => {
      expect(monitor.calculateProgressScore(null)).toBe(0);
    });

    it('should score completed steps positively', () => {
      expect(monitor.calculateProgressScore({ completedSteps: 2 })).toBe(20);
    });

    it('should score failed steps negatively', () => {
      expect(monitor.calculateProgressScore({ failedSteps: 2 })).toBe(-10);
    });

    it('should score fix cycles as partial progress', () => {
      expect(monitor.calculateProgressScore({ fixCycles: 3 })).toBe(6);
    });

    it('should combine all metrics', () => {
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
    it('should not be stalled initially', () => {
      expect(monitor.isStalled()).toBe(false);
    });

    it('should be stalled after threshold', async () => {
      monitor.lastProgressTime = Date.now() - 2000; // 2 seconds ago
      expect(monitor.isStalled()).toBe(true);
    });
  });

  describe('getStallDuration', () => {
    it('should return time since last progress', () => {
      monitor.lastProgressTime = Date.now() - 1000;
      const duration = monitor.getStallDuration();
      expect(duration).toBeGreaterThanOrEqual(1000);
      expect(duration).toBeLessThan(1100);
    });
  });

  describe('getProgressTrend', () => {
    it('should return unknown with few data points', () => {
      expect(monitor.getProgressTrend()).toBe('unknown');
    });

    it('should detect improving trend', () => {
      // Add old low scores
      for (let i = 0; i < 5; i++) {
        monitor.progressScores.push(10);
      }
      // Add recent high scores
      for (let i = 0; i < 5; i++) {
        monitor.progressScores.push(50);
      }
      expect(monitor.getProgressTrend()).toBe('improving');
    });

    it('should detect declining trend', () => {
      for (let i = 0; i < 5; i++) {
        monitor.progressScores.push(50);
      }
      for (let i = 0; i < 5; i++) {
        monitor.progressScores.push(10);
      }
      expect(monitor.getProgressTrend()).toBe('declining');
    });

    it('should detect stable trend', () => {
      for (let i = 0; i < 10; i++) {
        monitor.progressScores.push(30);
      }
      expect(monitor.getProgressTrend()).toBe('stable');
    });
  });

  describe('getSummary', () => {
    it('should return summary object', () => {
      monitor.recordCheckpoint('coding', { completedSteps: 1 });
      const summary = monitor.getSummary();

      expect(summary.checkpointCount).toBe(1);
      expect(summary.isStalled).toBe(false);
      expect(summary.stallCount).toBe(0);
      expect(summary.recentPhases).toContain('coding');
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

describe('determineEscalation', () => {
  const thresholds = { warn: 2, intervene: 3, critical: 4, abort: 5 };

  it('should return NONE when no issues', () => {
    expect(determineEscalation({ action: 'CONTINUE' }, 0, thresholds))
      .toBe(EscalationLevel.NONE);
  });

  it('should return REMIND for remind action', () => {
    expect(determineEscalation({ action: 'REMIND' }, 0, thresholds))
      .toBe(EscalationLevel.REMIND);
  });

  it('should return CORRECT at warn threshold', () => {
    expect(determineEscalation({ action: 'CONTINUE' }, 2, thresholds))
      .toBe(EscalationLevel.CORRECT);
  });

  it('should return REFOCUS at intervene threshold', () => {
    expect(determineEscalation({ action: 'CONTINUE' }, 3, thresholds))
      .toBe(EscalationLevel.REFOCUS);
  });

  it('should return CRITICAL at critical threshold', () => {
    expect(determineEscalation({ action: 'CONTINUE' }, 4, thresholds))
      .toBe(EscalationLevel.CRITICAL);
  });

  it('should return ABORT at abort threshold', () => {
    expect(determineEscalation({ action: 'CONTINUE' }, 5, thresholds))
      .toBe(EscalationLevel.ABORT);
  });
});

describe('generateCorrection', () => {
  const thresholds = { warn: 2, intervene: 3, critical: 4, abort: 5 };
  const assessment = { reason: 'Off track', score: 40 };
  const goal = 'Build feature X';

  it('should return null for NONE level', () => {
    expect(generateCorrection(EscalationLevel.NONE, assessment, goal, 0, thresholds))
      .toBeNull();
  });

  it('should return reminder for REMIND level', () => {
    const correction = generateCorrection(EscalationLevel.REMIND, assessment, goal, 1, thresholds);
    expect(correction.level).toBe(EscalationLevel.REMIND);
    expect(correction.prompt).toContain('Quick Reminder');
    expect(correction.prompt).toContain(goal);
  });

  it('should return correction for CORRECT level', () => {
    const correction = generateCorrection(EscalationLevel.CORRECT, assessment, goal, 2, thresholds);
    expect(correction.level).toBe(EscalationLevel.CORRECT);
    expect(correction.prompt).toContain('Course Correction');
    expect(correction.prompt).toContain('Score:');
  });

  it('should return refocus for REFOCUS level', () => {
    const correction = generateCorrection(EscalationLevel.REFOCUS, assessment, goal, 3, thresholds);
    expect(correction.level).toBe(EscalationLevel.REFOCUS);
    expect(correction.prompt).toContain('REFOCUS REQUIRED');
    expect(correction.prompt).toContain('STOP');
  });

  it('should return critical warning for CRITICAL level', () => {
    const correction = generateCorrection(EscalationLevel.CRITICAL, assessment, goal, 4, thresholds);
    expect(correction.level).toBe(EscalationLevel.CRITICAL);
    expect(correction.prompt).toContain('FINAL WARNING');
    expect(correction.prompt).toContain('TERMINATE');
  });

  it('should return abort with shouldAbort flag', () => {
    const correction = generateCorrection(EscalationLevel.ABORT, assessment, goal, 5, thresholds);
    expect(correction.level).toBe(EscalationLevel.ABORT);
    expect(correction.shouldAbort).toBe(true);
    expect(correction.prompt).toContain('TERMINATED');
  });
});
