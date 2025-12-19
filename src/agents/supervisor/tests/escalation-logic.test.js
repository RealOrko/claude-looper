/**
 * Tests for escalation-logic.js
 */

import { describe, it, expect } from 'vitest';
import {
  EscalationLevel,
  DEFAULT_ESCALATION_THRESHOLDS,
  determineEscalation,
  generateCorrection,
  getEscalationSeverity,
  requiresImmediateAction,
} from '../escalation-logic.js';

describe('EscalationLevel', () => {
  it('should have all escalation levels defined', () => {
    expect(EscalationLevel.NONE).toBe('none');
    expect(EscalationLevel.REMIND).toBe('remind');
    expect(EscalationLevel.CORRECT).toBe('correct');
    expect(EscalationLevel.REFOCUS).toBe('refocus');
    expect(EscalationLevel.CRITICAL).toBe('critical');
    expect(EscalationLevel.ABORT).toBe('abort');
  });

  it('should have exactly 6 escalation levels', () => {
    expect(Object.keys(EscalationLevel)).toHaveLength(6);
  });
});

describe('DEFAULT_ESCALATION_THRESHOLDS', () => {
  it('should have all threshold levels defined', () => {
    expect(DEFAULT_ESCALATION_THRESHOLDS.warn).toBe(2);
    expect(DEFAULT_ESCALATION_THRESHOLDS.intervene).toBe(3);
    expect(DEFAULT_ESCALATION_THRESHOLDS.critical).toBe(4);
    expect(DEFAULT_ESCALATION_THRESHOLDS.abort).toBe(5);
  });

  it('should have thresholds in increasing order', () => {
    expect(DEFAULT_ESCALATION_THRESHOLDS.warn).toBeLessThan(DEFAULT_ESCALATION_THRESHOLDS.intervene);
    expect(DEFAULT_ESCALATION_THRESHOLDS.intervene).toBeLessThan(DEFAULT_ESCALATION_THRESHOLDS.critical);
    expect(DEFAULT_ESCALATION_THRESHOLDS.critical).toBeLessThan(DEFAULT_ESCALATION_THRESHOLDS.abort);
  });
});

describe('determineEscalation', () => {
  const thresholds = { warn: 2, intervene: 3, critical: 4, abort: 5 };

  describe('with CONTINUE action', () => {
    const assessment = { action: 'CONTINUE' };

    it('should return NONE when no issues', () => {
      expect(determineEscalation(assessment, 0, thresholds)).toBe(EscalationLevel.NONE);
    });

    it('should return NONE with one issue (below warn threshold)', () => {
      expect(determineEscalation(assessment, 1, thresholds)).toBe(EscalationLevel.NONE);
    });

    it('should return CORRECT at warn threshold', () => {
      expect(determineEscalation(assessment, 2, thresholds)).toBe(EscalationLevel.CORRECT);
    });

    it('should return REFOCUS at intervene threshold', () => {
      expect(determineEscalation(assessment, 3, thresholds)).toBe(EscalationLevel.REFOCUS);
    });

    it('should return CRITICAL at critical threshold', () => {
      expect(determineEscalation(assessment, 4, thresholds)).toBe(EscalationLevel.CRITICAL);
    });

    it('should return ABORT at abort threshold', () => {
      expect(determineEscalation(assessment, 5, thresholds)).toBe(EscalationLevel.ABORT);
    });

    it('should return ABORT when above abort threshold', () => {
      expect(determineEscalation(assessment, 10, thresholds)).toBe(EscalationLevel.ABORT);
    });
  });

  describe('with REMIND action', () => {
    const assessment = { action: 'REMIND' };

    it('should return REMIND when no issues', () => {
      expect(determineEscalation(assessment, 0, thresholds)).toBe(EscalationLevel.REMIND);
    });

    it('should return REMIND with one issue', () => {
      expect(determineEscalation(assessment, 1, thresholds)).toBe(EscalationLevel.REMIND);
    });

    it('should escalate to CORRECT at warn threshold even with REMIND action', () => {
      expect(determineEscalation(assessment, 2, thresholds)).toBe(EscalationLevel.CORRECT);
    });
  });

  describe('with default thresholds', () => {
    it('should use default thresholds when not provided', () => {
      expect(determineEscalation({ action: 'CONTINUE' }, 0)).toBe(EscalationLevel.NONE);
      expect(determineEscalation({ action: 'CONTINUE' }, 2)).toBe(EscalationLevel.CORRECT);
      expect(determineEscalation({ action: 'CONTINUE' }, 5)).toBe(EscalationLevel.ABORT);
    });
  });

  describe('with custom thresholds', () => {
    const customThresholds = { warn: 1, intervene: 2, critical: 3, abort: 4 };

    it('should respect custom thresholds', () => {
      expect(determineEscalation({ action: 'CONTINUE' }, 1, customThresholds)).toBe(EscalationLevel.CORRECT);
      expect(determineEscalation({ action: 'CONTINUE' }, 2, customThresholds)).toBe(EscalationLevel.REFOCUS);
      expect(determineEscalation({ action: 'CONTINUE' }, 4, customThresholds)).toBe(EscalationLevel.ABORT);
    });
  });

  describe('edge cases', () => {
    it('should handle undefined action', () => {
      expect(determineEscalation({}, 0, thresholds)).toBe(EscalationLevel.NONE);
    });

    it('should handle null assessment', () => {
      expect(determineEscalation(null, 0, thresholds)).toBe(EscalationLevel.NONE);
    });

    it('should handle missing action field', () => {
      expect(determineEscalation({ score: 50 }, 0, thresholds)).toBe(EscalationLevel.NONE);
    });
  });
});

