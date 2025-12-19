/**
 * Tests for plan-parser.js
 */
import { describe, it, expect, vi } from 'vitest';
import { PlanParser } from '../plan-parser.js';

describe('PlanParser', () => {
  const mockComplexityEstimator = {
    estimateComplexity: vi.fn(() => 'medium'),
    refineComplexity: vi.fn((est) => est),
  };

  const mockDependencyAnalyzer = {
    analyzeDependencies: vi.fn((steps) => steps),
    getExecutionStats: vi.fn(() => ({ parallelizable: 2, sequential: 1 })),
  };

  describe('buildPlanningPrompt', () => {
    it('should build basic planning prompt', () => {
      const parser = new PlanParser();
      const prompt = parser.buildPlanningPrompt('Fix the bug', '', '/project');

      expect(prompt).toContain('Fix the bug');
      expect(prompt).toContain('/project');
      expect(prompt).toContain('PLAN THIS GOAL');
      expect(prompt).toContain('TOTAL_STEPS');
    });

    it('should include context when provided', () => {
      const parser = new PlanParser();
      const prompt = parser.buildPlanningPrompt('Fix bug', 'User reported crash', '/project');

      expect(prompt).toContain('Context: User reported crash');
    });
  });

  describe('buildSubPlanPrompt', () => {
    it('should build sub-plan prompt', () => {
      const parser = new PlanParser();
      const blockedStep = { number: 3, description: 'Run tests' };
      const prompt = parser.buildSubPlanPrompt('Fix bugs', blockedStep, 'Tests timeout', '/project');

      expect(prompt).toContain('Step 3: Run tests');
      expect(prompt).toContain('Tests timeout');
      expect(prompt).toContain('alternative approach');
    });
  });

  describe('buildDecompositionPrompt', () => {
    it('should build decomposition prompt', () => {
      const parser = new PlanParser();
      const step = { number: 1, description: 'Refactor module', complexity: 'complex' };
      const prompt = parser.buildDecompositionPrompt('Improve code', step, '/project');

      expect(prompt).toContain('Step 1: Refactor module');
      expect(prompt).toContain('complex');
      expect(prompt).toContain('SUBTASKS');
      expect(prompt).toContain('PARALLEL_SAFE');
    });
  });

  describe('parsePlan', () => {
    it('should parse valid plan response', () => {
      const parser = new PlanParser(mockComplexityEstimator, mockDependencyAnalyzer);
      const response = `ANALYSIS: This is a simple task
PLAN:
1. First step | simple
2. Second step | medium
3. Third step | complex
TOTAL_STEPS: 3`;

      const plan = parser.parsePlan(response, 'Test goal');

      expect(plan.goal).toBe('Test goal');
      expect(plan.analysis).toBe('This is a simple task');
      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[0]).toEqual({ number: 1, description: 'First step', complexity: 'simple', status: 'pending' });
      expect(plan.steps[1].complexity).toBe('medium');
      expect(plan.steps[2].complexity).toBe('complex');
      expect(plan.totalSteps).toBe(3);
    });

    it('should use complexity estimator when complexity not specified', () => {
      mockComplexityEstimator.estimateComplexity.mockReturnValueOnce('simple');
      const parser = new PlanParser(mockComplexityEstimator, mockDependencyAnalyzer);
      const response = `PLAN:
1. Do something
TOTAL_STEPS: 1`;

      const plan = parser.parsePlan(response, 'Goal');

      expect(mockComplexityEstimator.estimateComplexity).toHaveBeenCalled();
      expect(plan.steps[0].complexity).toBe('simple');
    });

    it('should fallback to numbered items parsing', () => {
      const parser = new PlanParser(mockComplexityEstimator, null);
      const response = `Here's what we need to do:
1. First thing to do
2. Second thing to do
3. Third thing to do`;

      const plan = parser.parsePlan(response, 'Goal');

      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[0].description).toBe('First thing to do');
    });

    it('should store raw response', () => {
      const parser = new PlanParser();
      const response = 'Some response text';
      const plan = parser.parsePlan(response, 'Goal');

      expect(plan.raw).toBe('Some response text');
    });

    it('should call dependency analyzer when available', () => {
      const parser = new PlanParser(mockComplexityEstimator, mockDependencyAnalyzer);
      const response = `PLAN:
1. Step | simple
TOTAL_STEPS: 1`;

      parser.parsePlan(response, 'Goal');

      expect(mockDependencyAnalyzer.analyzeDependencies).toHaveBeenCalled();
      expect(mockDependencyAnalyzer.getExecutionStats).toHaveBeenCalled();
    });
  });

  describe('parseDecomposition', () => {
    it('should parse decomposition response', () => {
      const parser = new PlanParser();
      const parentStep = { number: 3, description: 'Complex task' };
      const response = `ANALYSIS: Breaking this down
SUBTASKS:
1. First subtask | simple
2. Second subtask | medium
PARALLEL_SAFE: YES`;

      const result = parser.parseDecomposition(response, parentStep);

      expect(result.parentStep).toBe(parentStep);
      expect(result.subtasks).toHaveLength(2);
      expect(result.subtasks[0].number).toBe(3.1);
      expect(result.subtasks[0].description).toBe('First subtask');
      expect(result.subtasks[0].isSubtask).toBe(true);
      expect(result.subtasks[0].parentStepNumber).toBe(3);
      expect(result.parallelSafe).toBe(true);
    });

    it('should default complexity to simple', () => {
      const parser = new PlanParser();
      const response = `SUBTASKS:
1. Task without complexity
PARALLEL_SAFE: NO`;

      const result = parser.parseDecomposition(response, { number: 1 });

      expect(result.subtasks[0].complexity).toBe('simple');
    });

    it('should return null for empty subtasks', () => {
      const parser = new PlanParser();
      const response = 'No valid subtasks here';

      const result = parser.parseDecomposition(response, { number: 1 });

      expect(result).toBe(null);
    });

    it('should detect PARALLEL_SAFE: NO', () => {
      const parser = new PlanParser();
      const response = `SUBTASKS:
1. Task | simple
PARALLEL_SAFE: NO`;

      const result = parser.parseDecomposition(response, { number: 1 });

      expect(result.parallelSafe).toBe(false);
    });
  });
});
