/**
 * Tests for quality-gates.js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  QualityGateType,
  QualityThresholds,
  QualityGateResult,
} from '../quality-gates.js';

describe('QualityGateType', () => {
  it('should have all gate types defined', () => {
    expect(QualityGateType.PLAN_APPROVAL).toBe('plan_approval');
    expect(QualityGateType.CODE_APPROVAL).toBe('code_approval');
    expect(QualityGateType.STEP_COMPLETION).toBe('step_completion');
    expect(QualityGateType.GOAL_ACHIEVEMENT).toBe('goal_achievement');
  });

  it('should have exactly 4 gate types', () => {
    expect(Object.keys(QualityGateType)).toHaveLength(4);
  });

  it('should be immutable reference', () => {
    const original = QualityGateType.PLAN_APPROVAL;
    expect(original).toBe('plan_approval');
  });
});

describe('QualityThresholds', () => {
  it('should have thresholds for all gate types', () => {
    expect(QualityThresholds[QualityGateType.PLAN_APPROVAL]).toBe(70);
    expect(QualityThresholds[QualityGateType.CODE_APPROVAL]).toBe(60);
    expect(QualityThresholds[QualityGateType.STEP_COMPLETION]).toBe(70);
    expect(QualityThresholds[QualityGateType.GOAL_ACHIEVEMENT]).toBe(80);
  });

  it('should have thresholds in valid range (0-100)', () => {
    for (const [key, value] of Object.entries(QualityThresholds)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('should have goal achievement as highest threshold', () => {
    const values = Object.values(QualityThresholds);
    const maxThreshold = Math.max(...values);
    expect(QualityThresholds[QualityGateType.GOAL_ACHIEVEMENT]).toBe(maxThreshold);
  });

  it('should have code approval as lowest threshold', () => {
    const values = Object.values(QualityThresholds);
    const minThreshold = Math.min(...values);
    expect(QualityThresholds[QualityGateType.CODE_APPROVAL]).toBe(minThreshold);
  });
});

describe('QualityGateResult', () => {
  let gate;

  beforeEach(() => {
    gate = new QualityGateResult(QualityGateType.PLAN_APPROVAL, 'plan_123');
  });

  describe('constructor', () => {
    it('should initialize with correct gate type', () => {
      expect(gate.gateType).toBe('plan_approval');
    });

    it('should initialize with correct target ID', () => {
      expect(gate.targetId).toBe('plan_123');
    });

    it('should generate a unique ID', () => {
      expect(gate.id).toMatch(/^gate_\d+_[a-z0-9]+$/);
    });

    it('should generate different IDs for each instance', () => {
      const gate2 = new QualityGateResult(QualityGateType.PLAN_APPROVAL, 'plan_456');
      expect(gate.id).not.toBe(gate2.id);
    });

    it('should set threshold from QualityThresholds', () => {
      expect(gate.threshold).toBe(70);
    });

    it('should use default threshold of 70 for unknown gate type', () => {
      const unknownGate = new QualityGateResult('unknown_type', 'id');
      expect(unknownGate.threshold).toBe(70);
    });

    it('should initialize score to 0', () => {
      expect(gate.score).toBe(0);
    });

    it('should initialize passed to false', () => {
      expect(gate.passed).toBe(false);
    });

    it('should initialize issues as empty array', () => {
      expect(gate.issues).toEqual([]);
    });

    it('should initialize suggestions as empty array', () => {
      expect(gate.suggestions).toEqual([]);
    });

    it('should initialize decision as pending', () => {
      expect(gate.decision).toBe('pending');
    });

    it('should initialize reason as empty string', () => {
      expect(gate.reason).toBe('');
    });

    it('should set timestamp', () => {
      expect(gate.timestamp).toBeLessThanOrEqual(Date.now());
      expect(gate.timestamp).toBeGreaterThan(Date.now() - 1000);
    });

    it('should use CODE_APPROVAL threshold for code gates', () => {
      const codeGate = new QualityGateResult(QualityGateType.CODE_APPROVAL, 'code_1');
      expect(codeGate.threshold).toBe(60);
    });

    it('should use GOAL_ACHIEVEMENT threshold for goal gates', () => {
      const goalGate = new QualityGateResult(QualityGateType.GOAL_ACHIEVEMENT, 'goal');
      expect(goalGate.threshold).toBe(80);
    });
  });

  describe('evaluate', () => {
    it('should pass when score >= threshold', () => {
      gate.evaluate(70, [], []);
      expect(gate.passed).toBe(true);
    });

    it('should pass when score > threshold', () => {
      gate.evaluate(85, [], []);
      expect(gate.passed).toBe(true);
    });

    it('should not pass when score < threshold', () => {
      gate.evaluate(69, [], []);
      expect(gate.passed).toBe(false);
    });

    it('should set decision to approved when passing', () => {
      gate.evaluate(75, [], []);
      expect(gate.decision).toBe('approved');
    });

    it('should set decision to needs_revision when slightly below threshold', () => {
      gate.evaluate(55, [], []);
      expect(gate.decision).toBe('needs_revision');
    });

    it('should set decision to rejected when score is very low', () => {
      gate.evaluate(40, [], []);
      expect(gate.decision).toBe('rejected');
    });

    it('should reject when score is exactly 20 below threshold', () => {
      gate.evaluate(49, [], []);  // threshold is 70, so 70-20=50, and 49 < 50
      expect(gate.decision).toBe('rejected');
    });

    it('should not reject at boundary (threshold - 20)', () => {
      gate.evaluate(50, [], []);  // threshold is 70, exactly at boundary
      expect(gate.decision).toBe('needs_revision');
    });

    it('should store score', () => {
      gate.evaluate(65, [], []);
      expect(gate.score).toBe(65);
    });

    it('should store issues', () => {
      const issues = ['Issue 1', 'Issue 2'];
      gate.evaluate(60, issues, []);
      expect(gate.issues).toEqual(issues);
    });

    it('should store suggestions', () => {
      const suggestions = ['Suggestion 1', 'Suggestion 2'];
      gate.evaluate(60, [], suggestions);
      expect(gate.suggestions).toEqual(suggestions);
    });

    it('should handle empty issues with defaults', () => {
      gate.evaluate(80);
      expect(gate.issues).toEqual([]);
    });

    it('should handle empty suggestions with defaults', () => {
      gate.evaluate(80);
      expect(gate.suggestions).toEqual([]);
    });

    it('should overwrite previous evaluation', () => {
      gate.evaluate(80, ['old issue'], ['old suggestion']);
      expect(gate.passed).toBe(true);

      gate.evaluate(40, ['new issue'], ['new suggestion']);
      expect(gate.passed).toBe(false);
      expect(gate.issues).toEqual(['new issue']);
      expect(gate.suggestions).toEqual(['new suggestion']);
    });
  });

  describe('getSummary', () => {
    it('should return gateType', () => {
      const summary = gate.getSummary();
      expect(summary.gateType).toBe('plan_approval');
    });

    it('should return passed status', () => {
      gate.evaluate(80, [], []);
      const summary = gate.getSummary();
      expect(summary.passed).toBe(true);
    });

    it('should return score', () => {
      gate.evaluate(75, [], []);
      const summary = gate.getSummary();
      expect(summary.score).toBe(75);
    });

    it('should return threshold', () => {
      const summary = gate.getSummary();
      expect(summary.threshold).toBe(70);
    });

    it('should return decision', () => {
      gate.evaluate(80, [], []);
      const summary = gate.getSummary();
      expect(summary.decision).toBe('approved');
    });

    it('should return issueCount', () => {
      gate.evaluate(60, ['issue1', 'issue2', 'issue3'], []);
      const summary = gate.getSummary();
      expect(summary.issueCount).toBe(3);
    });

    it('should return all expected fields', () => {
      gate.evaluate(75, ['minor issue'], ['suggestion']);
      const summary = gate.getSummary();

      expect(summary).toEqual({
        gateType: 'plan_approval',
        passed: true,
        score: 75,
        threshold: 70,
        decision: 'approved',
        issueCount: 1,
      });
    });

    it('should not include issues array in summary', () => {
      gate.evaluate(60, ['issue1', 'issue2'], []);
      const summary = gate.getSummary();
      expect(summary.issues).toBeUndefined();
    });

    it('should not include suggestions array in summary', () => {
      gate.evaluate(60, [], ['suggestion']);
      const summary = gate.getSummary();
      expect(summary.suggestions).toBeUndefined();
    });
  });

  describe('integration scenarios', () => {
    it('should handle full approval workflow', () => {
      const planGate = new QualityGateResult(QualityGateType.PLAN_APPROVAL, 'plan_001');

      expect(planGate.decision).toBe('pending');

      planGate.evaluate(85, [], ['Consider adding error handling']);

      expect(planGate.passed).toBe(true);
      expect(planGate.decision).toBe('approved');
      expect(planGate.suggestions).toHaveLength(1);

      const summary = planGate.getSummary();
      expect(summary.passed).toBe(true);
      expect(summary.issueCount).toBe(0);
    });

    it('should handle rejection workflow', () => {
      const codeGate = new QualityGateResult(QualityGateType.CODE_APPROVAL, 'code_001');

      codeGate.evaluate(30, ['Missing tests', 'No error handling', 'Security vulnerability'], []);

      expect(codeGate.passed).toBe(false);
      expect(codeGate.decision).toBe('rejected');
      expect(codeGate.issues).toHaveLength(3);
    });

    it('should handle needs_revision workflow', () => {
      const stepGate = new QualityGateResult(QualityGateType.STEP_COMPLETION, 'step_001');

      stepGate.evaluate(60, ['Partially implemented'], ['Complete the remaining parts']);

      expect(stepGate.passed).toBe(false);
      expect(stepGate.decision).toBe('needs_revision');
    });

    it('should track reason separately from issues', () => {
      const gate = new QualityGateResult(QualityGateType.GOAL_ACHIEVEMENT, 'goal');
      gate.evaluate(75, ['Minor gap in coverage'], []);
      gate.reason = 'Almost complete but missing one key feature';

      expect(gate.reason).toBe('Almost complete but missing one key feature');
      expect(gate.issues).toEqual(['Minor gap in coverage']);
    });
  });
});
