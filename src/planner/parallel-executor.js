/**
 * Parallel Executor - Manages parallel execution of plan steps
 */

export class ParallelExecutor {
  constructor(dependencyAnalyzer) {
    this.dependencyAnalyzer = dependencyAnalyzer;
    this.parallelMode = false;
    this.inProgressSteps = new Set();
    this.completedStepNumbers = [];
  }

  /** Enable parallel execution mode */
  enableParallelMode() {
    this.parallelMode = true;
  }

  /** Disable parallel execution mode */
  disableParallelMode() {
    this.parallelMode = false;
  }

  /** Check if parallel mode is enabled */
  isParallelModeEnabled() {
    return this.parallelMode;
  }

  /** Get number of steps currently in progress */
  getInProgressCount() {
    return this.inProgressSteps.size;
  }

  /** Check if any steps are currently in progress */
  hasInProgressSteps() {
    return this.inProgressSteps.size > 0;
  }

  /** Mark a step as in-progress */
  markStepInProgress(step) {
    this.inProgressSteps.add(step.number);
    step.status = 'in_progress';
    step.startTime = Date.now();
  }

  /** Complete a step */
  completeStep(step) {
    this.inProgressSteps.delete(step.number);
    step.status = 'completed';
    step.endTime = Date.now();
    step.duration = step.endTime - (step.startTime || step.endTime);
    this.completedStepNumbers.push(step.number);
  }

  /** Fail a step */
  failStep(step, reason) {
    this.inProgressSteps.delete(step.number);
    step.status = 'failed';
    step.failReason = reason;
    step.endTime = Date.now();
  }

  /** Get the next batch of steps that can be executed */
  getNextExecutableBatch(plan, getCurrentStep) {
    if (!plan) return [];

    const completed = plan.steps.filter(s => s.status === 'completed').map(s => s.number);

    if (!this.parallelMode) {
      const step = getCurrentStep();
      return step ? [step] : [];
    }

    return this.dependencyAnalyzer.getNextParallelBatch(plan.steps, completed);
  }

  /** Inject decomposed subtasks into the plan */
  injectSubtasks(plan, decomposition) {
    if (!decomposition || !plan) return false;

    const { parentStep, subtasks, parallelSafe } = decomposition;

    const parentIndex = plan.steps.findIndex(s => s.number === parentStep.number);
    if (parentIndex === -1) return false;

    plan.steps[parentIndex].status = 'decomposed';
    plan.steps[parentIndex].decomposedInto = subtasks.map(s => s.number);

    plan.steps.splice(parentIndex + 1, 0, ...subtasks);
    plan.totalSteps = plan.steps.length;

    if (parallelSafe) {
      plan.steps = this.dependencyAnalyzer.analyzeDependencies(plan.steps);
      plan.executionStats = this.dependencyAnalyzer.getExecutionStats(plan.steps);
    }

    return true;
  }

  /** Reset parallel executor state */
  reset() {
    this.inProgressSteps.clear();
    this.completedStepNumbers = [];
  }

  /** Get completed step numbers */
  getCompletedStepNumbers() {
    return [...this.completedStepNumbers];
  }
}

export default ParallelExecutor;
