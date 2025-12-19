/**
 * dependency-tracker.js - Step dependency tracking for the Planner agent
 *
 * Manages dependencies between plan steps to ensure correct execution order
 * and identify which steps can be executed in parallel.
 */

/**
 * Step dependency tracker
 */
export class DependencyTracker {
  constructor() {
    this.dependencies = new Map(); // stepId -> Set of dependent stepIds
    this.reverseDeps = new Map();  // stepId -> Set of steps it depends on
  }

  /**
   * Add a dependency: stepId depends on dependsOnId
   * @param {string} stepId - The step that has the dependency
   * @param {string} dependsOnId - The step it depends on
   */
  addDependency(stepId, dependsOnId) {
    if (!this.dependencies.has(dependsOnId)) {
      this.dependencies.set(dependsOnId, new Set());
    }
    this.dependencies.get(dependsOnId).add(stepId);

    if (!this.reverseDeps.has(stepId)) {
      this.reverseDeps.set(stepId, new Set());
    }
    this.reverseDeps.get(stepId).add(dependsOnId);
  }

  /**
   * Remove a dependency
   * @param {string} stepId - The step to remove dependency from
   * @param {string} dependsOnId - The dependency to remove
   */
  removeDependency(stepId, dependsOnId) {
    if (this.dependencies.has(dependsOnId)) {
      this.dependencies.get(dependsOnId).delete(stepId);
    }
    if (this.reverseDeps.has(stepId)) {
      this.reverseDeps.get(stepId).delete(dependsOnId);
    }
  }

  /**
   * Get steps that depend on the given step
   * @param {string} stepId - The step to check
   * @returns {Array<string>} Array of dependent step IDs
   */
  getDependents(stepId) {
    return Array.from(this.dependencies.get(stepId) || []);
  }

  /**
   * Get steps that the given step depends on
   * @param {string} stepId - The step to check
   * @returns {Array<string>} Array of dependency step IDs
   */
  getDependencies(stepId) {
    return Array.from(this.reverseDeps.get(stepId) || []);
  }

