/**
 * Response Processor - handles processing of Claude's responses, signal detection, and action extraction
 */
export class ResponseProcessor {
  constructor(runner) {
    this.runner = runner;
  }

  /** Process Claude's response */
  process(result, supervisionResult) {
    const r = this.runner;

    // Increment iteration count on successful response
    r.iterationCount++;

    const response = result.response || '';

    // Check for duplicate/looping responses
    this.handleDuplicateResponses(response);

    // Extract and store recent actions
    const newActions = this.extractActions(response);
    r.recentActions = [...r.recentActions.slice(-5), ...newActions].slice(-10);

    // Update progress tracking
    const progressIndicators = r.goalTracker.updateProgress(response);

    // Check for step signals
    this.handleStepSignals(response);

    // Emit message event
    r.onMessage({
      iteration: r.iterationCount,
      content: response,
      sessionId: result.sessionId,
      supervision: supervisionResult?.assessment,
    });

    // Check for completion signals
    this.handleCompletionSignals(response, progressIndicators);

    // Compress history if needed
    this.compressHistoryIfNeeded();

    // Get planner progress if available
    const plannerProgress = r.planner?.getProgress();

    return {
      iteration: r.iterationCount,
      response,
      sessionId: result.sessionId,
      progress: r.goalTracker.getProgressSummary(),
      planProgress: plannerProgress,
      supervision: supervisionResult?.assessment,
      shouldStop: r.shouldStop,
    };
  }

  /** Handle duplicate/looping responses */
  handleDuplicateResponses(response) {
    const r = this.runner;
    const isDuplicate = r.contextManager.isDuplicateResponse(response);
    if (isDuplicate) {
      r.onProgress({
        type: 'duplicate_response_detected',
        iteration: r.iterationCount,
        message: 'Worker may be stuck in a loop',
      });
      r.supervisor.consecutiveIssues = Math.max(
        r.supervisor.consecutiveIssues,
        r.config.get('escalationThresholds')?.warn || 2
      );
    }
  }

  /** Extract actions from response for supervisor context */
  extractActions(response) {
    const content = response || '';
    const actionPatterns = [
      /(?:I )?(?:created?|wrote|edited?|ran|executed?|implemented?|added?|fixed?|updated?|deleted?|removed?|installed?|configured?)[^.!?\n]*/gi,
      /(?:running|reading|searching|found|checking)[^.!?\n]*/gi,
    ];

    const actions = [];
    for (const pattern of actionPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        actions.push(...matches.map(m => m.trim()).slice(0, 2));
      }
    }

    return actions;
  }

  /** Handle step completion/blocked signals */
  handleStepSignals(response) {
    const r = this.runner;
    const stepCompleteMatch = response.match(/STEP\s+COMPLETE/i);
    const stepBlockedMatch = response.match(/STEP\s+BLOCKED[:\s]*(.+?)(?:\n|$)/i);

    if (stepCompleteMatch && r.planner && !r.pendingStepCompletion) {
      const claimedStep = r.planner.getCurrentStep();
      if (claimedStep) {
        r.pendingStepCompletion = {
          step: claimedStep,
          response: response,
          iteration: r.iterationCount,
        };

        r.onProgress({
          type: 'step_verification_pending',
          step: claimedStep,
        });
      }
    }

    if (stepBlockedMatch && r.planner) {
      const reason = stepBlockedMatch[1]?.trim() || 'Unknown reason';
      const blockedStep = r.planner.getCurrentStep();

      if (r.planner.canAttemptSubPlan() && !blockedStep?.isSubStep) {
        r.pendingSubPlan = {
          step: blockedStep,
          reason: reason,
          iteration: r.iterationCount,
        };

        r.onProgress({
          type: 'step_blocked_replanning',
          step: blockedStep,
          reason,
        });
      } else {
        this.handleBlockedStep(blockedStep, reason);
      }
    }
  }

  /** Handle a blocked step */
  handleBlockedStep(blockedStep, reason) {
    const r = this.runner;
    if (r.planner.isInSubPlan()) {
      r.planner.abortSubPlan(reason);
      r.contextManager.recordDecision(
        `Aborted sub-plan for step ${blockedStep.number}`,
        reason
      );

      r.onProgress({
        type: 'subplan_failed',
        step: blockedStep,
        reason,
        progress: r.planner.getProgress(),
      });
    } else {
      r.planner.failCurrentStep(reason);
      r.planner.advanceStep();
      r.contextManager.recordDecision(
        `Skipped failed step ${blockedStep.number}`,
        reason
      );

      r.onProgress({
        type: 'step_failed',
        step: blockedStep,
        reason,
        progress: r.planner.getProgress(),
      });
    }
  }

  /** Handle completion signals */
  handleCompletionSignals(response, progressIndicators) {
    const r = this.runner;
    const lowerResponse = response.toLowerCase();
    const completionPhrases = [
      'task complete',
      'goal achieved',
      'all goals met',
      'successfully completed all',
      'finished all',
      'all sub-goals complete',
    ];

    const verifyConfig = r.config.get('verification') || {};
    const verificationEnabled = verifyConfig.enabled !== false;
    const plannerComplete = r.planner?.isComplete();

    if (plannerComplete || completionPhrases.some(phrase => lowerResponse.includes(phrase))) {
      if (verificationEnabled) {
        r.pendingCompletion = {
          claim: response,
          iteration: r.iterationCount,
          trigger: plannerComplete ? 'planner_complete' : 'completion_phrase',
        };
      } else {
        r.shouldStop = true;
        r.finalSummary = {
          summary: response,
          detectedCompletion: true,
          verified: false,
        };
      }
    }

    if (progressIndicators.progressPercent === 100) {
      if (verificationEnabled && !r.pendingCompletion) {
        r.pendingCompletion = {
          claim: response,
          iteration: r.iterationCount,
          trigger: 'progress_100',
        };
      } else if (!verificationEnabled) {
        r.shouldStop = true;
      }
    }
  }

  /** Compress conversation history if it exceeds threshold */
  compressHistoryIfNeeded() {
    const r = this.runner;
    const historyLength = r.client.conversationHistory.length;
    const summaryThreshold = r.contextManager.options.summaryThreshold;

    if (historyLength > summaryThreshold) {
      const compressedHistory = r.contextManager.compressHistory(
        r.client.conversationHistory,
        Math.min(10, Math.floor(summaryThreshold / 3))
      );

      r.client.conversationHistory = compressedHistory;

      const originalTokens = r.contextManager.estimateTokens(
        r.client.conversationHistory.map(m => m.content).join('')
      );
      const compressedTokens = r.contextManager.estimateTokens(
        compressedHistory.map(m => m.content).join('')
      );

      r.onProgress({
        type: 'history_compressed',
        originalLength: historyLength,
        compressedLength: compressedHistory.length,
        tokensSaved: originalTokens - compressedTokens,
      });
    }
  }
}

export default ResponseProcessor;
