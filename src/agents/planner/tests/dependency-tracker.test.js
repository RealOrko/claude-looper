/**
 * Tests for Dependency Tracker Module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DependencyTracker,
  parseDependenciesFromResponse,
} from '../dependency-tracker.js';

describe('DependencyTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new DependencyTracker();
  });

  describe('addDependency', () => {
    it('should add a dependency relationship', () => {
      tracker.addDependency('step-2', 'step-1');

      expect(tracker.getDependents('step-1')).toContain('step-2');
      expect(tracker.getDependencies('step-2')).toContain('step-1');
    });

    it('should handle multiple dependencies for one step', () => {
      tracker.addDependency('step-3', 'step-1');
      tracker.addDependency('step-3', 'step-2');

      expect(tracker.getDependencies('step-3')).toHaveLength(2);
      expect(tracker.getDependencies('step-3')).toContain('step-1');
      expect(tracker.getDependencies('step-3')).toContain('step-2');
    });

    it('should handle multiple dependents for one step', () => {
      tracker.addDependency('step-2', 'step-1');
      tracker.addDependency('step-3', 'step-1');

      expect(tracker.getDependents('step-1')).toHaveLength(2);
      expect(tracker.getDependents('step-1')).toContain('step-2');
      expect(tracker.getDependents('step-1')).toContain('step-3');
    });
  });

  describe('getDependents', () => {
    it('should return empty array for step with no dependents', () => {
      expect(tracker.getDependents('step-1')).toEqual([]);
    });

    it('should return all dependents for a step', () => {
      tracker.addDependency('step-2', 'step-1');
      tracker.addDependency('step-3', 'step-1');

      const dependents = tracker.getDependents('step-1');

      expect(dependents).toHaveLength(2);
      expect(dependents).toContain('step-2');
      expect(dependents).toContain('step-3');
    });
  });

  describe('getDependencies', () => {
    it('should return empty array for step with no dependencies', () => {
      expect(tracker.getDependencies('step-1')).toEqual([]);
    });

    it('should return all dependencies for a step', () => {
      tracker.addDependency('step-3', 'step-1');
      tracker.addDependency('step-3', 'step-2');

      const dependencies = tracker.getDependencies('step-3');

      expect(dependencies).toHaveLength(2);
      expect(dependencies).toContain('step-1');
      expect(dependencies).toContain('step-2');
    });
  });

  describe('canExecute', () => {
    it('should return true for step with no dependencies', () => {
      expect(tracker.canExecute('step-1', new Set())).toBe(true);
    });

    it('should return true when all dependencies are completed', () => {
      tracker.addDependency('step-2', 'step-1');

      expect(tracker.canExecute('step-2', new Set(['step-1']))).toBe(true);
    });

    it('should return false when dependencies are not completed', () => {
      tracker.addDependency('step-2', 'step-1');

      expect(tracker.canExecute('step-2', new Set())).toBe(false);
    });

    it('should require all dependencies to be completed', () => {
      tracker.addDependency('step-3', 'step-1');
      tracker.addDependency('step-3', 'step-2');

      expect(tracker.canExecute('step-3', new Set(['step-1']))).toBe(false);
      expect(tracker.canExecute('step-3', new Set(['step-1', 'step-2']))).toBe(true);
    });
  });

  describe('getExecutionOrder', () => {
    it('should return correct order for linear dependencies', () => {
      const steps = [
        { id: 'step-1' },
        { id: 'step-2' },
        { id: 'step-3' },
      ];

      tracker.addDependency('step-2', 'step-1');
      tracker.addDependency('step-3', 'step-2');

      const order = tracker.getExecutionOrder(steps);

      expect(order.indexOf('step-1')).toBeLessThan(order.indexOf('step-2'));
      expect(order.indexOf('step-2')).toBeLessThan(order.indexOf('step-3'));
    });

    it('should handle parallel steps with shared dependency', () => {
      const steps = [
        { id: 'step-1' },
        { id: 'step-2' },
        { id: 'step-3' },
      ];

      tracker.addDependency('step-2', 'step-1');
      tracker.addDependency('step-3', 'step-1');

      const order = tracker.getExecutionOrder(steps);

      expect(order.indexOf('step-1')).toBe(0);
      expect(order).toContain('step-2');
      expect(order).toContain('step-3');
    });

    it('should handle diamond dependency pattern', () => {
      const steps = [
        { id: 'step-1' },
        { id: 'step-2' },
        { id: 'step-3' },
        { id: 'step-4' },
      ];

      tracker.addDependency('step-2', 'step-1');
      tracker.addDependency('step-3', 'step-1');
      tracker.addDependency('step-4', 'step-2');
      tracker.addDependency('step-4', 'step-3');

      const order = tracker.getExecutionOrder(steps);

      expect(order.indexOf('step-1')).toBe(0);
      expect(order.indexOf('step-4')).toBe(3);
      expect(order.indexOf('step-2')).toBeLessThan(order.indexOf('step-4'));
      expect(order.indexOf('step-3')).toBeLessThan(order.indexOf('step-4'));
    });

    it('should handle circular dependencies gracefully', () => {
      const steps = [
        { id: 'step-1' },
        { id: 'step-2' },
      ];

      tracker.addDependency('step-1', 'step-2');
      tracker.addDependency('step-2', 'step-1');

      const order = tracker.getExecutionOrder(steps);

      // Should include all steps even with circular dependency
      expect(order).toHaveLength(2);
    });
  });

  describe('hasCircularDependencies', () => {
    it('should return false for no dependencies', () => {
      expect(tracker.hasCircularDependencies()).toBe(false);
    });

    it('should return false for linear dependencies', () => {
      tracker.addDependency('step-2', 'step-1');
      tracker.addDependency('step-3', 'step-2');

      expect(tracker.hasCircularDependencies()).toBe(false);
    });

    it('should return true for direct circular dependency', () => {
      tracker.addDependency('step-1', 'step-2');
      tracker.addDependency('step-2', 'step-1');

      expect(tracker.hasCircularDependencies()).toBe(true);
    });

    it('should return true for indirect circular dependency', () => {
      tracker.addDependency('step-2', 'step-1');
      tracker.addDependency('step-3', 'step-2');
      tracker.addDependency('step-1', 'step-3');

      expect(tracker.hasCircularDependencies()).toBe(true);
    });
  });

  describe('getRootSteps', () => {
    it('should return empty array when no steps', () => {
      expect(tracker.getRootSteps()).toEqual([]);
    });

    it('should return steps with no dependencies', () => {
      tracker.addDependency('step-2', 'step-1');
      tracker.addDependency('step-3', 'step-1');

      const roots = tracker.getRootSteps();

      expect(roots).toContain('step-1');
      expect(roots).not.toContain('step-2');
      expect(roots).not.toContain('step-3');
    });

    it('should return multiple root steps', () => {
      tracker.addDependency('step-3', 'step-1');
      tracker.addDependency('step-3', 'step-2');

      const roots = tracker.getRootSteps();

      expect(roots).toContain('step-1');
      expect(roots).toContain('step-2');
    });
  });

  describe('clear', () => {
    it('should remove all dependencies', () => {
      tracker.addDependency('step-2', 'step-1');
      tracker.addDependency('step-3', 'step-2');

      tracker.clear();

      expect(tracker.getDependents('step-1')).toEqual([]);
      expect(tracker.getDependencies('step-2')).toEqual([]);
    });
  });

  describe('toJSON', () => {
    it('should serialize dependencies correctly', () => {
      tracker.addDependency('step-2', 'step-1');
      tracker.addDependency('step-3', 'step-1');

      const json = tracker.toJSON();

      expect(json['step-1']).toContain('step-2');
      expect(json['step-1']).toContain('step-3');
    });

    it('should return empty object for no dependencies', () => {
      const json = tracker.toJSON();

      expect(json).toEqual({});
    });
  });

  describe('fromJSON', () => {
    it('should deserialize dependencies correctly', () => {
      const json = {
        'step-1': ['step-2', 'step-3'],
        'step-2': ['step-4'],
      };

      const newTracker = DependencyTracker.fromJSON(json);

      expect(newTracker.getDependents('step-1')).toContain('step-2');
      expect(newTracker.getDependents('step-1')).toContain('step-3');
      expect(newTracker.getDependents('step-2')).toContain('step-4');
      expect(newTracker.getDependencies('step-2')).toContain('step-1');
    });

    it('should handle empty JSON', () => {
      const newTracker = DependencyTracker.fromJSON({});

      expect(newTracker.getDependents('any')).toEqual([]);
    });
  });

  describe('serialization roundtrip', () => {
    it('should preserve dependencies through serialize/deserialize', () => {
      tracker.addDependency('step-2', 'step-1');
      tracker.addDependency('step-3', 'step-1');
      tracker.addDependency('step-4', 'step-2');
      tracker.addDependency('step-4', 'step-3');

      const json = tracker.toJSON();
      const restored = DependencyTracker.fromJSON(json);

      expect(restored.getDependents('step-1')).toEqual(tracker.getDependents('step-1'));
      expect(restored.getDependencies('step-4')).toEqual(tracker.getDependencies('step-4'));
    });
  });
});

describe('parseDependenciesFromResponse', () => {
  let tracker;
  let mockPlan;

  beforeEach(() => {
    tracker = new DependencyTracker();
    mockPlan = {
      steps: [
        { id: 'step-1', number: 1 },
        { id: 'step-2', number: 2 },
        { id: 'step-3', number: 3 },
      ],
    };
  });

  it('should parse explicit dependencies', () => {
    const response = `
ANALYSIS:
Some analysis here

PLAN:
1. Step one
2. Step two
3. Step three

DEPENDENCIES:
Step 2 depends on Step 1
Step 3 depends on Step 2

TOTAL_STEPS: 3
`;

    parseDependenciesFromResponse(response, mockPlan, tracker);

    expect(tracker.getDependencies('step-2')).toContain('step-1');
    expect(tracker.getDependencies('step-3')).toContain('step-2');
  });

  it('should parse "requires" syntax', () => {
    const response = `
DEPENDENCIES:
Step 2 requires Step 1
Step 3 requires Step 1
`;

    parseDependenciesFromResponse(response, mockPlan, tracker);

    expect(tracker.getDependencies('step-2')).toContain('step-1');
    expect(tracker.getDependencies('step-3')).toContain('step-1');
  });

  it('should parse "needs" syntax', () => {
    const response = `
DEPENDENCIES:
Step 3 needs Step 2
`;

    parseDependenciesFromResponse(response, mockPlan, tracker);

    expect(tracker.getDependencies('step-3')).toContain('step-2');
  });

  it('should default to sequential when dependencies section says "None"', () => {
    const response = `
DEPENDENCIES:
None

TOTAL_STEPS: 3
`;

    parseDependenciesFromResponse(response, mockPlan, tracker);

    expect(tracker.getDependencies('step-2')).toContain('step-1');
    expect(tracker.getDependencies('step-3')).toContain('step-2');
  });

  it('should default to sequential when no dependencies section', () => {
    const response = `
ANALYSIS:
Some analysis

PLAN:
1. Step one
2. Step two

TOTAL_STEPS: 2
`;

    parseDependenciesFromResponse(response, mockPlan, tracker);

    expect(tracker.getDependencies('step-2')).toContain('step-1');
    expect(tracker.getDependencies('step-3')).toContain('step-2');
  });

  it('should clear existing dependencies before parsing', () => {
    tracker.addDependency('step-5', 'step-4');

    const response = `
DEPENDENCIES:
Step 2 depends on Step 1
`;

    parseDependenciesFromResponse(response, mockPlan, tracker);

    expect(tracker.getDependents('step-4')).toEqual([]);
    expect(tracker.getDependencies('step-2')).toContain('step-1');
  });

  it('should handle case-insensitive step matching', () => {
    const response = `
DEPENDENCIES:
STEP 2 DEPENDS ON STEP 1
step 3 depends on step 2
`;

    parseDependenciesFromResponse(response, mockPlan, tracker);

    expect(tracker.getDependencies('step-2')).toContain('step-1');
    expect(tracker.getDependencies('step-3')).toContain('step-2');
  });

  it('should skip invalid step numbers', () => {
    const response = `
DEPENDENCIES:
Step 5 depends on Step 1
Step 2 depends on Step 99
`;

    parseDependenciesFromResponse(response, mockPlan, tracker);

    // Should not have invalid dependencies
    expect(tracker.getDependencies('step-5')).not.toContain('step-1');
  });
});
