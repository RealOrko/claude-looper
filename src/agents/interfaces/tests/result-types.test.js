/**
 * Tests for Result Types Module
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TestResult, VerificationResult } from '../result-types.js';

describe('TestResult', () => {
  let result;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    result = new TestResult('step-1', 'unit');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with step ID and test type', () => {
      expect(result.stepId).toBe('step-1');
      expect(result.testType).toBe('unit');
    });

    it('should initialize as not passed', () => {
      expect(result.passed).toBe(false);
    });

    it('should initialize empty issues and suggestions', () => {
      expect(result.issues).toEqual([]);
      expect(result.suggestions).toEqual([]);
    });

    it('should generate unique ID', () => {
      vi.advanceTimersByTime(1); // Ensure different timestamp
      const result2 = new TestResult('step-2', 'integration');
      expect(result.id).not.toBe(result2.id);
    });
  });

  describe('addIssue', () => {
    it('should add issue with severity and description', () => {
      result.addIssue('critical', 'Null pointer exception');

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].severity).toBe('critical');
      expect(result.issues[0].description).toBe('Null pointer exception');
    });

    it('should include location when provided', () => {
      result.addIssue('major', 'Missing import', 'file.js:10');

      expect(result.issues[0].location).toBe('file.js:10');
    });

    it('should generate sequential issue IDs', () => {
      result.addIssue('minor', 'Issue 1');
      result.addIssue('minor', 'Issue 2');

      expect(result.issues[0].id).toBe('issue_1');
      expect(result.issues[1].id).toBe('issue_2');
    });
  });

  describe('addSuggestion', () => {
    it('should add suggestion with description', () => {
      result.addSuggestion('Add error handling');

      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].description).toBe('Add error handling');
    });

    it('should default to medium priority', () => {
      result.addSuggestion('Suggestion');

      expect(result.suggestions[0].priority).toBe('medium');
    });

    it('should accept custom priority', () => {
      result.addSuggestion('Important', 'high');

      expect(result.suggestions[0].priority).toBe('high');
    });
  });

  describe('generateFixPlan', () => {
    it('should return null when no issues', () => {
      expect(result.generateFixPlan()).toBeNull();
    });

    it('should create fix plan from issues', () => {
      result.addIssue('major', 'Fix this');
      const plan = result.generateFixPlan();

      expect(plan).toBeDefined();
      expect(plan.testResultId).toBe(result.id);
      expect(plan.issues).toHaveLength(1);
    });

    it('should add fix descriptions', () => {
      result.addIssue('minor', 'Missing semicolon');
      const plan = result.generateFixPlan();

      expect(plan.issues[0].fixDescription).toBe('Fix: Missing semicolon');
    });

    it('should set critical priority for critical issues', () => {
      result.addIssue('critical', 'Security issue');
      const plan = result.generateFixPlan();

      expect(plan.priority).toBe('critical');
    });

    it('should set major priority when no critical issues', () => {
      result.addIssue('major', 'Bug');
      const plan = result.generateFixPlan();

      expect(plan.priority).toBe('major');
    });

    it('should set minor priority when only minor issues', () => {
      result.addIssue('minor', 'Style issue');
      const plan = result.generateFixPlan();

      expect(plan.priority).toBe('minor');
    });

    it('should store fix plan in result', () => {
      result.addIssue('major', 'Issue');
      result.generateFixPlan();

      expect(result.fixPlan).toBeDefined();
    });
  });
});

describe('VerificationResult', () => {
  let result;

  beforeEach(() => {
    result = new VerificationResult('code', 'output-1');
  });

  describe('constructor', () => {
    it('should initialize with type and target ID', () => {
      expect(result.type).toBe('code');
      expect(result.targetId).toBe('output-1');
    });

    it('should initialize as not verified', () => {
      expect(result.verified).toBe(false);
    });

    it('should initialize score to 0', () => {
      expect(result.score).toBe(0);
    });

    it('should default recommendation to continue', () => {
      expect(result.recommendation).toBe('continue');
    });

    it('should initialize empty issues', () => {
      expect(result.issues).toEqual([]);
    });
  });

  describe('setResult', () => {
    it('should set all result properties', () => {
      result.setResult(true, 85, 'approve', 'Well implemented');

      expect(result.verified).toBe(true);
      expect(result.score).toBe(85);
      expect(result.recommendation).toBe('approve');
      expect(result.reason).toBe('Well implemented');
    });

    it('should handle failed verification', () => {
      result.setResult(false, 30, 'replan', 'Needs rework');

      expect(result.verified).toBe(false);
      expect(result.score).toBe(30);
      expect(result.recommendation).toBe('replan');
    });
  });

  describe('addIssue', () => {
    it('should add issue with description', () => {
      result.addIssue('Missing tests');

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].description).toBe('Missing tests');
    });

    it('should default to warning severity', () => {
      result.addIssue('Minor concern');

      expect(result.issues[0].severity).toBe('warning');
    });

    it('should accept custom severity', () => {
      result.addIssue('Critical problem', 'error');

      expect(result.issues[0].severity).toBe('error');
    });

    it('should accumulate multiple issues', () => {
      result.addIssue('Issue 1');
      result.addIssue('Issue 2', 'error');

      expect(result.issues).toHaveLength(2);
    });
  });
});