describe('generateCorrection', () => {
  const thresholds = { warn: 2, intervene: 3, critical: 4, abort: 5 };
  const assessment = { reason: 'Off track', score: 40 };
  const goal = 'Build feature X';

  describe('NONE level', () => {
    it('should return null for NONE level', () => {
      expect(generateCorrection(EscalationLevel.NONE, assessment, goal, 0, thresholds)).toBeNull();
    });
  });

  describe('REMIND level', () => {
    it('should return reminder prompt', () => {
      const correction = generateCorrection(EscalationLevel.REMIND, assessment, goal, 1, thresholds);

      expect(correction.level).toBe(EscalationLevel.REMIND);
      expect(correction.prompt).toContain('Quick Reminder');
      expect(correction.prompt).toContain(goal);
      expect(correction.prompt).toContain(assessment.reason);
      expect(correction.shouldAbort).toBeUndefined();
    });
  });

  describe('CORRECT level', () => {
    it('should return correction prompt with score', () => {
      const correction = generateCorrection(EscalationLevel.CORRECT, assessment, goal, 2, thresholds);

      expect(correction.level).toBe(EscalationLevel.CORRECT);
      expect(correction.prompt).toContain('Course Correction');
      expect(correction.prompt).toContain(goal);
      expect(correction.prompt).toContain('Score: 40/100');
      expect(correction.prompt).toContain('2/5');
      expect(correction.shouldAbort).toBeUndefined();
    });
  });

  describe('REFOCUS level', () => {
    it('should return refocus prompt', () => {
      const correction = generateCorrection(EscalationLevel.REFOCUS, assessment, goal, 3, thresholds);

      expect(correction.level).toBe(EscalationLevel.REFOCUS);
      expect(correction.prompt).toContain('REFOCUS REQUIRED');
      expect(correction.prompt).toContain('STOP');
      expect(correction.prompt).toContain(goal);
      expect(correction.prompt).toContain('3 consecutive');
      expect(correction.prompt).toContain('WARNING');
      expect(correction.shouldAbort).toBeUndefined();
    });
  });

  describe('CRITICAL level', () => {
    it('should return critical warning prompt', () => {
      const correction = generateCorrection(EscalationLevel.CRITICAL, assessment, goal, 4, thresholds);

      expect(correction.level).toBe(EscalationLevel.CRITICAL);
      expect(correction.prompt).toContain('FINAL WARNING');
      expect(correction.prompt).toContain('TERMINATE');
      expect(correction.prompt).toContain(goal);
      expect(correction.prompt).toContain('4/5');
      expect(correction.shouldAbort).toBeUndefined();
    });
  });

  describe('ABORT level', () => {
    it('should return abort prompt with shouldAbort flag', () => {
      const correction = generateCorrection(EscalationLevel.ABORT, assessment, goal, 5, thresholds);

      expect(correction.level).toBe(EscalationLevel.ABORT);
      expect(correction.prompt).toContain('TERMINATED');
      expect(correction.prompt).toContain('5 consecutive');
      expect(correction.shouldAbort).toBe(true);
    });
  });

  describe('with default thresholds', () => {
    it('should use default thresholds when not provided', () => {
      const correction = generateCorrection(EscalationLevel.CORRECT, assessment, goal, 2);

      expect(correction.prompt).toContain('2/5');
    });
  });

  describe('unknown level', () => {
    it('should return null for unknown level', () => {
      expect(generateCorrection('unknown', assessment, goal, 0, thresholds)).toBeNull();
    });
  });
});

