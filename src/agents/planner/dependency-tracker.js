/**
 * Step Dependency Tracker Module
 *
 * Tracks dependencies between plan steps and provides execution ordering.
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
   * @param {string} stepId - The step that depends on another
   * @param {string} dependsOnId - The step being depended on
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
   * Get steps that depend on the given step
   * @param {string} stepId - The step to check
   * @returns {string[]} Array of dependent step IDs
   */
  getDependents(stepId) {
    return Array.from(this.dependencies.get(stepId) || []);
  }

  /**
   * Get steps that the given step depends on
   * @param {string} stepId - The step to check
   * @returns {string[]} Array of dependency step IDs
   */
  getDependencies(stepId) {
    return Array.from(this.reverseDeps.get(stepId) || []);
  }

  /**
   * Check if a step can be executed (all dependencies satisfied)
   * @param {string} stepId - The step to check
   * @param {Set<string>} completedSteps - Set of completed step IDs
   * @returns {boolean} Whether the step can be executed
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
   * Get execution order respecting dependencies
   * @param {Object[]} steps - Array of steps with id property
   * @returns {string[]} Ordered array of step IDs
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
   * Check if there are any circular dependencies
   * @returns {boolean} Whether circular dependencies exist
   */
  hasCircularDependencies() {
    const visited = new Set();
    const recursionStack = new Set();

    const hasCycle = (stepId) => {
      if (recursionStack.has(stepId)) {
        return true;
      }
      if (visited.has(stepId)) {
        return false;
      }

      visited.add(stepId);
      recursionStack.add(stepId);

      const deps = this.reverseDeps.get(stepId) || new Set();
      for (const depId of deps) {
        if (hasCycle(depId)) {
          return true;
        }
      }

      recursionStack.delete(stepId);
      return false;
    };

    for (const stepId of this.reverseDeps.keys()) {
      if (hasCycle(stepId)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all steps with no dependencies (can start immediately)
   * @returns {string[]} Array of step IDs with no dependencies
   */
  getRootSteps() {
    const allSteps = new Set([
      ...this.dependencies.keys(),
      ...this.reverseDeps.keys(),
    ]);

    const roots = [];
    for (const stepId of allSteps) {
      const deps = this.reverseDeps.get(stepId);
      if (!deps || deps.size === 0) {
        roots.push(stepId);
      }
    }

    return roots;
  }

  /**
   * Clear all dependencies
   */
  clear() {
    this.dependencies.clear();
    this.reverseDeps.clear();
  }

  /**
   * Serialize dependencies for storage
   * @returns {Object} Serialized dependencies
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

/**
 * Parse dependencies from plan response and populate tracker
 * @param {string} response - The plan response text
 * @param {Object} plan - The plan object with steps
 * @param {DependencyTracker} tracker - The tracker to populate
 */
export function parseDependenciesFromResponse(response, plan, tracker) {
  // Reset tracker
  tracker.clear();

  // Look for DEPENDENCIES section
  const depsMatch = response.match(/DEPENDENCIES:\s*\n([\s\S]*?)(?=RISKS:|TOTAL_STEPS:|$)/i);
  if (!depsMatch || depsMatch[1].toLowerCase().includes('none')) {
    // Assume sequential dependencies by default
    for (let i = 1; i < plan.steps.length; i++) {
      tracker.addDependency(
        plan.steps[i].id,
        plan.steps[i - 1].id
      );
    }
    return;
  }

  // Parse explicit dependencies like "Step 2 depends on Step 1"
  const depLines = depsMatch[1].split('\n');
  for (const line of depLines) {
    const depMatch = line.match(/step\s*(\d+)\s*(?:depends on|requires|needs)\s*step\s*(\d+)/i);
    if (depMatch) {
      const dependent = parseInt(depMatch[1], 10);
      const dependsOn = parseInt(depMatch[2], 10);

      const dependentStep = plan.steps.find(s => s.number === dependent);
      const dependsOnStep = plan.steps.find(s => s.number === dependsOn);

      if (dependentStep && dependsOnStep) {
        tracker.addDependency(dependentStep.id, dependsOnStep.id);
      }
    }
  }
}

export default DependencyTracker;
