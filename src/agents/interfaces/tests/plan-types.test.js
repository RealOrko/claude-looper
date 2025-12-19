/**
 * Tests for Plan Types Module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PlanStep, ExecutionPlan } from '../plan-types.js';
import { PlanDepth } from '../enums.js';

describe('PlanStep', () => {
  let step;

  beforeEach(() => {
    step = new PlanStep(1, 'Create initial setup', 'simple');
  });

  describe('constructor', () => {
    it('should initialize with number and description', () => {
      expect(step.number).toBe(1);
      expect(step.description).toBe('Create initial setup');
    });

    it('should set complexity', () => {
      expect(step.complexity).toBe('simple');
    });

    it('should default to medium complexity', () => {
      const defaultStep = new PlanStep(1, 'Description');
      expect(defaultStep.complexity).toBe('medium');
    });

    it('should initialize with pending status', () => {
      expect(step.status).toBe('pending');
    });

    it('should initialize at ROOT depth', () => {
      expect(step.depth).toBe(PlanDepth.ROOT);
    });

    it('should generate unique ID', () => {
      const step2 = new PlanStep(2, 'Another step');
      expect(step.id).not.toBe(step2.id);
    });

    it('should initialize empty sub-steps', () => {
      expect(step.subSteps).toEqual([]);
    });

    it('should initialize with zero attempts', () => {
      expect(step.attempts).toBe(0);
      expect(step.maxAttempts).toBe(3);
    });
  });

  describe('canRetry', () => {
    it('should return true when under max attempts and depth', () => {
      step.attempts = 1;
      step.depth = PlanDepth.LEVEL_1;

      expect(step.canRetry()).toBe(true);
    });

    it('should return false when at max attempts', () => {
      step.attempts = 3;
      step.depth = PlanDepth.ROOT;

      expect(step.canRetry()).toBe(false);
    });

    it('should return false when at max depth', () => {
      step.attempts = 1;
      step.depth = PlanDepth.LEVEL_3;

      expect(step.canRetry()).toBe(false);
    });
  });

  describe('hasSubSteps', () => {
    it('should return false when no sub-steps', () => {
      expect(step.hasSubSteps()).toBe(false);
    });

    it('should return true when has sub-steps', () => {
      step.subSteps.push(new PlanStep(1, 'Sub'));
      expect(step.hasSubSteps()).toBe(true);
    });
  });

  describe('addSubStep', () => {
    it('should add sub-step with correct depth', () => {
      const subStep = new PlanStep(1, 'Sub-step');
      step.addSubStep(subStep);

      expect(step.subSteps).toHaveLength(1);
      expect(subStep.depth).toBe(step.depth + 1);
      expect(subStep.parentStepId).toBe(step.id);
    });

    it('should increment depth for nested sub-steps', () => {
      step.depth = PlanDepth.LEVEL_1;
      const subStep = new PlanStep(1, 'Sub');
      step.addSubStep(subStep);

      expect(subStep.depth).toBe(PlanDepth.LEVEL_2);
    });
  });

  describe('getAllSubSteps', () => {
    it('should return empty array for no sub-steps', () => {
      expect(step.getAllSubSteps()).toEqual([]);
    });

    it('should return all nested sub-steps', () => {
      const sub1 = new PlanStep(1, 'Sub 1');
      const sub2 = new PlanStep(2, 'Sub 2');
      const subSub = new PlanStep(1, 'Sub-sub');

      step.addSubStep(sub1);
      step.addSubStep(sub2);
      sub1.addSubStep(subSub);

      const allSubs = step.getAllSubSteps();

      expect(allSubs).toHaveLength(3);
      expect(allSubs).toContain(sub1);
      expect(allSubs).toContain(sub2);
      expect(allSubs).toContain(subSub);
    });
  });
});

describe('ExecutionPlan', () => {
  let plan;

  beforeEach(() => {
    plan = new ExecutionPlan('Build a feature', 'Analysis of the goal');
  });

  describe('constructor', () => {
    it('should initialize with goal and analysis', () => {
      expect(plan.goal).toBe('Build a feature');
      expect(plan.analysis).toBe('Analysis of the goal');
    });

    it('should default analysis to empty string', () => {
      const simplePlan = new ExecutionPlan('Goal');
      expect(simplePlan.analysis).toBe('');
    });

    it('should initialize with empty steps', () => {
      expect(plan.steps).toEqual([]);
    });

    it('should initialize at ROOT depth', () => {
      expect(plan.depth).toBe(PlanDepth.ROOT);
    });

    it('should initialize with pending status', () => {
      expect(plan.status).toBe('pending');
    });

    it('should start at step index 0', () => {
      expect(plan.currentStepIndex).toBe(0);
    });
  });

  describe('addStep', () => {
    it('should add step with correct number', () => {
      plan.addStep('Step 1');
      plan.addStep('Step 2');

      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].number).toBe(1);
      expect(plan.steps[1].number).toBe(2);
    });

    it('should set step depth to plan depth', () => {
      plan.depth = PlanDepth.LEVEL_1;
      const step = plan.addStep('Sub step');

      expect(step.depth).toBe(PlanDepth.LEVEL_1);
    });

    it('should return the created step', () => {
      const step = plan.addStep('Test', 'complex');

      expect(step.description).toBe('Test');
      expect(step.complexity).toBe('complex');
    });
  });

  describe('getCurrentStep', () => {
    it('should return null when no steps', () => {
      expect(plan.getCurrentStep()).toBeNull();
    });

    it('should return first step initially', () => {
      plan.addStep('Step 1');
      plan.addStep('Step 2');

      expect(plan.getCurrentStep().description).toBe('Step 1');
    });
  });

  describe('advanceStep', () => {
    beforeEach(() => {
      plan.addStep('Step 1');
      plan.addStep('Step 2');
      plan.addStep('Step 3');
    });

    it('should mark current step as completed', () => {
      plan.advanceStep();

      expect(plan.steps[0].status).toBe('completed');
    });

    it('should set completedAt timestamp', () => {
      const before = Date.now();
      plan.advanceStep();
      const after = Date.now();

      expect(plan.steps[0].completedAt).toBeGreaterThanOrEqual(before);
      expect(plan.steps[0].completedAt).toBeLessThanOrEqual(after);
    });

    it('should move to next step', () => {
      plan.advanceStep();

      expect(plan.getCurrentStep().description).toBe('Step 2');
    });

    it('should return next step', () => {
      const next = plan.advanceStep();

      expect(next.description).toBe('Step 2');
    });

    it('should return null when advancing past last step', () => {
      plan.advanceStep();
      plan.advanceStep();
      const result = plan.advanceStep();

      expect(result).toBeNull();
    });
  });

  describe('isComplete', () => {
    it('should return true when no steps', () => {
      expect(plan.isComplete()).toBe(true);
    });

    it('should return false when steps remain', () => {
      plan.addStep('Step 1');

      expect(plan.isComplete()).toBe(false);
    });

    it('should return true when all steps advanced', () => {
      plan.addStep('Step 1');
      plan.advanceStep();

      expect(plan.isComplete()).toBe(true);
    });
  });

  describe('getProgress', () => {
    beforeEach(() => {
      plan.addStep('Step 1');
      plan.addStep('Step 2');
      plan.addStep('Step 3');
    });

    it('should return correct initial progress', () => {
      const progress = plan.getProgress();

      expect(progress.current).toBe(1);
      expect(progress.total).toBe(3);
      expect(progress.completed).toBe(0);
      expect(progress.pending).toBe(3);
      expect(progress.percentComplete).toBe(0);
    });

    it('should update after advancing', () => {
      plan.advanceStep();
      const progress = plan.getProgress();

      expect(progress.current).toBe(2);
      expect(progress.completed).toBe(1);
      expect(progress.pending).toBe(2);
      expect(progress.percentComplete).toBe(33);
    });

    it('should count failed steps', () => {
      plan.steps[0].status = 'failed';
      const progress = plan.getProgress();

      expect(progress.failed).toBe(1);
      expect(progress.pending).toBe(2);
    });

    it('should handle empty plan', () => {
      const emptyPlan = new ExecutionPlan('Empty');
      const progress = emptyPlan.getProgress();

      expect(progress.percentComplete).toBe(0);
    });
  });
});
