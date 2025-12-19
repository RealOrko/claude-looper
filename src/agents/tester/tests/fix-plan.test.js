import { describe, it, expect } from 'vitest';
import {
  IssueSeverity,
  IssueCategory,
  DetailedFixPlan,
  categorizeIssue,
  generateSuggestedFix,
  generateAttemptFeedback,
} from '../fix-plan.js';

describe('fix-plan', () => {
  describe('IssueSeverity', () => {
    it('should have expected severity levels', () => {
      expect(IssueSeverity.CRITICAL).toBe('critical');
      expect(IssueSeverity.MAJOR).toBe('major');
      expect(IssueSeverity.MINOR).toBe('minor');
      expect(IssueSeverity.SUGGESTION).toBe('suggestion');
    });
  });

  describe('IssueCategory', () => {
    it('should have expected categories', () => {
      expect(IssueCategory.LOGIC_ERROR).toBe('logic_error');
      expect(IssueCategory.EDGE_CASE).toBe('edge_case');
      expect(IssueCategory.SECURITY).toBe('security');
      expect(IssueCategory.TEST_FAILURE).toBe('test_failure');
    });
  });

  describe('DetailedFixPlan', () => {
    it('should create a new fix plan with correct defaults', () => {
      const plan = new DetailedFixPlan('test_123');
      expect(plan.testResultId).toBe('test_123');
      expect(plan.issues).toHaveLength(0);
      expect(plan.fixSteps).toHaveLength(0);
      expect(plan.priority).toBe('minor');
      expect(plan.estimatedComplexity).toBe('simple');
    });

    it('should generate unique id', () => {
      const plan1 = new DetailedFixPlan('test_1');
      const plan2 = new DetailedFixPlan('test_2');
      expect(plan1.id).not.toBe(plan2.id);
    });

    describe('addIssue', () => {
      it('should add issue with enriched context', () => {
        const plan = new DetailedFixPlan('test');
        const issue = plan.addIssue({
          severity: IssueSeverity.MAJOR,
          category: IssueCategory.LOGIC_ERROR,
          description: 'Test issue',
        });

        expect(issue.id).toBe('issue_1');
        expect(issue.severity).toBe('major');
        expect(issue.category).toBe('logic_error');
      });

      it('should update priority when critical issue added', () => {
        const plan = new DetailedFixPlan('test');
        plan.addIssue({ severity: IssueSeverity.CRITICAL, description: 'Critical bug' });

        expect(plan.priority).toBe('critical');
        expect(plan.estimatedComplexity).toBe('complex');
      });

      it('should update priority when major issue added', () => {
        const plan = new DetailedFixPlan('test');
        plan.addIssue({ severity: IssueSeverity.MAJOR, description: 'Major bug' });

        expect(plan.priority).toBe('major');
      });
    });

    describe('addFixStep', () => {
      it('should add fix step', () => {
        const plan = new DetailedFixPlan('test');
        plan.addFixStep(1, 'Fix the bug', 'src/file.js');

        expect(plan.fixSteps).toHaveLength(1);
        expect(plan.fixSteps[0].step).toBe(1);
        expect(plan.fixSteps[0].instruction).toBe('Fix the bug');
        expect(plan.fixSteps[0].completed).toBe(false);
      });
    });

    describe('generateFixSteps', () => {
      it('should generate steps sorted by severity', () => {
        const plan = new DetailedFixPlan('test');
        plan.addIssue({ severity: IssueSeverity.MINOR, description: 'Minor issue', suggestedFix: 'Fix minor' });
        plan.addIssue({ severity: IssueSeverity.CRITICAL, description: 'Critical issue', suggestedFix: 'Fix critical' });
        plan.addIssue({ severity: IssueSeverity.MAJOR, description: 'Major issue', suggestedFix: 'Fix major' });

        plan.generateFixSteps();

        // Should be sorted: critical, major, minor, then verification step
        expect(plan.fixSteps).toHaveLength(4);
        expect(plan.fixSteps[0].instruction).toBe('Fix critical');
        expect(plan.fixSteps[1].instruction).toBe('Fix major');
        expect(plan.fixSteps[2].instruction).toBe('Fix minor');
        expect(plan.fixSteps[3].instruction).toContain('verify');
      });

      it('should not add verification step if no issues', () => {
        const plan = new DetailedFixPlan('test');
        plan.generateFixSteps();
        expect(plan.fixSteps).toHaveLength(0);
      });
    });

    describe('recordPreviousAttempt', () => {
      it('should record attempt with number', () => {
        const plan = new DetailedFixPlan('test');
        plan.recordPreviousAttempt({ approach: 'Tried refactoring', result: 'failed' });
        plan.recordPreviousAttempt({ approach: 'Tried debugging', result: 'partial' });

        expect(plan.previousAttempts).toHaveLength(2);
        expect(plan.previousAttempts[0].attemptNumber).toBe(1);
        expect(plan.previousAttempts[1].attemptNumber).toBe(2);
      });
    });

    describe('getCoderContext', () => {
      it('should return context for coder agent', () => {
        const plan = new DetailedFixPlan('test');
        plan.addIssue({ severity: IssueSeverity.MAJOR, description: 'Bug', suggestedFix: 'Fix it' });
        plan.recordPreviousAttempt({ approach: 'First try', result: 'failed' });
        plan.suggestedApproach = 'New approach';

        const context = plan.getCoderContext();

        expect(context.fixPlanId).toBe(plan.id);
        expect(context.issueCount).toBe(1);
        expect(context.avoidApproaches).toContain('First try');
        expect(context.suggestedApproach).toBe('New approach');
      });
    });

    describe('getSummary', () => {
      it('should return summary with counts', () => {
        const plan = new DetailedFixPlan('test');
        plan.addIssue({ severity: IssueSeverity.CRITICAL, description: 'Critical' });
        plan.addIssue({ severity: IssueSeverity.MAJOR, description: 'Major' });
        plan.addIssue({ severity: IssueSeverity.MINOR, description: 'Minor' });

        const summary = plan.getSummary();

        expect(summary.issueCount).toBe(3);
        expect(summary.criticalCount).toBe(1);
        expect(summary.majorCount).toBe(1);
      });
    });
  });

  describe('categorizeIssue', () => {
    it('should categorize security issues', () => {
      expect(categorizeIssue({ description: 'SQL injection vulnerability' })).toBe(IssueCategory.SECURITY);
      expect(categorizeIssue({ description: 'XSS attack possible' })).toBe(IssueCategory.SECURITY);
    });

    it('should categorize test failures', () => {
      expect(categorizeIssue({ description: 'Test failed for login' })).toBe(IssueCategory.TEST_FAILURE);
    });

    it('should categorize edge cases', () => {
      expect(categorizeIssue({ description: 'null pointer exception' })).toBe(IssueCategory.EDGE_CASE);
      expect(categorizeIssue({ description: 'boundary condition not handled' })).toBe(IssueCategory.EDGE_CASE);
    });

    it('should categorize error handling', () => {
      expect(categorizeIssue({ description: 'error not handled properly' })).toBe(IssueCategory.ERROR_HANDLING);
    });

    it('should categorize performance issues', () => {
      expect(categorizeIssue({ description: 'slow database query' })).toBe(IssueCategory.PERFORMANCE);
      expect(categorizeIssue({ description: 'memory leak detected' })).toBe(IssueCategory.PERFORMANCE);
    });

    it('should categorize logic errors', () => {
      expect(categorizeIssue({ description: 'incorrect calculation' })).toBe(IssueCategory.LOGIC_ERROR);
      expect(categorizeIssue({ description: 'wrong value returned' })).toBe(IssueCategory.LOGIC_ERROR);
    });

    it('should default to code quality', () => {
      expect(categorizeIssue({ description: 'some random issue' })).toBe(IssueCategory.CODE_QUALITY);
    });
  });

  describe('generateSuggestedFix', () => {
    it('should use learning context if available', () => {
      const learningContext = {
        successfulFixes: [{
          issueTypes: [IssueCategory.SECURITY],
          approach: 'Used input validation',
        }],
      };

      const fix = generateSuggestedFix({ description: 'SQL injection' }, learningContext);
      expect(fix).toContain('Previously successful approach');
    });

    it('should generate template-based fix for test failure', () => {
      const fix = generateSuggestedFix({ description: 'Test failed' });
      expect(fix).toContain('expected behavior');
    });

    it('should generate template-based fix for edge case', () => {
      const fix = generateSuggestedFix({ description: 'null check missing' });
      expect(fix).toContain('null/boundary checks');
    });
  });

  describe('generateAttemptFeedback', () => {
    it('should indicate success when no issues remain', () => {
      const feedback = generateAttemptFeedback({ issues: [1, 2] }, { issues: [] });
      expect(feedback).toContain('resolved successfully');
    });

    it('should indicate partial success', () => {
      const feedback = generateAttemptFeedback({ issues: [1, 2, 3] }, { issues: [1] });
      expect(feedback).toContain('Partial success');
      expect(feedback).toContain('2 issues fixed');
    });

    it('should indicate no progress', () => {
      const feedback = generateAttemptFeedback({ issues: [1, 2] }, { issues: [1, 2] });
      expect(feedback).toContain('No progress');
    });

    it('should indicate regression', () => {
      const feedback = generateAttemptFeedback({ issues: [1] }, { issues: [1, 2, 3] });
      expect(feedback).toContain('Regression');
      expect(feedback).toContain('2 new issues');
    });
  });
});