  /**
   * Check if a step can be executed (all dependencies satisfied)
   * @param {string} stepId - The step to check
   * @param {Set<string>} completedSteps - Set of completed step IDs
   * @returns {boolean} True if step can be executed
   */
  canExecute(stepId, completedSteps) {
    const deps = this.reverseDeps.get(stepId);
    if (!deps || deps.size === 0) return true;

    for (const depId of deps) {
      if (!completedSteps.has(depId)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get all steps that can be executed given current completed steps
   * @param {Array<Object>} steps - Array of step objects with id property
   * @param {Set<string>} completedSteps - Set of completed step IDs
   * @returns {Array<string>} Array of executable step IDs
   */
  getExecutableSteps(steps, completedSteps) {
    const executable = [];
    for (const step of steps) {
      if (!completedSteps.has(step.id) && this.canExecute(step.id, completedSteps)) {
        executable.push(step.id);
      }
    }
    return executable;
  }

  /**
   * Get steps that can be executed in parallel
   * @param {Array<Object>} steps - Array of step objects with id property
   * @param {Set<string>} completedSteps - Set of completed step IDs
   * @returns {Array<string>} Array of step IDs that can run in parallel
   */
  getParallelizableSteps(steps, completedSteps) {
    const executable = this.getExecutableSteps(steps, completedSteps);

    // Filter to steps that don't depend on each other
    const parallel = [];
    for (const stepId of executable) {
      const conflictsWithParallel = parallel.some(existingId => {
        // Check if either step depends on the other
        const existingDeps = this.getDependencies(existingId);
        const stepDeps = this.getDependencies(stepId);
        return existingDeps.includes(stepId) || stepDeps.includes(existingId);
      });

      if (!conflictsWithParallel) {
        parallel.push(stepId);
      }
    }

    return parallel;
  }

  /**
   * Get execution order respecting dependencies
   * @param {Array<Object>} steps - Array of step objects with id property
   * @returns {Array<string>} Ordered array of step IDs
   */
  getExecutionOrder(steps) {
    const order = [];
    const completed = new Set();
    const remaining = new Set(steps.map(s => s.id));

    while (remaining.size > 0) {
      let added = false;
      for (const stepId of remaining) {
        if (this.canExecute(stepId, completed)) {
          order.push(stepId);
          completed.add(stepId);
          remaining.delete(stepId);
          added = true;
        }
      }
      // Prevent infinite loop if circular dependency
      if (!added) {
        // Add remaining in original order
        for (const stepId of remaining) {
          order.push(stepId);
        }
        break;
      }
    }

    return order;
  }

  /**
   * Detect circular dependencies
   * @returns {Array<Array<string>>} Array of cycles (each cycle is array of step IDs)
   */
  detectCircularDependencies() {
    const cycles = [];
    const visited = new Set();
    const recursionStack = new Set();

    const dfs = (stepId, path) => {
      if (recursionStack.has(stepId)) {
        // Found a cycle
        const cycleStart = path.indexOf(stepId);
        cycles.push(path.slice(cycleStart));
        return;
      }

      if (visited.has(stepId)) return;

      visited.add(stepId);
      recursionStack.add(stepId);

      const dependents = this.getDependents(stepId);
      for (const dependent of dependents) {
        dfs(dependent, [...path, stepId]);
      }

      recursionStack.delete(stepId);
    };

    // Check from each step
    for (const stepId of this.dependencies.keys()) {
      dfs(stepId, []);
    }

    return cycles;
  }

  /**
   * Check if dependencies form a valid DAG (no cycles)
   * @returns {boolean} True if no circular dependencies
   */
  isValid() {
    return this.detectCircularDependencies().length === 0;
  }

  /**
   * Get the critical path (longest dependency chain)
   * @param {Array<Object>} steps - Array of step objects with id property
   * @returns {Array<string>} Array of step IDs in critical path
   */
  getCriticalPath(steps) {
    const memo = new Map();

    const getPathLength = (stepId) => {
      if (memo.has(stepId)) return memo.get(stepId);

      const deps = this.getDependencies(stepId);
      if (deps.length === 0) {
        memo.set(stepId, { length: 1, path: [stepId] });
        return memo.get(stepId);
      }

      let maxPath = { length: 0, path: [] };
      for (const depId of deps) {
        const depPath = getPathLength(depId);
        if (depPath.length >= maxPath.length) {
          maxPath = depPath;
        }
      }

      const result = {
        length: maxPath.length + 1,
        path: [...maxPath.path, stepId],
      };
      memo.set(stepId, result);
      return result;
    };

    let longestPath = { length: 0, path: [] };
    for (const step of steps) {
      const path = getPathLength(step.id);
      if (path.length > longestPath.length) {
        longestPath = path;
      }
    }

    return longestPath.path;
  }

  /**
   * Clear all dependencies
   */
  clear() {
    this.dependencies.clear();
    this.reverseDeps.clear();
  }

  /**
   * Get total number of dependencies
   * @returns {number} Total dependency count
   */
  size() {
    let count = 0;
    for (const deps of this.dependencies.values()) {
      count += deps.size;
    }
    return count;
  }

  /**
   * Serialize dependencies for storage
   * @returns {Object} JSON-serializable object
   */
  toJSON() {
    const deps = {};
    for (const [key, value] of this.dependencies) {
      deps[key] = Array.from(value);
    }
    return deps;
  }

  /**
   * Load dependencies from serialized form
   * @param {Object} json - Serialized dependencies
   * @returns {DependencyTracker} New tracker instance
   */
  static fromJSON(json) {
    const tracker = new DependencyTracker();
    for (const [dependsOn, dependents] of Object.entries(json)) {
      for (const dependent of dependents) {
        tracker.addDependency(dependent, dependsOn);
      }
    }
    return tracker;
  }
}

export default DependencyTracker;
