import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SystemContextBuilder } from '../system-context-builder.js';

describe('SystemContextBuilder', () => {
  let builder;
  let mockRunner;

  beforeEach(() => {
    mockRunner = {
      planner: {
        getCurrentStep: vi.fn().mockReturnValue(null),
        getProgress: vi.fn().mockReturnValue(null),
        plan: {
          steps: [],
        },
      },
    };
    builder = new SystemContextBuilder(mockRunner);
  });

  describe('constructor', () => {
    it('should store runner reference', () => {
      expect(builder.runner).toBe(mockRunner);
    });
  });

  describe('build', () => {
    it('should include autonomous mode header', () => {
      const result = builder.build('Test goal', [], '/test/dir');

      expect(result).toContain('# AUTONOMOUS EXECUTION MODE');
      expect(result).toContain('You are running in AUTONOMOUS MODE');
    });

    it('should include primary goal', () => {
      const result = builder.build('Build a web application', [], '/test/dir');

      expect(result).toContain('## PRIMARY GOAL');
      expect(result).toContain('Build a web application');
    });

    it('should include working directory', () => {
      const result = builder.build('Goal', [], '/home/user/project');

      expect(result).toContain('## WORKING DIRECTORY');
      expect(result).toContain('/home/user/project');
    });

    it('should include rules section', () => {
      const result = builder.build('Goal', [], '/dir');

      expect(result).toContain('## RULES');
      expect(result).toContain('Work Autonomously');
      expect(result).toContain('Take Action');
      expect(result).toContain('Report Progress');
      expect(result).toContain('Signal Step Completion');
      expect(result).toContain('Signal Blockers');
      expect(result).toContain('Signal Task Completion');
      expect(result).toContain('Stay Focused');
    });

    it('should include STEP COMPLETE signal instruction', () => {
      const result = builder.build('Goal', [], '/dir');

      expect(result).toContain('STEP COMPLETE');
    });

    it('should include STEP BLOCKED signal instruction', () => {
      const result = builder.build('Goal', [], '/dir');

      expect(result).toContain('STEP BLOCKED');
    });

    it('should include TASK COMPLETE signal instruction', () => {
      const result = builder.build('Goal', [], '/dir');

      expect(result).toContain('TASK COMPLETE');
    });

    it('should end with Begin immediately', () => {
      const result = builder.build('Goal', [], '/dir');

      expect(result).toContain('Begin immediately.');
    });

    it('should include sub-goals when provided', () => {
      const subGoals = ['Setup environment', 'Write code', 'Run tests'];

      const result = builder.build('Main goal', subGoals, '/dir');

      expect(result).toContain('## SUB-GOALS');
      expect(result).toContain('1. Setup environment');
      expect(result).toContain('2. Write code');
      expect(result).toContain('3. Run tests');
    });

    it('should not include sub-goals section when empty', () => {
      const result = builder.build('Goal', [], '/dir');

      expect(result).not.toContain('## SUB-GOALS');
    });

    it('should include step context when available', () => {
      mockRunner.planner.getCurrentStep.mockReturnValue({
        description: 'Implement feature X',
        complexity: 'medium',
      });
      mockRunner.planner.getProgress.mockReturnValue({
        current: 3,
        total: 5,
      });
      mockRunner.planner.plan.steps = [];

      const result = builder.build('Goal', [], '/dir');

      expect(result).toContain('## CURRENT STEP');
      expect(result).toContain('Implement feature X');
      expect(result).toContain('Complexity: medium');
    });
  });

  describe('buildStepContext', () => {
    it('should return empty string when no current step', () => {
      mockRunner.planner.getCurrentStep.mockReturnValue(null);

      const result = builder.buildStepContext();

      expect(result).toBe('');
    });

    it('should return empty string when no plan progress', () => {
      mockRunner.planner.getCurrentStep.mockReturnValue({ description: 'Step' });
      mockRunner.planner.getProgress.mockReturnValue(null);

      const result = builder.buildStepContext();

      expect(result).toBe('');
    });

    it('should include current step info', () => {
      mockRunner.planner.getCurrentStep.mockReturnValue({
        description: 'Write unit tests',
        complexity: 'complex',
      });
      mockRunner.planner.getProgress.mockReturnValue({
        current: 2,
        total: 4,
      });
      mockRunner.planner.plan.steps = [];

      const result = builder.buildStepContext();

      expect(result).toContain('## CURRENT STEP (2 of 4)');
      expect(result).toContain('Write unit tests');
      expect(result).toContain('Complexity: complex');
    });

    it('should include completed steps', () => {
      mockRunner.planner.getCurrentStep.mockReturnValue({
        description: 'Current',
        complexity: 'simple',
      });
      mockRunner.planner.getProgress.mockReturnValue({
        current: 3,
        total: 5,
      });
      mockRunner.planner.plan.steps = [
        { number: 1, description: 'First step', status: 'completed' },
        { number: 2, description: 'Second step', status: 'completed' },
        { number: 3, description: 'Current', status: 'in_progress' },
      ];

      const result = builder.buildStepContext();

      expect(result).toContain('## COMPLETED STEPS');
      expect(result).toContain('✓ 1. First step');
      expect(result).toContain('✓ 2. Second step');
      expect(result).not.toContain('✓ 3. Current');
    });

    it('should not include completed steps section when none completed', () => {
      mockRunner.planner.getCurrentStep.mockReturnValue({
        description: 'First step',
        complexity: 'simple',
      });
      mockRunner.planner.getProgress.mockReturnValue({
        current: 1,
        total: 3,
      });
      mockRunner.planner.plan.steps = [
        { number: 1, description: 'First step', status: 'in_progress' },
        { number: 2, description: 'Second', status: 'pending' },
      ];

      const result = builder.buildStepContext();

      expect(result).not.toContain('## COMPLETED STEPS');
    });
  });

  describe('buildSubGoalsSection', () => {
    it('should return empty string when no sub-goals', () => {
      const result = builder.buildSubGoalsSection([]);

      expect(result).toBe('');
    });

    it('should format sub-goals with numbers', () => {
      const subGoals = ['Goal A', 'Goal B', 'Goal C'];

      const result = builder.buildSubGoalsSection(subGoals);

      expect(result).toContain('## SUB-GOALS (Complete in order)');
      expect(result).toContain('1. Goal A');
      expect(result).toContain('2. Goal B');
      expect(result).toContain('3. Goal C');
    });

    it('should handle single sub-goal', () => {
      const result = builder.buildSubGoalsSection(['Only goal']);

      expect(result).toContain('1. Only goal');
    });
  });
});
