/**
 * Tests for Plan Quality Assessment Module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PlanQualityAssessment,
  assessPlanQuality,
  PLAN_QUALITY_THRESHOLD,
  MAX_PLAN_STEPS,
  MIN_PLAN_STEPS,
  MAX_SUBPLAN_STEPS,
} from '../quality-assessment.js';

describe('PlanQualityAssessment', () => {
  let mockPlan;

  beforeEach(() => {
    mockPlan = {
      id: 'plan-123',
      goal: 'Test goal',
      analysis: 'Test analysis with sufficient length',
      steps: [
        { number: 1, description: 'Create the initial setup files', complexity: 'simple' },
        { number: 2, description: 'Implement the main feature logic', complexity: 'medium' },
        { number: 3, description: 'Add unit tests for new functionality', complexity: 'medium' },
      ],
    };
  });

  describe('constructor', () => {
    it('should initialize with correct default values', () => {
      const assessment = new PlanQualityAssessment(mockPlan);

      expect(assessment.planId).toBe('plan-123');
      expect(assessment.score).toBe(0);
      expect(assessment.issues).toEqual([]);
      expect(assessment.strengths).toEqual([]);
      expect(assessment.approved).toBe(false);
      expect(assessment.suggestions).toEqual([]);
      expect(assessment.timestamp).toBeDefined();
    });
  });

  describe('addIssue', () => {
    it('should add issue with severity and description', () => {
      const assessment = new PlanQualityAssessment(mockPlan);

      assessment.addIssue('major', 'Test issue');

      expect(assessment.issues).toHaveLength(1);
      expect(assessment.issues[0]).toEqual({
        severity: 'major',
        description: 'Test issue',
      });
    });

    it('should accumulate multiple issues', () => {
      const assessment = new PlanQualityAssessment(mockPlan);

      assessment.addIssue('critical', 'Critical issue');
      assessment.addIssue('minor', 'Minor issue');

      expect(assessment.issues).toHaveLength(2);
    });
  });

  describe('addStrength', () => {
    it('should add strength description', () => {
      const assessment = new PlanQualityAssessment(mockPlan);

      assessment.addStrength('Good structure');

      expect(assessment.strengths).toHaveLength(1);
      expect(assessment.strengths[0]).toBe('Good structure');
    });
  });

  describe('addSuggestion', () => {
    it('should add suggestion description', () => {
      const assessment = new PlanQualityAssessment(mockPlan);

      assessment.addSuggestion('Consider adding tests');

      expect(assessment.suggestions).toHaveLength(1);
      expect(assessment.suggestions[0]).toBe('Consider adding tests');
    });
  });

  describe('calculateScore', () => {
    it('should return 100 for no issues', () => {
      const assessment = new PlanQualityAssessment(mockPlan);

      const score = assessment.calculateScore();

      expect(score).toBe(100);
      expect(assessment.approved).toBe(true);
    });

    it('should deduct 30 for critical issues', () => {
      const assessment = new PlanQualityAssessment(mockPlan);
      assessment.addIssue('critical', 'Critical issue');

      const score = assessment.calculateScore();

      expect(score).toBe(70);
      expect(assessment.approved).toBe(true);
    });

    it('should deduct 15 for major issues', () => {
      const assessment = new PlanQualityAssessment(mockPlan);
      assessment.addIssue('major', 'Major issue');

      const score = assessment.calculateScore();

      expect(score).toBe(85);
      expect(assessment.approved).toBe(true);
    });

    it('should deduct 5 for minor issues', () => {
      const assessment = new PlanQualityAssessment(mockPlan);
      assessment.addIssue('minor', 'Minor issue');

      const score = assessment.calculateScore();

      expect(score).toBe(95);
      expect(assessment.approved).toBe(true);
    });

    it('should accumulate deductions for multiple issues', () => {
      const assessment = new PlanQualityAssessment(mockPlan);
      assessment.addIssue('critical', 'Critical');
      assessment.addIssue('major', 'Major');
      assessment.addIssue('minor', 'Minor');

      const score = assessment.calculateScore();

      expect(score).toBe(50); // 100 - 30 - 15 - 5
      expect(assessment.approved).toBe(false);
    });

    it('should not go below 0', () => {
      const assessment = new PlanQualityAssessment(mockPlan);
      assessment.addIssue('critical', 'Critical 1');
      assessment.addIssue('critical', 'Critical 2');
      assessment.addIssue('critical', 'Critical 3');
      assessment.addIssue('critical', 'Critical 4');

      const score = assessment.calculateScore();

      expect(score).toBe(0);
    });

    it('should not go above 100', () => {
      const assessment = new PlanQualityAssessment(mockPlan);
      // Force score to not exceed 100 by checking base calculation
      assessment.score = 200;
      const score = assessment.calculateScore();

      expect(score).toBeLessThanOrEqual(100);
    });

    it('should mark as not approved below threshold', () => {
      const assessment = new PlanQualityAssessment(mockPlan);
      // Add issues to get below 70
      assessment.addIssue('critical', 'Critical 1');
      assessment.addIssue('minor', 'Minor 1');

      assessment.calculateScore();

      expect(assessment.score).toBe(65);
      expect(assessment.approved).toBe(false);
    });
  });
});

describe('assessPlanQuality', () => {
  describe('step count validation', () => {
    it('should add major issue for too few steps', () => {
      const plan = {
        id: 'plan-1',
        goal: 'Test',
        analysis: 'Test analysis with enough words here',
        steps: [
          { number: 1, description: 'Only one step here', complexity: 'medium' },
        ],
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.issues.some(i =>
        i.severity === 'major' && i.description.includes('only 1 steps')
      )).toBe(true);
    });

    it('should add minor issue for too many steps', () => {
      const steps = [];
      for (let i = 1; i <= 20; i++) {
        steps.push({
          number: i,
          description: `Create step number ${i} implementation`,
          complexity: 'simple',
        });
      }

      const plan = {
        id: 'plan-1',
        goal: 'Test',
        analysis: 'Test analysis with enough words here',
        steps,
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.issues.some(i =>
        i.severity === 'minor' && i.description.includes(`exceeds ${MAX_PLAN_STEPS}`)
      )).toBe(true);
    });
  });

  describe('step quality assessment', () => {
    it('should flag short step descriptions', () => {
      const plan = {
        id: 'plan-1',
        goal: 'Test',
        analysis: 'Test analysis with enough words here',
        steps: [
          { number: 1, description: 'Short', complexity: 'simple' },
          { number: 2, description: 'Create the main feature implementation', complexity: 'medium' },
        ],
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.issues.some(i =>
        i.description.includes('Step 1') && i.description.includes('very short')
      )).toBe(true);
    });

    it('should flag steps without action verbs', () => {
      const plan = {
        id: 'plan-1',
        goal: 'Test',
        analysis: 'Test analysis with enough words here',
        steps: [
          { number: 1, description: 'The feature should be ready', complexity: 'medium' },
          { number: 2, description: 'Create the main component', complexity: 'medium' },
        ],
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.issues.some(i =>
        i.description.includes('Step 1') && i.description.includes('not be actionable')
      )).toBe(true);
    });

    it('should recognize action verbs at start of description', () => {
      const plan = {
        id: 'plan-1',
        goal: 'Test',
        analysis: 'Test analysis with enough words here',
        steps: [
          { number: 1, description: 'Create the initial project structure', complexity: 'simple' },
          { number: 2, description: 'Implement the core functionality', complexity: 'medium' },
        ],
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.issues.filter(i =>
        i.description.includes('not be actionable')
      )).toHaveLength(0);
    });

    it('should add strength for steps with verification', () => {
      const plan = {
        id: 'plan-1',
        goal: 'Test',
        analysis: 'Test analysis with enough words here',
        steps: [
          { number: 1, description: 'Create the test suite and verify functionality', complexity: 'medium' },
          { number: 2, description: 'Implement validation checks for input', complexity: 'medium' },
        ],
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.strengths.some(s =>
        s.includes('verification')
      )).toBe(true);
    });
  });

  describe('analysis validation', () => {
    it('should flag missing analysis', () => {
      const plan = {
        id: 'plan-1',
        goal: 'Test',
        steps: [
          { number: 1, description: 'Create the initial setup', complexity: 'simple' },
          { number: 2, description: 'Implement the main feature', complexity: 'medium' },
        ],
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.issues.some(i =>
        i.description.includes('analysis')
      )).toBe(true);
    });

    it('should flag short analysis', () => {
      const plan = {
        id: 'plan-1',
        goal: 'Test',
        analysis: 'Short',
        steps: [
          { number: 1, description: 'Create the initial setup', complexity: 'simple' },
          { number: 2, description: 'Implement the main feature', complexity: 'medium' },
        ],
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.issues.some(i =>
        i.description.includes('analysis')
      )).toBe(true);
    });

    it('should add strength for good analysis', () => {
      const plan = {
        id: 'plan-1',
        goal: 'Test',
        analysis: 'This is a comprehensive analysis of the goal with sufficient detail',
        steps: [
          { number: 1, description: 'Create the initial setup', complexity: 'simple' },
          { number: 2, description: 'Implement the main feature', complexity: 'medium' },
        ],
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.strengths.some(s =>
        s.includes('thoughtful analysis')
      )).toBe(true);
    });
  });

  describe('complexity distribution', () => {
    it('should flag when more than 50% are complex', () => {
      const plan = {
        id: 'plan-1',
        goal: 'Test',
        analysis: 'Test analysis with enough words here',
        steps: [
          { number: 1, description: 'Create the first complex task', complexity: 'complex' },
          { number: 2, description: 'Implement the second complex task', complexity: 'complex' },
          { number: 3, description: 'Build the third task', complexity: 'simple' },
        ],
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.issues.some(i =>
        i.severity === 'major' && i.description.includes('50%') && i.description.includes('complex')
      )).toBe(true);
    });

    it('should add strength for mixed complexity', () => {
      const plan = {
        id: 'plan-1',
        goal: 'Test',
        analysis: 'Test analysis with enough words here',
        steps: [
          { number: 1, description: 'Create the simple setup task', complexity: 'simple' },
          { number: 2, description: 'Implement the medium task', complexity: 'medium' },
        ],
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.strengths.some(s =>
        s.includes('mix of complexity')
      )).toBe(true);
    });
  });

  describe('suggestions', () => {
    it('should suggest breaking down complex steps', () => {
      const plan = {
        id: 'plan-1',
        goal: 'Test',
        analysis: 'Test analysis with enough words here',
        steps: [
          { number: 1, description: 'Create the complex task one', complexity: 'complex' },
          { number: 2, description: 'Implement the complex task two', complexity: 'complex' },
          { number: 3, description: 'Build the complex task three', complexity: 'complex' },
        ],
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.suggestions.some(s =>
        s.includes('Break complex steps')
      )).toBe(true);
    });

    it('should suggest action verbs for non-actionable steps', () => {
      const plan = {
        id: 'plan-1',
        goal: 'Test',
        analysis: 'Test analysis with enough words here',
        steps: [
          { number: 1, description: 'The feature should be complete', complexity: 'medium' },
          { number: 2, description: 'All tests should pass', complexity: 'medium' },
        ],
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.suggestions.some(s =>
        s.includes('action verb')
      )).toBe(true);
    });
  });

  describe('overall scoring', () => {
    it('should return approved assessment for good plan', () => {
      const plan = {
        id: 'plan-1',
        goal: 'Test goal',
        analysis: 'This is a comprehensive analysis of the goal with sufficient detail',
        steps: [
          { number: 1, description: 'Create the initial project structure', complexity: 'simple' },
          { number: 2, description: 'Implement the core business logic', complexity: 'medium' },
          { number: 3, description: 'Add unit tests and verify functionality', complexity: 'medium' },
        ],
      };

      const assessment = assessPlanQuality(plan);

      expect(assessment.approved).toBe(true);
      expect(assessment.score).toBeGreaterThanOrEqual(PLAN_QUALITY_THRESHOLD);
    });
  });
});

describe('Constants', () => {
  it('should export correct threshold values', () => {
    expect(PLAN_QUALITY_THRESHOLD).toBe(70);
    expect(MAX_PLAN_STEPS).toBe(15);
    expect(MIN_PLAN_STEPS).toBe(2);
    expect(MAX_SUBPLAN_STEPS).toBe(5);
  });
});
