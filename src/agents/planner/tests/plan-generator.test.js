/**
 * Tests for Plan Generator Module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, PlanGenerator } from '../plan-generator.js';

// Mock dependencies
vi.mock('../../interfaces.js', () => ({
  PlanDepth: {
    ROOT: 0,
    LEVEL_1: 1,
    LEVEL_2: 2,
    LEVEL_3: 3,
  },
}));

vi.mock('../plan-parser.js', () => ({
  parsePlanResponse: vi.fn((response, goal) => ({
    id: `plan-${Date.now()}`,
    goal,
    analysis: 'Test analysis',
    steps: [
      { id: 'step-1', number: 1, description: 'Step 1', complexity: 'simple' },
      { id: 'step-2', number: 2, description: 'Step 2', complexity: 'medium' },
    ],
  })),
}));

vi.mock('../quality-assessment.js', () => ({
  assessPlanQuality: vi.fn((plan) => ({
    planId: plan.id,
    score: 85,
    approved: true,
    issues: [],
    strengths: ['Good structure'],
  })),
  MAX_SUBPLAN_STEPS: 5,
}));

vi.mock('../dependency-tracker.js', () => ({
  DependencyTracker: class {
    constructor() {
      this.deps = new Map();
    }
    addDependency() {}
    canExecute() { return true; }
    getExecutionOrder(steps) { return steps.map(s => s.id); }
    toJSON() { return {}; }
    clear() { this.deps.clear(); }
  },
  parseDependenciesFromResponse: vi.fn(),
}));

vi.mock('../prompt-builder.js', () => ({
  buildPlanningPrompt: vi.fn(() => 'Planning prompt'),
  buildSubPlanPrompt: vi.fn(() => 'Sub-plan prompt'),
  buildAdaptiveSubPlanPrompt: vi.fn(() => 'Adaptive prompt'),
}));

describe('ExecutionContext', () => {
  let context;

  beforeEach(() => {
    context = new ExecutionContext();
  });

  describe('constructor', () => {
    it('should initialize with empty arrays', () => {
      expect(context.completedSteps).toEqual([]);
      expect(context.failedSteps).toEqual([]);
      expect(context.blockedReasons).toEqual([]);
      expect(context.successfulApproaches).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update completed steps', () => {
      context.update({ completedSteps: ['step-1', 'step-2'] });

      expect(context.completedSteps).toEqual(['step-1', 'step-2']);
    });

    it('should append to existing steps', () => {
      context.update({ completedSteps: ['step-1'] });
      context.update({ completedSteps: ['step-2'] });

      expect(context.completedSteps).toEqual(['step-1', 'step-2']);
    });

    it('should update failed steps', () => {
      context.update({ failedSteps: ['step-3'] });

      expect(context.failedSteps).toEqual(['step-3']);
    });

    it('should update successful approaches', () => {
      context.update({ successfulApproaches: [{ description: 'Approach 1' }] });

      expect(context.successfulApproaches).toHaveLength(1);
    });

    it('should handle empty updates', () => {
      context.update({});

      expect(context.completedSteps).toEqual([]);
    });
  });

  describe('recordBlockedReason', () => {
    it('should record blocked reason with timestamp', () => {
      context.recordBlockedReason('step-1', 'Network error', 1);

      expect(context.blockedReasons).toHaveLength(1);
      expect(context.blockedReasons[0].stepId).toBe('step-1');
      expect(context.blockedReasons[0].reason).toBe('Network error');
      expect(context.blockedReasons[0].depth).toBe(1);
      expect(context.blockedReasons[0].timestamp).toBeDefined();
    });
  });

  describe('recordSuccessfulApproach', () => {
    it('should record approach with timestamp', () => {
      context.recordSuccessfulApproach('Used caching', 'step-1');

      expect(context.successfulApproaches).toHaveLength(1);
      expect(context.successfulApproaches[0].description).toBe('Used caching');
      expect(context.successfulApproaches[0].stepId).toBe('step-1');
    });

    it('should limit to 20 approaches', () => {
      for (let i = 0; i < 25; i++) {
        context.recordSuccessfulApproach(`Approach ${i}`, `step-${i}`);
      }

      expect(context.successfulApproaches).toHaveLength(20);
      expect(context.successfulApproaches[0].description).toBe('Approach 5');
    });
  });

  describe('reset', () => {
    it('should clear all arrays', () => {
      context.update({ completedSteps: ['step-1'] });
      context.update({ failedSteps: ['step-2'] });
      context.recordBlockedReason('step-3', 'Error', 1);
      context.recordSuccessfulApproach('Approach', 'step-4');

      context.reset();

      expect(context.completedSteps).toEqual([]);
      expect(context.failedSteps).toEqual([]);
      expect(context.blockedReasons).toEqual([]);
      expect(context.successfulApproaches).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      context.update({ completedSteps: ['a', 'b'] });
      context.update({ failedSteps: ['c'] });
      context.recordBlockedReason('d', 'Error', 1);

      const stats = context.getStats();

      expect(stats.completedSteps).toBe(2);
      expect(stats.failedSteps).toBe(1);
      expect(stats.blockedReasons).toBe(1);
    });
  });
});

describe('PlanGenerator', () => {
  let generator;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      sendPrompt: vi.fn().mockResolvedValue({
        response: 'PLAN:\n1. Step 1 | simple\n2. Step 2 | medium\nTOTAL_STEPS: 2',
      }),
    };

    generator = new PlanGenerator(mockClient, { model: 'opus' });
  });

  describe('constructor', () => {
    it('should initialize with correct defaults', () => {
      expect(generator.model).toBe('opus');
      expect(generator.planHistory).toEqual([]);
      expect(generator.maxPlanHistory).toBe(20);
      expect(generator.maxSubPlanAttempts).toBe(3);
    });

    it('should use provided model', () => {
      const gen = new PlanGenerator(mockClient, { model: 'sonnet' });
      expect(gen.model).toBe('sonnet');
    });
  });

  describe('createPlan', () => {
    it('should create plan and return it', async () => {
      const plan = await generator.createPlan('Build a feature');

      expect(plan).toBeDefined();
      expect(plan.goal).toBe('Build a feature');
      expect(plan.depth).toBe(0);
    });

    it('should call client with correct options', async () => {
      await generator.createPlan('Build a feature', { additionalContext: 'Use React' });

      expect(mockClient.sendPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          newSession: true,
          timeout: 300000,
          model: 'opus',
        })
      );
    });

    it('should assess plan quality', async () => {
      const plan = await generator.createPlan('Build a feature');

      expect(plan.qualityAssessment).toBeDefined();
      expect(plan.qualityAssessment.approved).toBe(true);
    });

    it('should add plan to history', async () => {
      await generator.createPlan('Build a feature');

      expect(generator.planHistory).toHaveLength(1);
    });
  });

  describe('createSubPlan', () => {
    const blockedStep = {
      id: 'step-1',
      description: 'Implement auth',
      complexity: 'complex',
    };

    it('should create sub-plan with correct depth', async () => {
      const subPlan = await generator.createSubPlan(blockedStep, 'OAuth failed', 1);

      expect(subPlan.depth).toBe(1);
      expect(subPlan.parentStepId).toBe('step-1');
      expect(subPlan.blockReason).toBe('OAuth failed');
    });

    it('should limit steps based on depth', async () => {
      mockClient.sendPrompt.mockResolvedValue({
        response: 'PLAN:\n1. S1\n2. S2\n3. S3\n4. S4\n5. S5\n6. S6\n7. S7',
      });

      const subPlan = await generator.createSubPlan(blockedStep, 'Error', 2);

      expect(subPlan.steps.length).toBeLessThanOrEqual(3);
    });

    it('should assess sub-plan quality', async () => {
      const subPlan = await generator.createSubPlan(blockedStep, 'Error', 1);

      expect(subPlan.qualityAssessment).toBeDefined();
    });
  });

  describe('createAdaptiveSubPlan', () => {
    const blockedStep = {
      id: 'step-1',
      description: 'Connect to DB',
      complexity: 'medium',
    };

    it('should create adaptive plan with previous attempts info', async () => {
      const previousAttempts = [
        { approach: 'Direct', failureReason: 'Timeout' },
      ];

      const plan = await generator.createAdaptiveSubPlan(
        blockedStep,
        'Connection failed',
        1,
        previousAttempts
      );

      expect(plan.isAdaptive).toBe(true);
      expect(plan.previousAttemptCount).toBe(1);
    });
  });

  describe('sub-plan attempt tracking', () => {
    it('should track attempts correctly', () => {
      expect(generator.getSubPlanAttemptCount('step-1')).toBe(0);

      generator.recordSubPlanAttempt('step-1');
      expect(generator.getSubPlanAttemptCount('step-1')).toBe(1);

      generator.recordSubPlanAttempt('step-1');
      expect(generator.getSubPlanAttemptCount('step-1')).toBe(2);
    });

    it('should allow retry when under limit', () => {
      expect(generator.canRetrySubPlan('step-1')).toBe(true);

      generator.recordSubPlanAttempt('step-1');
      generator.recordSubPlanAttempt('step-1');
      expect(generator.canRetrySubPlan('step-1')).toBe(true);
    });

    it('should prevent retry when at limit', () => {
      generator.recordSubPlanAttempt('step-1');
      generator.recordSubPlanAttempt('step-1');
      generator.recordSubPlanAttempt('step-1');

      expect(generator.canRetrySubPlan('step-1')).toBe(false);
    });
  });

  describe('addToHistory', () => {
    it('should add plan to history', () => {
      generator.addToHistory({
        id: 'plan-1',
        goal: 'Test goal',
        depth: 0,
        steps: [{ id: 'step-1' }],
      });

      expect(generator.planHistory).toHaveLength(1);
      expect(generator.planHistory[0].planId).toBe('plan-1');
    });

    it('should trim history when exceeding max', () => {
      for (let i = 0; i < 25; i++) {
        generator.addToHistory({
          id: `plan-${i}`,
          goal: `Goal ${i}`,
          depth: 0,
          steps: [],
        });
      }

      expect(generator.planHistory).toHaveLength(20);
      expect(generator.planHistory[0].planId).toBe('plan-5');
    });
  });

  describe('canExecuteStep', () => {
    it('should delegate to dependency tracker', () => {
      const result = generator.canExecuteStep('step-2', ['step-1']);

      expect(result).toBe(true);
    });
  });

  describe('getExecutionOrder', () => {
    it('should return ordered step IDs', () => {
      const plan = {
        steps: [
          { id: 'step-1' },
          { id: 'step-2' },
        ],
      };

      const order = generator.getExecutionOrder(plan);

      expect(order).toEqual(['step-1', 'step-2']);
    });
  });

  describe('reset', () => {
    it('should reset all tracking state', async () => {
      await generator.createPlan('Test');
      generator.recordSubPlanAttempt('step-1');
      generator.executionContext.recordSuccessfulApproach('Approach', 'step-1');

      generator.reset();

      expect(generator.getSubPlanAttemptCount('step-1')).toBe(0);
      expect(generator.executionContext.successfulApproaches).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive stats', async () => {
      await generator.createPlan('Test goal');
      generator.recordSubPlanAttempt('step-1');

      const stats = generator.getStats();

      expect(stats.model).toBe('opus');
      expect(stats.plansCreated).toBe(1);
      expect(stats.subPlanAttempts).toHaveProperty('step-1');
      expect(stats.executionContext).toBeDefined();
      expect(stats.recentPlans).toBeDefined();
    });

    it('should truncate goal in recent plans', async () => {
      const longGoal = 'A'.repeat(100);
      await generator.createPlan(longGoal);

      const stats = generator.getStats();

      expect(stats.recentPlans[0].goal.length).toBe(50);
    });
  });
});
