/**
 * Tests for planner.js - Hierarchy-aware work selection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Planner } from '../planner.js';

// Mock Claude client
function createMockClient() {
  return {
    sendPrompt: vi.fn(),
    startSession: vi.fn(),
  };
}

describe('Planner - Hierarchy-Aware Work Selection', () => {
  let planner;
  let mockClient;

  beforeEach(() => {
    mockClient = createMockClient();
    planner = new Planner(mockClient, { parallelMode: false });
  });

  describe('getCurrentStep with decomposed steps', () => {
    it('should return subtask instead of decomposed parent', () => {
      // Set up a plan where step 1 has been decomposed
      planner.plan = {
        goal: 'Test goal',
        steps: [
          { number: 1, description: 'Parent step', status: 'decomposed', decomposedInto: [1.1, 1.2] },
          { number: 1.1, description: 'Subtask 1', status: 'pending', isSubtask: true, parentStepNumber: 1 },
          { number: 1.2, description: 'Subtask 2', status: 'pending', isSubtask: true, parentStepNumber: 1 },
          { number: 2, description: 'Next step', status: 'pending' },
        ],
        totalSteps: 4,
      };

      const currentStep = planner.getCurrentStep();

      // Should return subtask 1.1, not the decomposed parent
      expect(currentStep.number).toBe(1.1);
      expect(currentStep.description).toBe('Subtask 1');
    });

    it('should auto-complete parent when all subtasks are done', () => {
      planner.plan = {
        goal: 'Test goal',
        steps: [
          { number: 1, description: 'Parent step', status: 'decomposed', decomposedInto: [1.1, 1.2] },
          { number: 1.1, description: 'Subtask 1', status: 'completed', isSubtask: true, parentStepNumber: 1 },
          { number: 1.2, description: 'Subtask 2', status: 'completed', isSubtask: true, parentStepNumber: 1 },
          { number: 2, description: 'Next step', status: 'pending' },
        ],
        totalSteps: 4,
      };

      const currentStep = planner.getCurrentStep();

      // Should return step 2, and parent should be auto-completed
      expect(currentStep.number).toBe(2);
      expect(planner.plan.steps[0].status).toBe('completed');
      expect(planner.plan.steps[0].completedViaSubtasks).toBe(true);
    });

    it('should handle nested decomposition (subtasks that are also decomposed)', () => {
      planner.plan = {
        goal: 'Test goal',
        steps: [
          { number: 1, description: 'Parent step', status: 'decomposed', decomposedInto: [1.1, 1.2] },
          { number: 1.1, description: 'Subtask 1', status: 'decomposed', decomposedInto: [1.11, 1.12], isSubtask: true, parentStepNumber: 1 },
          { number: 1.11, description: 'Nested subtask 1', status: 'pending', isSubtask: true, parentStepNumber: 1.1 },
          { number: 1.12, description: 'Nested subtask 2', status: 'pending', isSubtask: true, parentStepNumber: 1.1 },
          { number: 1.2, description: 'Subtask 2', status: 'pending', isSubtask: true, parentStepNumber: 1 },
          { number: 2, description: 'Next step', status: 'pending' },
        ],
        totalSteps: 6,
      };

      const currentStep = planner.getCurrentStep();

      // Should recurse into nested subtasks and return 1.11
      expect(currentStep.number).toBe(1.11);
    });

    it('should skip failed/skipped subtasks and find next incomplete one', () => {
      planner.plan = {
        goal: 'Test goal',
        steps: [
          { number: 1, description: 'Parent step', status: 'decomposed', decomposedInto: [1.1, 1.2, 1.3] },
          { number: 1.1, description: 'Subtask 1', status: 'failed', isSubtask: true, parentStepNumber: 1 },
          { number: 1.2, description: 'Subtask 2', status: 'skipped', isSubtask: true, parentStepNumber: 1 },
          { number: 1.3, description: 'Subtask 3', status: 'pending', isSubtask: true, parentStepNumber: 1 },
          { number: 2, description: 'Next step', status: 'pending' },
        ],
        totalSteps: 5,
      };

      const currentStep = planner.getCurrentStep();

      // Should return subtask 1.3 (first non-completed/failed/skipped)
      expect(currentStep.number).toBe(1.3);
    });
  });

  describe('findFirstIncompleteSubtask', () => {
    it('should return null when all subtasks are complete', () => {
      planner.plan = {
        goal: 'Test goal',
        steps: [
          { number: 1, description: 'Parent', status: 'decomposed', decomposedInto: [1.1, 1.2] },
          { number: 1.1, description: 'Subtask 1', status: 'completed' },
          { number: 1.2, description: 'Subtask 2', status: 'completed' },
        ],
      };

      const result = planner.findFirstIncompleteSubtask([1.1, 1.2]);
      expect(result).toBeNull();
    });

    it('should find first pending subtask', () => {
      planner.plan = {
        goal: 'Test goal',
        steps: [
          { number: 1, description: 'Parent', status: 'decomposed', decomposedInto: [1.1, 1.2] },
          { number: 1.1, description: 'Subtask 1', status: 'completed' },
          { number: 1.2, description: 'Subtask 2', status: 'pending' },
        ],
      };

      const result = planner.findFirstIncompleteSubtask([1.1, 1.2]);
      expect(result.number).toBe(1.2);
    });
  });

  describe('autoCompleteDecomposedStep', () => {
    it('should mark parent as completed when all subtasks done', () => {
      const parentStep = {
        number: 1,
        description: 'Parent',
        status: 'decomposed',
        decomposedInto: [1.1, 1.2],
        startTime: Date.now() - 1000,
      };

      planner.plan = {
        goal: 'Test goal',
        steps: [
          parentStep,
          { number: 1.1, description: 'Subtask 1', status: 'completed' },
          { number: 1.2, description: 'Subtask 2', status: 'completed' },
        ],
      };

      planner.autoCompleteDecomposedStep(parentStep);

      expect(parentStep.status).toBe('completed');
      expect(parentStep.completedViaSubtasks).toBe(true);
      expect(parentStep.endTime).toBeDefined();
      expect(parentStep.duration).toBeGreaterThan(0);
    });

    it('should not complete parent if subtasks still pending', () => {
      const parentStep = {
        number: 1,
        description: 'Parent',
        status: 'decomposed',
        decomposedInto: [1.1, 1.2],
      };

      planner.plan = {
        goal: 'Test goal',
        steps: [
          parentStep,
          { number: 1.1, description: 'Subtask 1', status: 'completed' },
          { number: 1.2, description: 'Subtask 2', status: 'pending' },
        ],
      };

      planner.autoCompleteDecomposedStep(parentStep);

      expect(parentStep.status).toBe('decomposed');
    });
  });

  describe('updateCurrentStepPointer with decomposed steps', () => {
    it('should point to decomposed parent when it has incomplete subtasks', () => {
      planner.plan = {
        goal: 'Test goal',
        steps: [
          { number: 1, description: 'Parent', status: 'decomposed', decomposedInto: [1.1, 1.2] },
          { number: 1.1, description: 'Subtask 1', status: 'pending' },
          { number: 1.2, description: 'Subtask 2', status: 'pending' },
          { number: 2, description: 'Next step', status: 'pending' },
        ],
        totalSteps: 4,
      };
      planner.currentStep = 99; // Set to invalid value

      planner.updateCurrentStepPointer();

      // Should point to index 0 (parent with incomplete subtasks)
      expect(planner.currentStep).toBe(0);
    });

    it('should skip past completed decomposed parents', () => {
      planner.plan = {
        goal: 'Test goal',
        steps: [
          { number: 1, description: 'Parent', status: 'decomposed', decomposedInto: [1.1, 1.2] },
          { number: 1.1, description: 'Subtask 1', status: 'completed' },
          { number: 1.2, description: 'Subtask 2', status: 'completed' },
          { number: 2, description: 'Next step', status: 'pending' },
        ],
        totalSteps: 4,
      };
      planner.currentStep = 0;

      planner.updateCurrentStepPointer();

      // Parent should be auto-completed and pointer should move to step 2
      expect(planner.plan.steps[0].status).toBe('completed');
      expect(planner.currentStep).toBe(3); // Index of step 2
    });
  });
});

describe('StepDependencyAnalyzer - getReadySteps filtering', () => {
  let planner;
  let mockClient;

  beforeEach(() => {
    mockClient = createMockClient();
    planner = new Planner(mockClient);
    planner.parallelMode = true; // Enable parallel mode for these tests
  });

  it('should not return decomposed steps as ready', () => {
    planner.plan = {
      goal: 'Test goal',
      steps: [
        { number: 1, description: 'Decomposed parent', status: 'decomposed', decomposedInto: [1.1, 1.2], dependencies: [], canParallelize: true },
        { number: 1.1, description: 'Subtask 1', status: 'pending', dependencies: [], canParallelize: true },
        { number: 1.2, description: 'Subtask 2', status: 'pending', dependencies: [], canParallelize: true },
        { number: 2, description: 'Independent step', status: 'pending', dependencies: [], canParallelize: true },
      ],
      totalSteps: 4,
    };

    const batch = planner.getNextExecutableBatch();
    const batchNumbers = batch.map(s => s.number);

    // Should not include decomposed parent (1)
    expect(batchNumbers).not.toContain(1);
    // Should include at least one of the ready steps
    expect(batch.length).toBeGreaterThan(0);
    // The first step should be one of the subtasks or the independent step
    expect([1.1, 1.2, 2]).toContain(batchNumbers[0]);
  });

  it('should not return in_progress steps as ready', () => {
    planner.plan = {
      goal: 'Test goal',
      steps: [
        { number: 1, description: 'In progress', status: 'in_progress', dependencies: [] },
        { number: 2, description: 'Pending', status: 'pending', dependencies: [] },
      ],
      totalSteps: 2,
    };

    const batch = planner.getNextExecutableBatch();
    const batchNumbers = batch.map(s => s.number);

    // In progress step should not be in the batch
    expect(batchNumbers).not.toContain(1);
    // Pending step should be returned
    expect(batchNumbers).toContain(2);
  });

  it('should not return skipped steps as ready', () => {
    planner.plan = {
      goal: 'Test goal',
      steps: [
        { number: 1, description: 'Skipped', status: 'skipped', dependencies: [] },
        { number: 2, description: 'Pending', status: 'pending', dependencies: [] },
      ],
      totalSteps: 2,
    };

    const batch = planner.getNextExecutableBatch();
    const batchNumbers = batch.map(s => s.number);

    expect(batchNumbers).not.toContain(1);
    expect(batchNumbers).toContain(2);
  });

  it('should use getReadySteps to filter steps correctly', () => {
    // Test getReadySteps directly through dependency analyzer
    const steps = [
      { number: 1, description: 'Decomposed', status: 'decomposed', decomposedInto: [1.1], dependencies: [] },
      { number: 1.1, description: 'Subtask', status: 'pending', dependencies: [] },
      { number: 2, description: 'In progress', status: 'in_progress', dependencies: [] },
      { number: 3, description: 'Skipped', status: 'skipped', dependencies: [] },
      { number: 4, description: 'Failed', status: 'failed', dependencies: [] },
      { number: 5, description: 'Pending', status: 'pending', dependencies: [] },
    ];

    const readySteps = planner.dependencyAnalyzer.getReadySteps(steps, []);
    const readyNumbers = readySteps.map(s => s.number);

    // Should only include pending steps that aren't decomposed
    expect(readyNumbers).toEqual([1.1, 5]);
  });
});
