/**
 * Tests for assessment-schemas.js
 */

import { describe, it, expect } from 'vitest';
import {
  ASSESSMENT_SCHEMA,
  PLAN_REVIEW_SCHEMA,
  STEP_VERIFICATION_SCHEMA,
  GOAL_VERIFICATION_SCHEMA,
  VALID_ACTIONS,
  ESCALATION_ACTIONS,
  ALL_ACTIONS,
  DEFAULT_ESCALATION_THRESHOLDS,
  DEFAULT_STAGNATION_THRESHOLD,
  MAX_ASSESSMENT_HISTORY,
  normalizeStructuredAssessment,
  parseTextAssessment,
  parsePlanReviewText,
  parseStepVerificationText,
  parseGoalVerificationText,
} from '../assessment-schemas.js';

describe('Schema definitions', () => {
  describe('ASSESSMENT_SCHEMA', () => {
    it('should have required properties', () => {
      expect(ASSESSMENT_SCHEMA.type).toBe('object');
      expect(ASSESSMENT_SCHEMA.required).toContain('relevant');
      expect(ASSESSMENT_SCHEMA.required).toContain('productive');
      expect(ASSESSMENT_SCHEMA.required).toContain('progressing');
      expect(ASSESSMENT_SCHEMA.required).toContain('score');
      expect(ASSESSMENT_SCHEMA.required).toContain('action');
      expect(ASSESSMENT_SCHEMA.required).toContain('reason');
    });

    it('should define score as integer with bounds', () => {
      expect(ASSESSMENT_SCHEMA.properties.score.type).toBe('integer');
      expect(ASSESSMENT_SCHEMA.properties.score.minimum).toBe(0);
      expect(ASSESSMENT_SCHEMA.properties.score.maximum).toBe(100);
    });

    it('should define action with valid enum values', () => {
      expect(ASSESSMENT_SCHEMA.properties.action.enum).toEqual(['CONTINUE', 'REMIND', 'CORRECT', 'REFOCUS']);
    });
  });

  describe('PLAN_REVIEW_SCHEMA', () => {
    it('should have required properties', () => {
      expect(PLAN_REVIEW_SCHEMA.type).toBe('object');
      expect(PLAN_REVIEW_SCHEMA.required).toContain('approved');
      expect(PLAN_REVIEW_SCHEMA.required).toContain('issues');
      expect(PLAN_REVIEW_SCHEMA.required).toContain('missingSteps');
      expect(PLAN_REVIEW_SCHEMA.required).toContain('suggestions');
    });

    it('should define approved as boolean', () => {
      expect(PLAN_REVIEW_SCHEMA.properties.approved.type).toBe('boolean');
    });

    it('should define issues as array of strings', () => {
      expect(PLAN_REVIEW_SCHEMA.properties.issues.type).toBe('array');
      expect(PLAN_REVIEW_SCHEMA.properties.issues.items.type).toBe('string');
    });
  });

  describe('STEP_VERIFICATION_SCHEMA', () => {
    it('should have required properties', () => {
      expect(STEP_VERIFICATION_SCHEMA.type).toBe('object');
      expect(STEP_VERIFICATION_SCHEMA.required).toContain('verified');
      expect(STEP_VERIFICATION_SCHEMA.required).toContain('reason');
    });
  });

  describe('GOAL_VERIFICATION_SCHEMA', () => {
    it('should have required properties', () => {
      expect(GOAL_VERIFICATION_SCHEMA.type).toBe('object');
      expect(GOAL_VERIFICATION_SCHEMA.required).toContain('achieved');
      expect(GOAL_VERIFICATION_SCHEMA.required).toContain('confidence');
      expect(GOAL_VERIFICATION_SCHEMA.required).toContain('recommendation');
      expect(GOAL_VERIFICATION_SCHEMA.required).toContain('reason');
    });

    it('should define confidence with valid enum values', () => {
      expect(GOAL_VERIFICATION_SCHEMA.properties.confidence.enum).toEqual(['HIGH', 'MEDIUM', 'LOW']);
    });

    it('should define recommendation with valid enum values', () => {
      expect(GOAL_VERIFICATION_SCHEMA.properties.recommendation.enum).toEqual(['ACCEPT', 'REJECT', 'NEEDS_TESTING']);
    });
  });
});

