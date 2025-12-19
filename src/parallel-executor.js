/**
 * Parallel Step Executor
 * Handles concurrent execution of independent steps
 */

/**
 * ParallelStepExecutor - executes independent steps concurrently
 */
export class ParallelStepExecutor {
  constructor(runner) {
    this.runner = runner;
    this.maxParallel = 3; // Max concurrent step executions
  }

  /**
   * Execute a batch of independent steps in parallel
   */
  async executeBatch(steps, workerClients) {
    if (!steps || steps.length === 0) return [];

    // If only one step, no parallelization needed
    if (steps.length === 1) {
      return [await this.executeStepWithClient(steps[0], this.runner.client)];
    }

    // Limit to max parallel and available clients
    const batch = steps.slice(0, Math.min(this.maxParallel, workerClients.length));

    this.runner.onProgress({
      type: 'parallel_batch_started',
      steps: batch.map(s => ({ number: s.number, description: s.description })),
      count: batch.length,
    });

    // Mark all steps as in progress
    for (const step of batch) {
      this.runner.planner.markStepInProgress(step.number);
    }

    // Execute steps concurrently, each with its own client
    const executions = batch.map((step, i) =>
      this.executeStepWithClient(step, workerClients[i]).catch(error => ({
        step,
        success: false,
        error: error.message,
      }))
    );

    const results = await Promise.all(executions);

    this.runner.onProgress({
      type: 'parallel_batch_completed',
      results: results.map(r => ({
        stepNumber: r.step?.number,
        success: r.success,
        duration: r.duration,
        error: r.error,
      })),
    });

    return results;
  }

  /**
   * Execute a single step with a specific client
   */
  async executeStepWithClient(step, client) {
    const startTime = Date.now();

    try {
      const prompt = this.buildStepPrompt(step);

      // Ensure client has an active session before calling continueConversation
      let result;
      if (!client.hasActiveSession()) {
        // Start a new session with step context
        const systemContext = this.runner.buildSystemContext(
          this.runner.primaryGoal,
          this.runner.subGoals,
          this.runner.workingDirectory
        );
        result = await client.startSession(systemContext, prompt);
      } else {
        result = await client.continueConversation(prompt);
      }
      const response = result.response || '';
      const duration = Date.now() - startTime;

      // Track token usage from parallel execution
      if (result.tokensIn || result.tokensOut) {
        this.runner.contextManager.trackTokenUsage(
          result.tokensIn || 0,
          result.tokensOut || 0
        );
      }

      // Check for completion signals
      const completeMatch = response.match(/STEP\s+(?:\d+\s+)?COMPLETE/i);
      const blockedMatch = response.match(/STEP\s+(?:\d+\s+)?BLOCKED[:\s]*(.+?)(?:\n|$)/i);

      if (completeMatch) {
        this.runner.planner.completeStepByNumber(step.number);
        this.runner.metrics.recordStepExecution(step.number, 'completed', duration, {
          complexity: step.complexity,
          parallel: true,
        });
        return { step, success: true, duration, response };
      } else if (blockedMatch) {
        const reason = blockedMatch[1]?.trim() || 'Unknown';
        this.runner.planner.failStepByNumber(step.number, reason);
        this.runner.metrics.recordStepExecution(step.number, 'blocked', duration, { reason });
        return { step, success: false, blocked: true, reason, duration, response };
      }

      // No clear signal - return unclear status
      return { step, success: false, unclear: true, duration, response };
    } catch (error) {
      this.runner.planner.failStepByNumber(step.number, error.message);
      return { step, success: false, error: error.message, duration: Date.now() - startTime };
    }
  }

  /**
   * Build prompt for step execution
   * Uses ContextManager's buildOptimizedWorkerContext for token-efficient context
   */
  buildStepPrompt(step) {
    // Get optimized context from ContextManager for parallel workers
    const optimizedContext = this.runner.contextManager.buildOptimizedWorkerContext({
      goal: this.runner.primaryGoal,
      currentStep: step,
      recentHistory: this.runner.client.conversationHistory.slice(-10), // Only recent history
      planner: this.runner.planner,
      goalTracker: this.runner.goalTracker,
      maxLength: 3000, // Keep context compact for parallel workers
    });

    return `${optimizedContext}

## Execute Step ${step.number}: ${step.description}
Complexity: ${step.complexity}

Focus exclusively on this step. When complete, say "STEP COMPLETE".
If blocked, say "STEP BLOCKED: [reason]".

Begin now.`;
  }
}

export default ParallelStepExecutor;
