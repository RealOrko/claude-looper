/**
 * Tests for dependency-tracker.js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyTracker } from '../dependency-tracker.js';

describe('DependencyTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new DependencyTracker();
  });

  describe('constructor', () => {
    it('should initialize with empty maps', () => {
      expect(tracker.dependencies.size).toBe(0);
      expect(tracker.reverseDeps.size).toBe(0);
    });
  });

  describe('addDependency', () => {
    it('should add a dependency', () => {
      tracker.addDependency('step_2', 'step_1');
      expect(tracker.getDependencies('step_2')).toContain('step_1');
      expect(tracker.getDependents('step_1')).toContain('step_2');
    });

    it('should handle multiple dependencies', () => {
      tracker.addDependency('step_3', 'step_1');
      tracker.addDependency('step_3', 'step_2');
      expect(tracker.getDependencies('step_3')).toEqual(['step_1', 'step_2']);
    });

    it('should handle multiple dependents', () => {
      tracker.addDependency('step_2', 'step_1');
      tracker.addDependency('step_3', 'step_1');
      expect(tracker.getDependents('step_1')).toEqual(['step_2', 'step_3']);
    });
  });

  describe('removeDependency', () => {
    it('should remove a dependency', () => {
      tracker.addDependency('step_2', 'step_1');
      tracker.removeDependency('step_2', 'step_1');
      expect(tracker.getDependencies('step_2')).toEqual([]);
    });

    it('should handle removing non-existent dependency', () => {
      tracker.removeDependency('step_2', 'step_1');
      expect(tracker.getDependencies('step_2')).toEqual([]);
    });
  });

  describe('getDependents', () => {
    it('should return empty array for no dependents', () => {
      expect(tracker.getDependents('step_1')).toEqual([]);
    });
  });

  describe('getDependencies', () => {
    it('should return empty array for no dependencies', () => {
      expect(tracker.getDependencies('step_1')).toEqual([]);
    });
  });

  describe('canExecute', () => {
    it('should allow execution with no dependencies', () => {
      expect(tracker.canExecute('step_1', new Set())).toBe(true);
    });

    it('should allow execution when dependencies satisfied', () => {
      tracker.addDependency('step_2', 'step_1');
      expect(tracker.canExecute('step_2', new Set(['step_1']))).toBe(true);
    });

    it('should block execution when dependencies not satisfied', () => {
      tracker.addDependency('step_2', 'step_1');
      expect(tracker.canExecute('step_2', new Set())).toBe(false);
    });

    it('should require all dependencies', () => {
      tracker.addDependency('step_3', 'step_1');
      tracker.addDependency('step_3', 'step_2');
      expect(tracker.canExecute('step_3', new Set(['step_1']))).toBe(false);
      expect(tracker.canExecute('step_3', new Set(['step_1', 'step_2']))).toBe(true);
    });
  });

  describe('getExecutableSteps', () => {
    it('should return all steps when no dependencies', () => {
      const steps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      expect(tracker.getExecutableSteps(steps, new Set())).toEqual(['a', 'b', 'c']);
    });

    it('should exclude steps with unsatisfied dependencies', () => {
      const steps = [{ id: 'a' }, { id: 'b' }];
      tracker.addDependency('b', 'a');
      expect(tracker.getExecutableSteps(steps, new Set())).toEqual(['a']);
    });

    it('should exclude already completed steps', () => {
      const steps = [{ id: 'a' }, { id: 'b' }];
      expect(tracker.getExecutableSteps(steps, new Set(['a']))).toEqual(['b']);
    });
  });

  describe('getParallelizableSteps', () => {
    it('should return independent steps', () => {
      const steps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      const parallel = tracker.getParallelizableSteps(steps, new Set());
      expect(parallel.length).toBe(3);
    });

    it('should not include steps that depend on each other', () => {
      const steps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      tracker.addDependency('b', 'a');
      const parallel = tracker.getParallelizableSteps(steps, new Set());
      // Only 'a' and 'c' can be parallel (b depends on a)
      expect(parallel).toContain('a');
      expect(parallel).toContain('c');
    });
  });

  describe('getExecutionOrder', () => {
    it('should return steps in dependency order', () => {
      const steps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      tracker.addDependency('b', 'a');
      tracker.addDependency('c', 'b');

      const order = tracker.getExecutionOrder(steps);
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    });

    it('should handle diamond dependencies', () => {
      // a -> b -> d
      // a -> c -> d
      const steps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
      tracker.addDependency('b', 'a');
      tracker.addDependency('c', 'a');
      tracker.addDependency('d', 'b');
      tracker.addDependency('d', 'c');

      const order = tracker.getExecutionOrder(steps);
      expect(order[0]).toBe('a');
      expect(order[order.length - 1]).toBe('d');
    });

    it('should handle circular dependencies by including remaining', () => {
      const steps = [{ id: 'a' }, { id: 'b' }];
      tracker.addDependency('a', 'b');
      tracker.addDependency('b', 'a');

      const order = tracker.getExecutionOrder(steps);
      expect(order).toHaveLength(2);
    });
  });

  describe('detectCircularDependencies', () => {
    it('should return empty for no cycles', () => {
      tracker.addDependency('b', 'a');
      tracker.addDependency('c', 'b');
      expect(tracker.detectCircularDependencies()).toEqual([]);
    });

    it('should detect simple cycle', () => {
      tracker.addDependency('a', 'b');
      tracker.addDependency('b', 'a');
      const cycles = tracker.detectCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should detect longer cycles', () => {
      tracker.addDependency('b', 'a');
      tracker.addDependency('c', 'b');
      tracker.addDependency('a', 'c');
      const cycles = tracker.detectCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);
    });
  });

  describe('isValid', () => {
    it('should return true for DAG', () => {
      tracker.addDependency('b', 'a');
      tracker.addDependency('c', 'b');
      expect(tracker.isValid()).toBe(true);
    });

    it('should return false for cyclic graph', () => {
      tracker.addDependency('a', 'b');
      tracker.addDependency('b', 'a');
      expect(tracker.isValid()).toBe(false);
    });
  });

  describe('getCriticalPath', () => {
    it('should return single step for independent steps', () => {
      const steps = [{ id: 'a' }];
      const path = tracker.getCriticalPath(steps);
      expect(path).toEqual(['a']);
    });

    it('should return longest chain', () => {
      const steps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
      // Chain: a -> b -> c
      tracker.addDependency('b', 'a');
      tracker.addDependency('c', 'b');
      // Separate: d (no dependencies)

      const path = tracker.getCriticalPath(steps);
      expect(path.length).toBe(3);
      expect(path).toEqual(['a', 'b', 'c']);
    });
  });

  describe('clear', () => {
    it('should clear all dependencies', () => {
      tracker.addDependency('b', 'a');
      tracker.clear();
      expect(tracker.dependencies.size).toBe(0);
      expect(tracker.reverseDeps.size).toBe(0);
    });
  });

  describe('size', () => {
    it('should return total dependency count', () => {
      expect(tracker.size()).toBe(0);
      tracker.addDependency('b', 'a');
      expect(tracker.size()).toBe(1);
      tracker.addDependency('c', 'a');
      expect(tracker.size()).toBe(2);
    });
  });

  describe('toJSON', () => {
    it('should serialize dependencies', () => {
      tracker.addDependency('b', 'a');
      tracker.addDependency('c', 'a');
      const json = tracker.toJSON();
      expect(json).toEqual({ a: ['b', 'c'] });
    });
  });

  describe('fromJSON', () => {
    it('should deserialize dependencies', () => {
      const json = { a: ['b', 'c'] };
      const restored = DependencyTracker.fromJSON(json);
      expect(restored.getDependents('a')).toEqual(['b', 'c']);
      expect(restored.getDependencies('b')).toContain('a');
    });

    it('should handle empty JSON', () => {
      const restored = DependencyTracker.fromJSON({});
      expect(restored.size()).toBe(0);
    });
  });
});