describe('getEscalationSeverity', () => {
  it('should return 0 for NONE', () => {
    expect(getEscalationSeverity(EscalationLevel.NONE)).toBe(0);
  });

  it('should return 1 for REMIND', () => {
    expect(getEscalationSeverity(EscalationLevel.REMIND)).toBe(1);
  });

  it('should return 2 for CORRECT', () => {
    expect(getEscalationSeverity(EscalationLevel.CORRECT)).toBe(2);
  });

  it('should return 3 for REFOCUS', () => {
    expect(getEscalationSeverity(EscalationLevel.REFOCUS)).toBe(3);
  });

  it('should return 4 for CRITICAL', () => {
    expect(getEscalationSeverity(EscalationLevel.CRITICAL)).toBe(4);
  });

  it('should return 5 for ABORT', () => {
    expect(getEscalationSeverity(EscalationLevel.ABORT)).toBe(5);
  });

  it('should return 0 for unknown level', () => {
    expect(getEscalationSeverity('unknown')).toBe(0);
  });

  it('should return 0 for null', () => {
    expect(getEscalationSeverity(null)).toBe(0);
  });

  it('should have increasing severity order', () => {
    const levels = [
      EscalationLevel.NONE,
      EscalationLevel.REMIND,
      EscalationLevel.CORRECT,
      EscalationLevel.REFOCUS,
      EscalationLevel.CRITICAL,
      EscalationLevel.ABORT,
    ];

    for (let i = 1; i < levels.length; i++) {
      expect(getEscalationSeverity(levels[i])).toBeGreaterThan(getEscalationSeverity(levels[i - 1]));
    }
  });
});

describe('requiresImmediateAction', () => {
  it('should return false for NONE', () => {
    expect(requiresImmediateAction(EscalationLevel.NONE)).toBe(false);
  });

  it('should return false for REMIND', () => {
    expect(requiresImmediateAction(EscalationLevel.REMIND)).toBe(false);
  });

  it('should return false for CORRECT', () => {
    expect(requiresImmediateAction(EscalationLevel.CORRECT)).toBe(false);
  });

  it('should return false for REFOCUS', () => {
    expect(requiresImmediateAction(EscalationLevel.REFOCUS)).toBe(false);
  });

  it('should return true for CRITICAL', () => {
    expect(requiresImmediateAction(EscalationLevel.CRITICAL)).toBe(true);
  });

  it('should return true for ABORT', () => {
    expect(requiresImmediateAction(EscalationLevel.ABORT)).toBe(true);
  });

  it('should return false for unknown level', () => {
    expect(requiresImmediateAction('unknown')).toBe(false);
  });
});

describe('integration scenarios', () => {
  const thresholds = { warn: 2, intervene: 3, critical: 4, abort: 5 };
  const goal = 'Complete the task';

  it('should handle full escalation workflow', () => {
    const assessment = { action: 'CORRECT', reason: 'Drifting off track', score: 45 };

    // First issue - NONE
    let level = determineEscalation({ action: 'CONTINUE' }, 0, thresholds);
    expect(level).toBe(EscalationLevel.NONE);
    expect(generateCorrection(level, assessment, goal, 0, thresholds)).toBeNull();

    // Second issue - CORRECT
    level = determineEscalation({ action: 'CONTINUE' }, 2, thresholds);
    expect(level).toBe(EscalationLevel.CORRECT);
    const correction = generateCorrection(level, assessment, goal, 2, thresholds);
    expect(correction.prompt).toContain('Course Correction');

    // Fourth issue - CRITICAL
    level = determineEscalation({ action: 'CONTINUE' }, 4, thresholds);
    expect(level).toBe(EscalationLevel.CRITICAL);
    expect(requiresImmediateAction(level)).toBe(true);

    // Fifth issue - ABORT
    level = determineEscalation({ action: 'CONTINUE' }, 5, thresholds);
    expect(level).toBe(EscalationLevel.ABORT);
    const abortCorrection = generateCorrection(level, assessment, goal, 5, thresholds);
    expect(abortCorrection.shouldAbort).toBe(true);
  });

  it('should handle severity comparison', () => {
    const currentLevel = EscalationLevel.CORRECT;
    const proposedLevel = EscalationLevel.REFOCUS;

    const shouldEscalate = getEscalationSeverity(proposedLevel) > getEscalationSeverity(currentLevel);
    expect(shouldEscalate).toBe(true);
  });
});
