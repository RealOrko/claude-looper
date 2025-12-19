/**
 * Step Dependency Analyzer
 *
 * Analyzes execution plan steps to identify:
 * - Dependencies between steps
 * - Steps that can run in parallel
 * - Critical path through the plan
 *
 * This enables parallel execution of independent steps for faster completion.
 */

export class StepDependencyAnalyzer {
  constructor() {
    // Patterns that indicate a step creates something other steps might need
    this.creationPatterns = [
      /create|write|generate|build|setup|initialize|add|install|configure/i,
      /implement|develop|make|produce/i,
    ];

    // Patterns that indicate a step uses something another step creates
    this.usagePatterns = [
      /use|read|import|require|depend|test|verify|validate|check|run|execute/i,
      /update|modify|edit|change|fix|refactor/i,
    ];

    // Common artifacts that steps might create/use
    this.artifactPatterns = {
      files: /(?:file|module|component|class|function|script|config)s?\b/i,
      tests: /(?:test|spec|unit|integration|e2e)s?\b/i,
      database: /(?:database|schema|migration|model|table)s?\b/i,
      api: /(?:api|endpoint|route|controller|handler)s?\b/i,
      ui: /(?:ui|component|page|view|template|style)s?\b/i,
      docs: /(?:doc|documentation|readme|comment)s?\b/i,
      config: /(?:config|setting|environment|env)s?\b/i,
    };
  }

  /**
   * Analyze a plan and add dependency information to each step
   * Returns enhanced steps with dependency metadata
   */
  analyzeDependencies(steps) {
    if (!steps || steps.length === 0) return [];

    const enhancedSteps = steps.map(step => ({
      ...step,
      dependencies: [],      // Step numbers this depends on
      dependents: [],        // Step numbers that depend on this
      artifacts: [],         // What this step creates/modifies
      requirements: [],      // What this step needs
      canParallelize: false, // Can run with other steps
      parallelGroup: null,   // Group ID for parallel execution
    }));

    // First pass: identify artifacts and requirements for each step
    for (const step of enhancedSteps) {
      step.artifacts = this.extractArtifacts(step.description, 'creates');
      step.requirements = this.extractArtifacts(step.description, 'uses');
    }

    // Second pass: build dependency graph
    for (let i = 0; i < enhancedSteps.length; i++) {
      const currentStep = enhancedSteps[i];

      // Check all previous steps for potential dependencies
      for (let j = 0; j < i; j++) {
        const previousStep = enhancedSteps[j];

        if (this.stepDependsOn(currentStep, previousStep)) {
          currentStep.dependencies.push(previousStep.number);
          previousStep.dependents.push(currentStep.number);
        }
      }
    }

    // Third pass: identify parallelization opportunities
    this.identifyParallelGroups(enhancedSteps);

    return enhancedSteps;
  }