describe('Constants', () => {
  describe('VALID_ACTIONS', () => {
    it('should contain all valid LLM actions', () => {
      expect(VALID_ACTIONS).toEqual(['CONTINUE', 'REMIND', 'CORRECT', 'REFOCUS']);
    });
  });

  describe('ESCALATION_ACTIONS', () => {
    it('should contain forced escalation actions', () => {
      expect(ESCALATION_ACTIONS).toEqual(['CRITICAL', 'ABORT']);
    });
  });

  describe('ALL_ACTIONS', () => {
    it('should combine valid and escalation actions', () => {
      expect(ALL_ACTIONS).toContain('CONTINUE');
      expect(ALL_ACTIONS).toContain('CRITICAL');
      expect(ALL_ACTIONS).toContain('ABORT');
      expect(ALL_ACTIONS.length).toBe(6);
    });
  });

  describe('DEFAULT_ESCALATION_THRESHOLDS', () => {
    it('should have increasing thresholds', () => {
      expect(DEFAULT_ESCALATION_THRESHOLDS.warn).toBe(2);
      expect(DEFAULT_ESCALATION_THRESHOLDS.intervene).toBe(3);
      expect(DEFAULT_ESCALATION_THRESHOLDS.critical).toBe(4);
      expect(DEFAULT_ESCALATION_THRESHOLDS.abort).toBe(5);
    });

    it('should have escalation order: warn < intervene < critical < abort', () => {
      expect(DEFAULT_ESCALATION_THRESHOLDS.warn).toBeLessThan(DEFAULT_ESCALATION_THRESHOLDS.intervene);
      expect(DEFAULT_ESCALATION_THRESHOLDS.intervene).toBeLessThan(DEFAULT_ESCALATION_THRESHOLDS.critical);
      expect(DEFAULT_ESCALATION_THRESHOLDS.critical).toBeLessThan(DEFAULT_ESCALATION_THRESHOLDS.abort);
    });
  });

  describe('DEFAULT_STAGNATION_THRESHOLD', () => {
    it('should be 15 minutes in milliseconds', () => {
      expect(DEFAULT_STAGNATION_THRESHOLD).toBe(15 * 60 * 1000);
    });
  });

  describe('MAX_ASSESSMENT_HISTORY', () => {
    it('should be 50', () => {
      expect(MAX_ASSESSMENT_HISTORY).toBe(50);
    });
  });
});

describe('normalizeStructuredAssessment', () => {
  it('should normalize complete structured output', () => {
    const structured = {
      relevant: true,
      relevantReason: 'On topic',
      productive: true,
      productiveReason: 'Making progress',
      progressing: true,
      progressingReason: 'Moving forward',
      score: 85,
      action: 'CONTINUE',
      reason: 'Good progress',
    };

    const result = normalizeStructuredAssessment(structured);

    expect(result.relevant).toBe(true);
    expect(result.relevantReason).toBe('On topic');
    expect(result.productive).toBe(true);
    expect(result.productiveReason).toBe('Making progress');
    expect(result.progressing).toBe(true);
    expect(result.progressingReason).toBe('Moving forward');
    expect(result.score).toBe(85);
    expect(result.action).toBe('CONTINUE');
    expect(result.reason).toBe('Good progress');
    expect(result.raw).toBe(structured);
  });

  it('should default missing booleans to true', () => {
    const result = normalizeStructuredAssessment({});

    expect(result.relevant).toBe(true);
    expect(result.productive).toBe(true);
    expect(result.progressing).toBe(true);
  });

  it('should default missing strings to empty', () => {
    const result = normalizeStructuredAssessment({});

    expect(result.relevantReason).toBe('');
    expect(result.productiveReason).toBe('');
    expect(result.progressingReason).toBe('');
    expect(result.reason).toBe('');
  });

  it('should default missing score to 50', () => {
    const result = normalizeStructuredAssessment({});

    expect(result.score).toBe(50);
  });

  it('should clamp score to 0-100 range', () => {
    expect(normalizeStructuredAssessment({ score: -10 }).score).toBe(0);
    expect(normalizeStructuredAssessment({ score: 150 }).score).toBe(100);
    expect(normalizeStructuredAssessment({ score: 75 }).score).toBe(75);
  });

  it('should default invalid action to CONTINUE', () => {
    expect(normalizeStructuredAssessment({ action: 'INVALID' }).action).toBe('CONTINUE');
    expect(normalizeStructuredAssessment({ action: 'ABORT' }).action).toBe('CONTINUE'); // ABORT is escalation-only
    expect(normalizeStructuredAssessment({ action: '' }).action).toBe('CONTINUE');
  });

  it('should accept all valid actions', () => {
    expect(normalizeStructuredAssessment({ action: 'CONTINUE' }).action).toBe('CONTINUE');
    expect(normalizeStructuredAssessment({ action: 'REMIND' }).action).toBe('REMIND');
    expect(normalizeStructuredAssessment({ action: 'CORRECT' }).action).toBe('CORRECT');
    expect(normalizeStructuredAssessment({ action: 'REFOCUS' }).action).toBe('REFOCUS');
  });
});

