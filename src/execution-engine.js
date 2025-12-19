/**
 * Execution Engine - handles core execution loop, iteration running, and supervision
 */
import { ResponseProcessor } from './response-processor.js';

export class ExecutionEngine {
  constructor(runner) {
    this.runner = runner;
    this.responseProcessor = new ResponseProcessor(runner);
  }

  /** Run a single iteration */
  async runIteration() {
    let prompt;
    let supervisionResult = null;

    const r = this.runner;

    // Check if this is the first iteration (no session yet)
    const isFirstIteration = !r.client.hasActiveSession();

    if (isFirstIteration) {
      // First iteration - start new session with full context
      const systemContext = r.buildSystemContext(
        r.primaryGoal,
        r.subGoals,
        r.workingDirectory
      );

      prompt = r.initialContext
        ? `Additional context: ${r.initialContext}\n\nStart working on the goal now.`
        : 'Start working on the goal now.';

      const result = await r.client.startSession(systemContext, prompt);

      // Track token usage from API response
      if (result.tokensIn || result.tokensOut) {
        r.contextManager.trackTokenUsage(
          result.tokensIn || 0,
          result.tokensOut || 0
        );
      }

      return this.processResponse(result, null);
    }

    // Get last response for supervision
    const lastResponse = r.client.conversationHistory
      .filter(m => m.role === 'assistant')
      .pop();

    // Supervisor checks the last response
    if (lastResponse) {
      supervisionResult = await this.runSupervision(lastResponse);
    }

    // Build the prompt for this iteration
    prompt = await this.buildIterationPrompt(supervisionResult);

    const result = await r.client.continueConversation(prompt);

    // Track token usage from API response
    if (result.tokensIn || result.tokensOut) {
      r.contextManager.trackTokenUsage(
        result.tokensIn || 0,
        result.tokensOut || 0
      );
    }

    return this.processResponse(result, supervisionResult);
  }

  /** Run supervision check on last response */
  async runSupervision(lastResponse) {
    const r = this.runner;
    const currentStep = r.planner?.getCurrentStep();

    // Try to use cached assessment for similar responses
    const cachedAssessment = r.contextManager.getCachedAssessment(
      lastResponse.content,
      r.primaryGoal,
      r.supervisor.consecutiveIssues
    );

    if (cachedAssessment && !cachedAssessment.needsIntervention) {
      // Use cached assessment for speed
      const supervisionResult = {
        assessment: cachedAssessment,
        needsIntervention: false,
        prompt: null,
        consecutiveIssues: r.supervisor.consecutiveIssues,
        escalated: false,
        cached: true,
      };
      r.metrics.recordSupervision(supervisionResult, 0);
      this.emitSupervisionEvent(supervisionResult);
      return supervisionResult;
    }

    // Full supervision check
    const supervisionStart = Date.now();
    const supervisionResult = await r.supervisor.check(
      lastResponse.content,
      r.recentActions,
      { currentStep, complexity: currentStep?.complexity }
    );
    const supervisionDuration = Date.now() - supervisionStart;
    r.metrics.recordSupervision(supervisionResult, supervisionDuration);

    // Cache the result if it was a CONTINUE action
    if (supervisionResult.assessment?.action === 'CONTINUE') {
      r.contextManager.cacheAssessment(
        lastResponse.content,
        r.primaryGoal,
        r.supervisor.consecutiveIssues,
        supervisionResult.assessment
      );
    }

    this.emitSupervisionEvent(supervisionResult);
    this.handleEscalations(supervisionResult);

    return supervisionResult;
  }

  /** Emit supervision event */
  emitSupervisionEvent(supervisionResult) {
    const r = this.runner;
    r.onSupervision({
      iteration: r.iterationCount,
      assessment: supervisionResult.assessment,
      needsIntervention: supervisionResult.needsIntervention,
      consecutiveIssues: supervisionResult.consecutiveIssues,
      escalated: supervisionResult.escalated,
    });
  }

  /** Handle escalation actions from supervision */
  handleEscalations(supervisionResult) {
    const r = this.runner;
    const action = supervisionResult.assessment?.action;

    if (action === 'CRITICAL') {
      r.contextManager.recordDecision(
        'Critical escalation issued',
        `Score: ${supervisionResult.assessment.score}, Consecutive issues: ${supervisionResult.consecutiveIssues}`
      );

      r.onEscalation({
        type: 'critical',
        iteration: r.iterationCount,
        consecutiveIssues: supervisionResult.consecutiveIssues,
        score: supervisionResult.assessment.score,
        message: 'Final warning before session termination',
      });
    }

    if (action === 'ABORT') {
      r.contextManager.recordDecision(
        'Session aborted due to persistent drift',
        `Score: ${supervisionResult.assessment.score}, Consecutive issues: ${supervisionResult.consecutiveIssues}`
      );

      r.onEscalation({
        type: 'abort',
        iteration: r.iterationCount,
        consecutiveIssues: supervisionResult.consecutiveIssues,
        score: supervisionResult.assessment.score,
        message: 'Session terminated due to persistent drift',
      });
      r.shouldStop = true;
      r.abortReason = 'Escalation: unable to maintain goal focus';
    }
  }

  /** Build the prompt for this iteration */
  async buildIterationPrompt(supervisionResult) {
    const r = this.runner;
    const prompts = [];

    // Add supervisor correction if needed (high priority - always include)
    if (supervisionResult?.needsIntervention && supervisionResult.prompt) {
      prompts.push(supervisionResult.prompt);
    }

    // Add time-based prompts
    const timePrompt = r.phaseManager.getTimePrompt();
    if (timePrompt) {
      prompts.push(timePrompt);
    }

    // Periodic progress check (every 5 minutes)
    if (r.phaseManager.isTimeForProgressCheck(r.lastProgressCheck)) {
      prompts.push(r.goalTracker.getProgressCheckPrompt());
      r.lastProgressCheck = Date.now();
    }

    // Use ContextManager's generateSmartContext for intelligent context building
    const currentStep = r.planner?.getCurrentStep();
    const smartContext = r.contextManager.generateSmartContext({
      goal: r.primaryGoal,
      currentStep: currentStep,
      history: r.client.conversationHistory,
      planner: r.planner,
      goalTracker: r.goalTracker,
      maxTokens: r.contextManager.options.tokenBudget,
    });

    if (smartContext) {
      prompts.push(smartContext);
    }

    // Add specific step prompt if available
    if (currentStep) {
      const progress = r.planner.getProgress();
      const stepPrompt = `## CURRENT STEP (${progress.current}/${progress.total})
**${currentStep.description}**

Focus on completing this step. Say "STEP COMPLETE" when done.`;
      prompts.push(stepPrompt);
    }

    if (prompts.length === 0) {
      return 'Continue. What is your next action?';
    }

    return prompts.join('\n\n') + '\n\nContinue working.';
  }

  /** Process Claude's response - delegates to ResponseProcessor */
  processResponse(result, supervisionResult) {
    return this.responseProcessor.process(result, supervisionResult);
  }
}

export default ExecutionEngine;
