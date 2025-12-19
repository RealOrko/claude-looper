/**
 * Tests for fix-plan-generator.js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  IssueSeverity,
  IssueCategory,
  DetailedFixPlan,
  categorizeIssue,
  FixSuggestionTemplates,
  generateSuggestedFix,
} from '../fix-plan-generator.js';

describe('Constants', () => {
  describe('IssueSeverity', () => {
    it('should have all severity levels', () => {
      expect(IssueSeverity.CRITICAL).toBe('critical');
      expect(IssueSeverity.MAJOR).toBe('major');
      expect(IssueSeverity.MINOR).toBe('minor');
      expect(IssueSeverity.SUGGESTION).toBe('suggestion');
    });
  });

  describe('IssueCategory', () => {
    it('should have all categories', () => {
      expect(IssueCategory.LOGIC_ERROR).toBe('logic_error');
      expect(IssueCategory.EDGE_CASE).toBe('edge_case');
      expect(IssueCategory.ERROR_HANDLING).toBe('error_handling');
      expect(IssueCategory.SECURITY).toBe('security');
      expect(IssueCategory.PERFORMANCE).toBe('performance');
      expect(IssueCategory.CODE_QUALITY).toBe('code_quality');
      expect(IssueCategory.TEST_FAILURE).toBe('test_failure');
      expect(IssueCategory.MISSING_TEST).toBe('missing_test');
    });
  });
});

describe('DetailedFixPlan', () => {
  let plan;

  beforeEach(() => {
    plan = new DetailedFixPlan('test_result_123');
  });

  describe('constructor', () => {
    it('should initialize with defaults', () => {
      expect(plan.testResultId).toBe('test_result_123');
      expect(plan.issues).toEqual([]);
      expect(plan.fixSteps).toEqual([]);
      expect(plan.priority).toBe('minor');
      expect(plan.estimatedComplexity).toBe('simple');
      expect(plan.previousAttempts).toEqual([]);
    });

    it('should generate unique IDs', () => {
      const plan2 = new DetailedFixPlan('test_2');
      expect(plan.id).not.toBe(plan2.id);
    });
  });

  describe('addIssue', () => {
    it('should add enriched issue', () => {
      const issue = plan.addIssue({
        description: 'Test failure',
        severity: IssueSeverity.MAJOR,
        category: IssueCategory.TEST_FAILURE,
      });

      expect(plan.issues).toHaveLength(1);
      expect(issue.id).toBe('issue_1');
      expect(issue.severity).toBe('major');
      expect(issue.category).toBe('test_failure');
    });

    it('should use defaults for missing fields', () => {
      const issue = plan.addIssue({ description: 'Basic issue' });
      expect(issue.severity).toBe(IssueSeverity.MINOR);
      expect(issue.category).toBe(IssueCategory.CODE_QUALITY);
    });

    it('should update priority when critical issue added', () => {
      plan.addIssue({
        description: 'Security flaw',
        severity: IssueSeverity.CRITICAL,
      });
      expect(plan.priority).toBe('critical');
      expect(plan.estimatedComplexity).toBe('complex');
    });

    it('should update priority when major issue added', () => {
      plan.addIssue({
        description: 'Bug',
        severity: IssueSeverity.MAJOR,
      });
      expect(plan.priority).toBe('major');
    });
  });

  describe('addFixStep', () => {
    it('should add fix step', () => {
      plan.addFixStep(1, 'Fix the bug', 'src/app.js', { before: 'old', after: 'new' });
      expect(plan.fixSteps).toHaveLength(1);
      expect(plan.fixSteps[0].step).toBe(1);
      expect(plan.fixSteps[0].instruction).toBe('Fix the bug');
      expect(plan.fixSteps[0].completed).toBe(false);
    });
  });

  describe('generateFixSteps', () => {
    it('should generate steps sorted by severity', () => {
      plan.addIssue({
        description: 'Minor issue',
        severity: IssueSeverity.MINOR,
        suggestedFix: 'Fix minor',
      });
      plan.addIssue({
        description: 'Critical issue',
        severity: IssueSeverity.CRITICAL,
        suggestedFix: 'Fix critical',
      });
      plan.addIssue({
        description: 'Major issue',
        severity: IssueSeverity.MAJOR,
        suggestedFix: 'Fix major',
      });

      plan.generateFixSteps();

      expect(plan.fixSteps[0].instruction).toBe('Fix critical');
      expect(plan.fixSteps[1].instruction).toBe('Fix major');
      expect(plan.fixSteps[2].instruction).toBe('Fix minor');
    });

    it('should add verification step at end', () => {
      plan.addIssue({ description: 'Issue' });
      plan.generateFixSteps();

      const lastStep = plan.fixSteps[plan.fixSteps.length - 1];
      expect(lastStep.instruction).toContain('verify');
    });

    it('should not add steps when no issues', () => {
      plan.generateFixSteps();
      expect(plan.fixSteps).toHaveLength(0);
    });
  });

  describe('recordPreviousAttempt', () => {
    it('should record attempt', () => {
      plan.recordPreviousAttempt({
        approach: 'Try refactoring',
        result: 'failed',
        remainingIssues: ['Issue 1'],
        feedback: 'Did not work',
      });

      expect(plan.previousAttempts).toHaveLength(1);
      expect(plan.previousAttempts[0].attemptNumber).toBe(1);
      expect(plan.previousAttempts[0].result).toBe('failed');
    });

    it('should increment attempt numbers', () => {
      plan.recordPreviousAttempt({ approach: 'A', result: 'failed' });
      plan.recordPreviousAttempt({ approach: 'B', result: 'partial' });

      expect(plan.previousAttempts[0].attemptNumber).toBe(1);
      expect(plan.previousAttempts[1].attemptNumber).toBe(2);
    });
  });

  describe('getCoderContext', () => {
    it('should return context object', () => {
      plan.addIssue({
        description: 'Test issue',
        severity: IssueSeverity.MAJOR,
        suggestedFix: 'Fix it',
      });
      plan.recordPreviousAttempt({ approach: 'Failed approach', result: 'failed' });
      plan.suggestedApproach = 'Try this instead';
      plan.generateFixSteps();

      const context = plan.getCoderContext();

      expect(context.fixPlanId).toBe(plan.id);
      expect(context.priority).toBe('major');
      expect(context.issueCount).toBe(1);
      expect(context.avoidApproaches).toContain('Failed approach');
      expect(context.suggestedApproach).toBe('Try this instead');
    });
  });

  describe('getSummary', () => {
    it('should return summary', () => {
      plan.addIssue({ description: 'Critical', severity: IssueSeverity.CRITICAL });
      plan.addIssue({ description: 'Major', severity: IssueSeverity.MAJOR });
      plan.addIssue({ description: 'Minor', severity: IssueSeverity.MINOR });
      plan.generateFixSteps();

      const summary = plan.getSummary();

      expect(summary.id).toBe(plan.id);
      expect(summary.issueCount).toBe(3);
      expect(summary.criticalCount).toBe(1);
      expect(summary.majorCount).toBe(1);
      expect(summary.fixStepCount).toBe(4); // 3 issues + 1 verification
    });
  });
});

describe('categorizeIssue', () => {
  it('should categorize security issues', () => {
    expect(categorizeIssue({ description: 'SQL injection vulnerability' }))
      .toBe(IssueCategory.SECURITY);
    expect(categorizeIssue({ description: 'XSS attack possible' }))
      .toBe(IssueCategory.SECURITY);
  });

  it('should categorize test failures', () => {
    expect(categorizeIssue({ description: 'Test failed for login' }))
      .toBe(IssueCategory.TEST_FAILURE);
    expect(categorizeIssue({ description: 'Test error in checkout' }))
      .toBe(IssueCategory.TEST_FAILURE);
  });

  it('should categorize edge cases', () => {
    expect(categorizeIssue({ description: 'null pointer exception' }))
      .toBe(IssueCategory.EDGE_CASE);
    expect(categorizeIssue({ description: 'boundary value issue' }))
      .toBe(IssueCategory.EDGE_CASE);
  });

  it('should categorize error handling', () => {
    // The function checks for 'error' AND 'handle' (not 'handling')
    expect(categorizeIssue({ description: 'need to handle error properly' }))
      .toBe(IssueCategory.ERROR_HANDLING);
  });

  it('should categorize performance', () => {
    expect(categorizeIssue({ description: 'Slow database query' }))
      .toBe(IssueCategory.PERFORMANCE);
    expect(categorizeIssue({ description: 'Memory leak detected' }))
      .toBe(IssueCategory.PERFORMANCE);
  });

  it('should categorize logic errors', () => {
    expect(categorizeIssue({ description: 'Logic error in calculation' }))
      .toBe(IssueCategory.LOGIC_ERROR);
    expect(categorizeIssue({ description: 'Incorrect result returned' }))
      .toBe(IssueCategory.LOGIC_ERROR);
  });

  it('should default to code quality', () => {
    expect(categorizeIssue({ description: 'Some generic issue' }))
      .toBe(IssueCategory.CODE_QUALITY);
  });
});

describe('FixSuggestionTemplates', () => {
  it('should have templates for all categories', () => {
    expect(FixSuggestionTemplates[IssueCategory.TEST_FAILURE]).toBeDefined();
    expect(FixSuggestionTemplates[IssueCategory.EDGE_CASE]).toBeDefined();
    expect(FixSuggestionTemplates[IssueCategory.ERROR_HANDLING]).toBeDefined();
    expect(FixSuggestionTemplates[IssueCategory.SECURITY]).toBeDefined();
    expect(FixSuggestionTemplates[IssueCategory.PERFORMANCE]).toBeDefined();
    expect(FixSuggestionTemplates[IssueCategory.LOGIC_ERROR]).toBeDefined();
    expect(FixSuggestionTemplates[IssueCategory.MISSING_TEST]).toBeDefined();
  });
});

describe('generateSuggestedFix', () => {
  it('should return template for known category', () => {
    const fix = generateSuggestedFix(IssueCategory.SECURITY, 'issue');
    expect(fix).toBe(FixSuggestionTemplates[IssueCategory.SECURITY]);
  });

  it('should return generic fix for unknown category', () => {
    const fix = generateSuggestedFix('unknown_category', 'some issue');
    expect(fix).toContain('unknown_category');
    expect(fix).toContain('some issue');
  });
});