describe('parseTextAssessment', () => {
  it('should parse complete text response', () => {
    const text = `RELEVANT: YES - Working on the goal
PRODUCTIVE: YES - Making concrete changes
PROGRESSING: YES - Moving forward
SCORE: 85
ACTION: CONTINUE
REASON: Good progress on the task`;

    const result = parseTextAssessment(text);

    expect(result.relevant).toBe(true);
    expect(result.relevantReason).toBe('Working on the goal');
    expect(result.productive).toBe(true);
    expect(result.productiveReason).toBe('Making concrete changes');
    expect(result.progressing).toBe(true);
    expect(result.progressingReason).toBe('Moving forward');
    expect(result.score).toBe(85);
    expect(result.action).toBe('CONTINUE');
    expect(result.reason).toBe('Good progress on the task');
  });

  it('should parse NO values as false', () => {
    const text = `RELEVANT: NO - Off topic
PRODUCTIVE: NO - Just planning
PROGRESSING: NO - Stalled
SCORE: 30
ACTION: CORRECT
REASON: Off track`;

    const result = parseTextAssessment(text);

    expect(result.relevant).toBe(false);
    expect(result.productive).toBe(false);
    expect(result.progressing).toBe(false);
    expect(result.action).toBe('CORRECT');
  });

  it('should handle missing fields with defaults', () => {
    const text = 'Some unstructured response';

    const result = parseTextAssessment(text);

    expect(result.relevant).toBe(true);
    expect(result.productive).toBe(true);
    expect(result.progressing).toBe(true);
    expect(result.score).toBe(50);
    expect(result.action).toBe('CONTINUE');
    expect(result.reason).toBe('');
  });

  it('should clamp score to valid range', () => {
    expect(parseTextAssessment('SCORE: 150').score).toBe(100);
    // Note: regex only captures digits, so -20 becomes 20
    expect(parseTextAssessment('SCORE: 0').score).toBe(0);
  });

  it('should only accept valid actions', () => {
    expect(parseTextAssessment('ACTION: REMIND').action).toBe('REMIND');
    expect(parseTextAssessment('ACTION: ABORT').action).toBe('CONTINUE'); // ABORT not valid from LLM
  });

  it('should preserve raw text', () => {
    const text = 'Original response';
    const result = parseTextAssessment(text);
    expect(result.raw).toBe(text);
  });
});