  /**
   * Extract artifacts (things created or used) from a step description
   */
  extractArtifacts(description, mode = 'creates') {
    const artifacts = [];
    const desc = description.toLowerCase();

    // Check for creation or usage patterns
    const patterns = mode === 'creates' ? this.creationPatterns : this.usagePatterns;
    const hasPattern = patterns.some(p => p.test(desc));

    if (!hasPattern && mode === 'creates') {
      // If no clear creation pattern, this step might not create artifacts
      return artifacts;
    }

    // Identify artifact types
    for (const [type, pattern] of Object.entries(this.artifactPatterns)) {
      if (pattern.test(desc)) {
        artifacts.push(type);
      }
    }

    // Extract specific named items (e.g., "UserService", "login component")
    const namedItems = desc.match(/['"`]([^'"`]+)['"`]/g);
    if (namedItems) {
      artifacts.push(...namedItems.map(item => item.replace(/['"`]/g, '')));
    }

    return [...new Set(artifacts)]; // Deduplicate
  }

  /**
   * Determine if stepA depends on stepB
   */
  stepDependsOn(stepA, stepB) {
    // Check if stepA's requirements overlap with stepB's artifacts
    const requirementsOverlap = stepA.requirements.some(req =>
      stepB.artifacts.includes(req)
    );

    if (requirementsOverlap) return true;

    // Check for explicit ordering keywords
    const descA = stepA.description.toLowerCase();
    const descB = stepB.description.toLowerCase();

    // If stepA mentions testing/verifying and stepB creates, there's a dependency
    if (/test|verify|validate|check|review/.test(descA)) {
      if (/create|implement|write|build|add/.test(descB)) {
        // Check if they're about the same thing
        const sharedArtifacts = stepA.requirements.filter(r =>
          stepB.artifacts.includes(r)
        );
        if (sharedArtifacts.length > 0) return true;

        // Fuzzy match: similar words in descriptions
        const wordsA = new Set(descA.split(/\s+/).filter(w => w.length > 4));
        const wordsB = new Set(descB.split(/\s+/).filter(w => w.length > 4));
        const overlap = [...wordsA].filter(w => wordsB.has(w));
        if (overlap.length >= 2) return true;
      }
    }

    // Setup/config steps are usually dependencies
    if (/setup|configure|initialize|install/.test(descB)) {
      if (!/setup|configure|initialize|install/.test(descA)) {
        return true; // Most steps depend on setup
      }
    }

    return false;
  }

  /**
   * Identify groups of steps that can run in parallel
   */
  identifyParallelGroups(steps) {
    let groupId = 0;
    const visited = new Set();

    for (let i = 0; i < steps.length; i++) {
      if (visited.has(i)) continue;

      const currentStep = steps[i];
      const parallelCandidates = [i];

      // Look for steps that can run with this one
      for (let j = i + 1; j < steps.length; j++) {
        if (visited.has(j)) continue;

        const otherStep = steps[j];

        // Can parallelize if:
        // 1. Neither depends on the other
        // 2. They don't have conflicting resource usage
        // 3. They're both at the same "level" in the dependency graph
        if (this.canRunInParallel(currentStep, otherStep, steps)) {
          parallelCandidates.push(j);
        }
      }

      // If we found parallelizable steps, mark them
      if (parallelCandidates.length > 1) {
        for (const idx of parallelCandidates) {
          steps[idx].canParallelize = true;
          steps[idx].parallelGroup = groupId;
          visited.add(idx);
        }
        groupId++;
      } else {
        visited.add(i);
      }
    }
  }

  /**
   * Check if two steps can run in parallel
   */
  canRunInParallel(stepA, stepB, allSteps) {
    const depsA = stepA.dependencies || [];
    const depsB = stepB.dependencies || [];

    // Can't parallelize if one depends on the other
    if (depsA.includes(stepB.number)) return false;
    if (depsB.includes(stepA.number)) return false;

    // Can't parallelize if they share dependencies that haven't been met
    const sharedDeps = depsA.filter(d =>
      depsB.includes(d)
    );

    // Check if shared dependencies would cause sequencing issues
    for (const depNum of sharedDeps) {
      const depStep = allSteps.find(s => s.number === depNum);
      if (depStep && depStep.dependents.length > 1) {
        // Multiple steps depend on this - check for resource conflicts
        if (this.hasResourceConflict(stepA, stepB)) {
          return false;
        }
      }
    }

    // Can't parallelize steps that modify the same artifacts
    const sharedArtifacts = stepA.artifacts.filter(a =>
      stepB.artifacts.includes(a)
    );
    if (sharedArtifacts.length > 0) return false;

    // Can't parallelize if both require exclusive resources
    const exclusiveResources = ['database', 'config', 'env'];
    const stepAExclusive = stepA.requirements.some(r => exclusiveResources.includes(r));
    const stepBExclusive = stepB.requirements.some(r => exclusiveResources.includes(r));
    if (stepAExclusive && stepBExclusive) return false;

    return true;
  }

  /**
   * Check for resource conflicts between steps
   */
  hasResourceConflict(stepA, stepB) {
    // File system conflicts
    const fileConflict = stepA.artifacts.some(a =>
      stepB.artifacts.includes(a) || stepB.requirements.includes(a)
    );
    if (fileConflict) return true;

    // Same component/module conflicts
    const descA = stepA.description.toLowerCase();
    const descB = stepB.description.toLowerCase();

    // Extract component names
    const componentPattern = /(?:component|module|service|class|file)\s+['"`]?(\w+)['"`]?/gi;
    const componentsA = [...descA.matchAll(componentPattern)].map(m => m[1]);
    const componentsB = [...descB.matchAll(componentPattern)].map(m => m[1]);

    return componentsA.some(c => componentsB.includes(c));
  }

  /**
   * Get steps ready to execute (all dependencies satisfied)
   * Only returns leaf tasks - decomposed parents are traversed, not executed
   */
  getReadySteps(steps, completedStepNumbers = []) {
    return steps.filter(step => {
      // Filter out finished steps
      if (step.status === 'completed' || step.status === 'failed' || step.status === 'skipped') {
        return false;
      }
      if (completedStepNumbers.includes(step.number)) return false;

      // Filter out decomposed steps - their subtasks should be executed instead
      // A decomposed step is one that has decomposedInto array (regardless of status field)
      if (step.decomposedInto && step.decomposedInto.length > 0) {
        return false;
      }

      // Filter out steps currently in progress (avoid duplicate execution)
      if (step.status === 'in_progress') {
        return false;
      }

      // All dependencies must be completed (default to empty array if not set)
      return (step.dependencies || []).every(dep => completedStepNumbers.includes(dep));
    });
  }

  /**
   * Get the next batch of steps that can run in parallel
   */
  getNextParallelBatch(steps, completedStepNumbers = []) {
    const readySteps = this.getReadySteps(steps, completedStepNumbers);

    if (readySteps.length === 0) return [];
    if (readySteps.length === 1) return readySteps;

    // Group ready steps by parallel group
    const groups = new Map();

    for (const step of readySteps) {
      if (step.parallelGroup !== null) {
        if (!groups.has(step.parallelGroup)) {
          groups.set(step.parallelGroup, []);
        }
        groups.get(step.parallelGroup).push(step);
      }
    }

    // Return the largest parallel group, or individual steps
    let largestGroup = [];
    for (const group of groups.values()) {
      if (group.length > largestGroup.length) {
        largestGroup = group;
      }
    }

    // If we have a parallel group, return it
    if (largestGroup.length > 1) {
      return largestGroup;
    }

    // Otherwise, check if any ready steps can be parallelized even without a group
    const parallelizable = [];
    for (let i = 0; i < readySteps.length; i++) {
      let canAddToParallel = true;
      for (const existing of parallelizable) {
        if (!this.canRunInParallel(readySteps[i], existing, steps)) {
          canAddToParallel = false;
          break;
        }
      }
      if (canAddToParallel) {
        parallelizable.push(readySteps[i]);
      }
    }

    return parallelizable.length > 1 ? parallelizable : [readySteps[0]];
  }

  /**
   * Calculate the critical path through the plan
   * Returns the longest chain of dependent steps
   */
  getCriticalPath(steps) {
    const memo = new Map();

    const longestPath = (stepNum) => {
      if (memo.has(stepNum)) return memo.get(stepNum);

      const step = steps.find(s => s.number === stepNum);
      if (!step) return [];

      const dependents = step.dependents || [];
      if (dependents.length === 0) {
        memo.set(stepNum, [step]);
        return [step];
      }

      let longest = [];
      for (const depNum of dependents) {
        const path = longestPath(depNum);
        if (path.length > longest.length) {
          longest = path;
        }
      }

      const result = [step, ...longest];
      memo.set(stepNum, result);
      return result;
    };

    // Find the critical path starting from steps with no dependencies
    let criticalPath = [];
    for (const step of steps) {
      if ((step.dependencies || []).length === 0) {
        const path = longestPath(step.number);
        if (path.length > criticalPath.length) {
          criticalPath = path;
        }
      }
    }

    return criticalPath;
  }

  /**
   * Get execution statistics for a plan
   */
  getExecutionStats(steps) {
    const analyzedSteps = this.analyzeDependencies(steps);
    const criticalPath = this.getCriticalPath(analyzedSteps);
    const parallelGroups = new Set(
      analyzedSteps.filter(s => s.parallelGroup !== null).map(s => s.parallelGroup)
    );

    // Calculate theoretical speedup
    const sequentialTime = steps.length;
    const parallelTime = criticalPath.length;
    const speedup = sequentialTime / parallelTime;

    return {
      totalSteps: steps.length,
      criticalPathLength: criticalPath.length,
      parallelizableSteps: analyzedSteps.filter(s => s.canParallelize).length,
      parallelGroups: parallelGroups.size,
      theoreticalSpeedup: speedup.toFixed(2) + 'x',
      criticalPath: criticalPath.map(s => s.number),
    };
  }
}

export default StepDependencyAnalyzer;