describe('parsePlanReviewText', () => {
  it('should parse approved plan', () => {
    const text = `APPROVED: YES
ISSUES: none
MISSING_STEPS: none
SUGGESTIONS: none`;

    const result = parsePlanReviewText(text);

    expect(result.approved).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.missingSteps).toEqual([]);
    expect(result.suggestions).toEqual([]);
  });

  it('should parse rejected plan with issues', () => {
    const text = `APPROVED: NO
ISSUES: Missing error handling, No tests
MISSING_STEPS: Add tests, Add documentation
SUGGESTIONS: Consider caching`;

    const result = parsePlanReviewText(text);

    expect(result.approved).toBe(false);
    expect(result.issues).toEqual(['Missing error handling', 'No tests']);
    expect(result.missingSteps).toEqual(['Add tests', 'Add documentation']);
    expect(result.suggestions).toEqual(['Consider caching']);
  });

  it('should handle missing sections', () => {
    const text = 'Some unstructured response';

    const result = parsePlanReviewText(text);

    expect(result.approved).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.missingSteps).toEqual([]);
    expect(result.suggestions).toEqual([]);
  });

  it('should preserve raw text', () => {
    const text = 'APPROVED: YES';
    const result = parsePlanReviewText(text);
    expect(result.raw).toBe(text);
  });
});

describe('parseStepVerificationText', () => {
  it('should parse verified step', () => {
    const text = `VERIFIED: YES
REASON: The step was completed with concrete file changes`;

    const result = parseStepVerificationText(text);

    expect(result.verified).toBe(true);
    expect(result.reason).toBe('The step was completed with concrete file changes');
  });

  it('should parse unverified step', () => {
    const text = `VERIFIED: NO
REASON: Only planning was done, no actual changes made`;

    const result = parseStepVerificationText(text);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('Only planning was done, no actual changes made');
  });

  it('should handle missing reason', () => {
    const text = 'VERIFIED: YES';

    const result = parseStepVerificationText(text);

    expect(result.verified).toBe(true);
    expect(result.reason).toBe('No reason provided');
  });

  it('should default to not verified for unstructured text', () => {
    const text = 'Some unstructured response';

    const result = parseStepVerificationText(text);

    expect(result.verified).toBe(false);
  });
});

describe('parseGoalVerificationText', () => {
  it('should parse successful goal verification', () => {
    const text = `GOAL_ACHIEVED: YES
CONFIDENCE: HIGH
GAPS: none
FUNCTIONAL: YES
RECOMMENDATION: ACCEPT
REASON: All steps completed successfully and the feature works as expected.`;

    const result = parseGoalVerificationText(text);

    expect(result.achieved).toBe(true);
    expect(result.confidence).toBe('HIGH');
    expect(result.functional).toBe('YES');
    expect(result.recommendation).toBe('ACCEPT');
    expect(result.gaps).toBeNull();
    expect(result.reason).toBe('All steps completed successfully and the feature works as expected.');
  });

  it('should parse failed goal verification', () => {
    const text = `GOAL_ACHIEVED: NO
CONFIDENCE: LOW
GAPS: Missing tests, incomplete error handling
FUNCTIONAL: NO
RECOMMENDATION: REJECT
REASON: The implementation is incomplete.`;

    const result = parseGoalVerificationText(text);

    expect(result.achieved).toBe(false);
    expect(result.confidence).toBe('LOW');
    expect(result.functional).toBe('NO');
    expect(result.recommendation).toBe('REJECT');
    expect(result.gaps).toBe('Missing tests, incomplete error handling');
  });

  it('should parse needs testing recommendation', () => {
    const text = `GOAL_ACHIEVED: YES
CONFIDENCE: MEDIUM
FUNCTIONAL: UNKNOWN
RECOMMENDATION: NEEDS_TESTING
REASON: Looks good but needs manual verification`;

    const result = parseGoalVerificationText(text);

    expect(result.achieved).toBe(true);
    expect(result.confidence).toBe('MEDIUM');
    expect(result.functional).toBe('UNKNOWN');
    expect(result.recommendation).toBe('NEEDS_TESTING');
  });

  it('should handle missing fields with UNKNOWN', () => {
    const text = 'Some unstructured response';

    const result = parseGoalVerificationText(text);

    expect(result.achieved).toBe(false);
    expect(result.confidence).toBe('UNKNOWN');
    expect(result.functional).toBe('UNKNOWN');
    expect(result.recommendation).toBe('UNKNOWN');
    expect(result.reason).toBe('No reason provided');
  });

  it('should preserve raw text', () => {
    const text = 'GOAL_ACHIEVED: YES';
    const result = parseGoalVerificationText(text);
    expect(result.raw).toBe(text);
  });
});
