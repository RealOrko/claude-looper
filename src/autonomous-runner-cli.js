/**
 * Autonomous Runner using Claude Code CLI
 * Uses your Max subscription - no API key required
 *
 * Enhanced with:
 * - Specialized client factories for different agent roles
 * - Adaptive iteration delays based on success/error
 * - Parallel initialization
 * - Model fallback support
 * - Step dependency analysis for parallel execution
 * - Intelligent context caching and token optimization
 * - Advanced stall detection and automatic recovery
 * - Comprehensive performance metrics
 */

import { ClaudeCodeClient } from './claude-code-client.js';
import { GoalTracker } from './goal-tracker.js';
import { Supervisor } from './supervisor.js';
import { PhaseManager } from './phase-manager.js';
import { Config } from './config.js';
import { CompletionVerifier } from './completion-verifier.js';
import { Planner } from './planner.js';
import { ContextManager } from './context-manager.js';
import { PerformanceMetrics, AdaptiveOptimizer } from './performance-metrics.js';
import { ErrorRecovery, RecoveryStrategy, ErrorCategory } from './error-recovery.js';
import { StatePersistence } from './state-persistence.js';

export class AutonomousRunnerCLI {
  constructor(options = {}) {
    this.config = new Config(options.config);

    // Get model configuration from config
    const modelConfig = this.config.get('models') || {};
    const retryConfig = this.config.get('retry') || {};

    // Use specialized worker client with fallback support
    this.client = ClaudeCodeClient.createWorkerClient({
      cwd: options.workingDirectory || process.cwd(),
      verbose: options.verbose || false,
      model: modelConfig.worker || 'opus',
      fallbackModel: modelConfig.workerFallback || 'sonnet',
      maxRetries: retryConfig.maxRetries || 3,
      retryBaseDelay: retryConfig.baseDelay || 1000,
    });

    this.goalTracker = null;
    this.supervisor = null;
    this.phaseManager = null;
    this.verifier = null;
    this.planner = null;
    this.contextManager = new ContextManager();
    this.metrics = new PerformanceMetrics();
    this.errorRecovery = new ErrorRecovery({
      baseDelay: retryConfig.baseDelay || 1000,
      maxDelay: retryConfig.maxDelay || 60000,
      maxRetries: retryConfig.maxRetries || 5,
      circuitBreakerThreshold: retryConfig.circuitBreakerThreshold || 5,
      circuitBreakerResetTime: retryConfig.circuitBreakerResetTime || 60000,
    });

    // State persistence for resumable sessions
    const persistenceConfig = this.config.get('persistence') || {};
    this.statePersistence = new StatePersistence({
      workingDirectory: options.workingDirectory || process.cwd(),
      persistenceDir: persistenceConfig.dir || '.claude-runner',
      autoSaveInterval: persistenceConfig.autoSaveInterval || 30000,
      maxCheckpoints: persistenceConfig.maxCheckpoints || 10,
      cacheMaxSize: persistenceConfig.cacheMaxSize || 100,
      cacheTTL: persistenceConfig.cacheTTL || 3600000,
    });
    this.enablePersistence = options.enablePersistence !== false;
    this.resumeSessionId = options.resumeSessionId || null;

    // Adaptive execution optimizer
    this.adaptiveOptimizer = new AdaptiveOptimizer();
    this.currentExecutionProfile = null;

    // Execution state
    this.iterationCount = 0;
    this.planCreated = false;
    this.lastProgressCheck = Date.now();
    this.isRunning = false;
    this.shouldStop = false;
    this.finalSummary = null;
    this.recentActions = [];

    // Verification state
    this.pendingCompletion = null;
    this.verificationFailures = 0;

    // Step verification state
    this.pendingStepCompletion = null;
    this.stepVerificationFailures = 0;

    // Sub-plan state
    this.pendingSubPlan = null;

    // Callbacks
    this.onProgress = options.onProgress || (() => {});
    this.onMessage = options.onMessage || (() => {});
    this.onError = options.onError || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onSupervision = options.onSupervision || (() => {});
    this.onEscalation = options.onEscalation || (() => {});
    this.onVerification = options.onVerification || (() => {});

    // Abort tracking
    this.abortReason = null;

    // Adaptive delay tracking
    this.lastIterationSuccess = true;
    this.consecutiveSuccesses = 0;
    this.consecutiveErrors = 0;

    // Wire up client events
    this.client.on('stdout', (chunk) => {
      if (this.config.get('verbose')) {
        process.stdout.write(chunk);
      }
    });
  }

  /**
   * Build the system context for Claude
   */
  buildSystemContext(primaryGoal, subGoals, workingDirectory) {
    // Get current step info if plan exists
    const currentStep = this.planner?.getCurrentStep();
    const planProgress = this.planner?.getProgress();

    let stepContext = '';
    if (currentStep && planProgress) {
      const completedSteps = this.planner.plan.steps
        .filter(s => s.status === 'completed')
        .map(s => `  ✓ ${s.number}. ${s.description}`)
        .join('\n');

      stepContext = `
## CURRENT STEP (${planProgress.current} of ${planProgress.total})
${currentStep.description}
Complexity: ${currentStep.complexity}

${completedSteps ? `## COMPLETED STEPS\n${completedSteps}\n` : ''}`;
    }

    return `# AUTONOMOUS EXECUTION MODE

You are running in AUTONOMOUS MODE. This means:
- You will work CONTINUOUSLY without waiting for user input
- After each action, IMMEDIATELY proceed to the next step
- You have a TIME LIMIT - work efficiently
- A supervisor is monitoring your progress

## PRIMARY GOAL
${primaryGoal}

${subGoals.length > 0 ? `## SUB-GOALS (Complete in order)
${subGoals.map((g, i) => `${i + 1}. ${g}`).join('\n')}` : ''}
${stepContext}
## WORKING DIRECTORY
${workingDirectory}

## RULES

1. **Work Autonomously**: Don't wait for input - determine and execute the next step
2. **Take Action**: Use tools. Don't just plan - execute.
3. **Report Progress**: State what you did and what you'll do next
4. **Signal Step Completion**: Say "STEP COMPLETE" when the current step is done
5. **Signal Blockers**: Say "STEP BLOCKED: [reason]" if you cannot proceed
6. **Signal Task Completion**: Say "TASK COMPLETE" when ALL steps are done
7. **Stay Focused**: Every action should advance the current step

Begin immediately.`;
  }

  /**
   * Initialize the runner
   */
  async initialize(options) {
    const {
      primaryGoal,
      subGoals = [],
      timeLimit = '2h',
      workingDirectory = process.cwd(),
      initialContext = '',
    } = options;

    // Get model configuration
    const modelConfig = this.config.get('models') || {};
    const retryConfig = this.config.get('retry') || {};

    // Initialize components
    this.goalTracker = new GoalTracker(primaryGoal, subGoals);

    // Use specialized supervisor client (fast, read-only, no persistence)
    this.supervisorClient = ClaudeCodeClient.createSupervisorClient({
      cwd: workingDirectory,
      verbose: false,
      model: modelConfig.supervisor || 'sonnet',
      fallbackModel: modelConfig.supervisorFallback || 'haiku',
    });
    this.supervisor = new Supervisor(this.supervisorClient, this.goalTracker, this.config);

    // Use specialized planner client (powerful, with persistence)
    this.plannerClient = ClaudeCodeClient.createPlannerClient({
      cwd: workingDirectory,
      verbose: false,
      model: modelConfig.planner || 'opus',
      fallbackModel: modelConfig.plannerFallback || 'sonnet',
      maxRetries: retryConfig.maxRetries || 3,
    });
    this.planner = new Planner(this.plannerClient);

    this.phaseManager = new PhaseManager(
      this.config.getTimeLimit(timeLimit),
      this.config
    );
    this.phaseManager.initializeFromGoals(this.goalTracker);
    this.verifier = new CompletionVerifier(this.client, this.goalTracker, this.config);

    // Update client working directory
    this.client.options.cwd = workingDirectory;

    // Store for later use
    this.primaryGoal = primaryGoal;
    this.subGoals = subGoals;
    this.workingDirectory = workingDirectory;
    this.initialContext = initialContext;

    this.onProgress({
      type: 'initialized',
      goal: primaryGoal,
      subGoals,
      timeLimit,
      plan: null, // Plan will be created at start of run()
    });

    return this;
  }

  /**
   * Extract actions from response for supervisor context
   */
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

  /**
   * Run a single iteration
   */
  async runIteration() {
    let prompt;
    let supervisionResult = null;

    // Check if this is the first iteration (no session yet)
    const isFirstIteration = !this.client.hasActiveSession();

    if (isFirstIteration) {
      // First iteration - start new session with full context
      const systemContext = this.buildSystemContext(
        this.primaryGoal,
        this.subGoals,
        this.workingDirectory
      );

      prompt = this.initialContext
        ? `Additional context: ${this.initialContext}\n\nStart working on the goal now.`
        : 'Start working on the goal now.';

      const result = await this.client.startSession(systemContext, prompt);
      return this.processResponse(result, null);
    }

    // Get last response for supervision
    const lastResponse = this.client.conversationHistory
      .filter(m => m.role === 'assistant')
      .pop();

    // Supervisor checks the last response
    // Skip supervision if configured and step is simple, or use cached result
    if (lastResponse) {
      const currentStep = this.planner?.getCurrentStep();
      const supervisionConfig = this.config.get('supervisor') || {};

      // Try to use cached assessment for similar responses
      const cachedAssessment = this.contextManager.getCachedAssessment(
        lastResponse.content,
        this.primaryGoal,
        this.supervisor.consecutiveIssues
      );

      if (cachedAssessment && !cachedAssessment.needsIntervention) {
        // Use cached assessment for speed
        supervisionResult = {
          assessment: cachedAssessment,
          needsIntervention: false,
          prompt: null,
          consecutiveIssues: this.supervisor.consecutiveIssues,
          escalated: false,
          cached: true,
        };
        this.metrics.recordSupervision(supervisionResult, 0);
      } else {
        // Full supervision check
        const supervisionStart = Date.now();
        supervisionResult = await this.supervisor.check(
          lastResponse.content,
          this.recentActions,
          { currentStep, complexity: currentStep?.complexity }
        );
        const supervisionDuration = Date.now() - supervisionStart;
        this.metrics.recordSupervision(supervisionResult, supervisionDuration);

        // Cache the result if it was a CONTINUE action
        if (supervisionResult.assessment?.action === 'CONTINUE') {
          this.contextManager.cacheAssessment(
            lastResponse.content,
            this.primaryGoal,
            this.supervisor.consecutiveIssues,
            supervisionResult.assessment
          );
        }
      }

      this.onSupervision({
        iteration: this.iterationCount,
        assessment: supervisionResult.assessment,
        needsIntervention: supervisionResult.needsIntervention,
        consecutiveIssues: supervisionResult.consecutiveIssues,
        escalated: supervisionResult.escalated,
      });

      // Handle escalation actions
      const action = supervisionResult.assessment?.action;

      if (action === 'CRITICAL') {
        this.onEscalation({
          type: 'critical',
          iteration: this.iterationCount,
          consecutiveIssues: supervisionResult.consecutiveIssues,
          score: supervisionResult.assessment.score,
          message: 'Final warning before session termination',
        });
        // Continue execution but warning has been emitted
      }

      if (action === 'ABORT') {
        this.onEscalation({
          type: 'abort',
          iteration: this.iterationCount,
          consecutiveIssues: supervisionResult.consecutiveIssues,
          score: supervisionResult.assessment.score,
          message: 'Session terminated due to persistent drift',
        });
        this.shouldStop = true;
        this.abortReason = 'Escalation: unable to maintain goal focus';
        // Still send the ABORT prompt for a final summary
      }
    }

    // Build the prompt for this iteration
    prompt = await this.buildIterationPrompt(supervisionResult);

    const result = await this.client.continueConversation(prompt);
    return this.processResponse(result, supervisionResult);
  }

  /**
   * Build the prompt for this iteration
   */
  async buildIterationPrompt(supervisionResult) {
    const prompts = [];

    // Add supervisor correction if needed
    if (supervisionResult?.needsIntervention && supervisionResult.prompt) {
      prompts.push(supervisionResult.prompt);
    }

    // Add time-based prompts
    const timePrompt = this.phaseManager.getTimePrompt();
    if (timePrompt) {
      prompts.push(timePrompt);
    }

    // Periodic progress check (every 5 minutes)
    if (this.phaseManager.isTimeForProgressCheck(this.lastProgressCheck)) {
      prompts.push(this.goalTracker.getProgressCheckPrompt());
      this.lastProgressCheck = Date.now();
    }

    // Goal reminder every 10 iterations
    if (this.iterationCount % 10 === 0) {
      prompts.push(this.goalTracker.getGoalContextPrompt());
    }

    // Add planner step context if available
    if (this.planner) {
      const currentStep = this.planner.getCurrentStep();
      const progress = this.planner.getProgress();

      if (currentStep) {
        const stepPrompt = `## CURRENT STEP (${progress.current}/${progress.total})
**${currentStep.description}**

Focus on completing this step. Say "STEP COMPLETE" when done.`;
        prompts.push(stepPrompt);
      }
    }

    // Default continuation prompt
    if (prompts.length === 0) {
      return 'Continue. What is your next action?';
    }

    return prompts.join('\n\n') + '\n\nContinue working.';
  }

  /**
   * Process Claude's response
   */
  processResponse(result, supervisionResult) {
    // Increment iteration count on successful response
    this.iterationCount++;

    const response = result.response || '';

    // Check for duplicate/looping responses
    const isDuplicate = this.contextManager.isDuplicateResponse(response);
    if (isDuplicate) {
      this.onProgress({
        type: 'duplicate_response_detected',
        iteration: this.iterationCount,
        message: 'Worker may be stuck in a loop',
      });
      // Force supervisor to escalate on next check
      this.supervisor.consecutiveIssues = Math.max(
        this.supervisor.consecutiveIssues,
        this.config.get('escalationThresholds')?.warn || 2
      );
    }

    // Extract and store recent actions
    const newActions = this.extractActions(response);
    this.recentActions = [...this.recentActions.slice(-5), ...newActions].slice(-10);

    // Update progress tracking
    const progressIndicators = this.goalTracker.updateProgress(response);

    // Check for step completion signals (planner-based)
    const stepCompleteMatch = response.match(/STEP\s+COMPLETE/i);
    const stepBlockedMatch = response.match(/STEP\s+BLOCKED[:\s]*(.+?)(?:\n|$)/i);

    if (stepCompleteMatch && this.planner && !this.pendingStepCompletion) {
      const claimedStep = this.planner.getCurrentStep();
      if (claimedStep) {
        // Don't advance yet - set pending for verification
        this.pendingStepCompletion = {
          step: claimedStep,
          response: response,
          iteration: this.iterationCount,
        };

        this.onProgress({
          type: 'step_verification_pending',
          step: claimedStep,
        });
      }
    }

    if (stepBlockedMatch && this.planner) {
      const reason = stepBlockedMatch[1]?.trim() || 'Unknown reason';
      const blockedStep = this.planner.getCurrentStep();

      // Check if we can attempt a sub-plan
      if (this.planner.canAttemptSubPlan() && !blockedStep?.isSubStep) {
        // Set pending sub-plan creation
        this.pendingSubPlan = {
          step: blockedStep,
          reason: reason,
          iteration: this.iterationCount,
        };

        this.onProgress({
          type: 'step_blocked_replanning',
          step: blockedStep,
          reason,
        });
      } else {
        // Already tried sub-plan or this IS a sub-step - fail and move on
        if (this.planner.isInSubPlan()) {
          // Sub-plan step failed - abort the whole sub-plan
          this.planner.abortSubPlan(reason);
          this.onProgress({
            type: 'subplan_failed',
            step: blockedStep,
            reason,
            progress: this.planner.getProgress(),
          });
        } else {
          // Main step failed after sub-plan attempt
          this.planner.failCurrentStep(reason);
          this.planner.advanceStep();
          this.onProgress({
            type: 'step_failed',
            step: blockedStep,
            reason,
            progress: this.planner.getProgress(),
          });
        }
      }
    }

    // Emit message event
    this.onMessage({
      iteration: this.iterationCount,
      content: response,
      sessionId: result.sessionId,
      supervision: supervisionResult?.assessment,
    });

    // Check for completion signals
    const lowerResponse = response.toLowerCase();
    const completionPhrases = [
      'task complete',
      'goal achieved',
      'all goals met',
      'successfully completed all',
      'finished all',
      'all sub-goals complete',
    ];

    const verifyConfig = this.config.get('verification') || {};
    const verificationEnabled = verifyConfig.enabled !== false;

    // Check if planner indicates all steps complete
    const plannerComplete = this.planner?.isComplete();

    if (plannerComplete || completionPhrases.some(phrase => lowerResponse.includes(phrase))) {
      if (verificationEnabled) {
        // Don't immediately accept - set pending for verification
        this.pendingCompletion = {
          claim: response,
          iteration: this.iterationCount,
          trigger: plannerComplete ? 'planner_complete' : 'completion_phrase',
        };
      } else {
        // Verification disabled - accept immediately
        this.shouldStop = true;
        this.finalSummary = {
          summary: response,
          detectedCompletion: true,
          verified: false,
        };
      }
    }

    // Check for explicit 100% progress
    if (progressIndicators.progressPercent === 100) {
      if (verificationEnabled && !this.pendingCompletion) {
        this.pendingCompletion = {
          claim: response,
          iteration: this.iterationCount,
          trigger: 'progress_100',
        };
      } else if (!verificationEnabled) {
        this.shouldStop = true;
      }
    }

    // Get planner progress if available
    const plannerProgress = this.planner?.getProgress();

    return {
      iteration: this.iterationCount,
      response,
      sessionId: result.sessionId,
      progress: this.goalTracker.getProgressSummary(),
      planProgress: plannerProgress,
      supervision: supervisionResult?.assessment,
      shouldStop: this.shouldStop,
    };
  }

  /**
   * Main execution loop
   */
  async run() {
    this.isRunning = true;
    this.shouldStop = false;
    this.phaseManager.start();
    this.metrics.startSession();

    // Initialize state persistence
    let resumedSession = null;
    if (this.enablePersistence) {
      await this.statePersistence.initialize();

      // Check for resumable session or start new one
      if (this.resumeSessionId) {
        resumedSession = await this.statePersistence.startSession(this.primaryGoal, {
          resumeSessionId: this.resumeSessionId,
        });
      } else {
        // Check if there's an existing session for this goal
        const existingSession = await this.statePersistence.getResumableSession(this.primaryGoal);
        if (existingSession) {
          this.onProgress({
            type: 'resumable_session_found',
            session: existingSession,
          });
          resumedSession = await this.statePersistence.startSession(this.primaryGoal, {
            resumeSessionId: existingSession.id,
          });
        } else {
          await this.statePersistence.startSession(this.primaryGoal);
        }
      }
    }

    this.onProgress({
      type: 'started',
      time: this.phaseManager.getTimeStatus(),
      resumed: !!resumedSession,
      sessionId: this.statePersistence.currentSession?.id,
    });

    try {
      // Check if we're resuming with an existing plan
      if (resumedSession?.plan) {
        this.onProgress({ type: 'resuming', message: 'Resuming from saved session...' });
        this.planner.restorePlan(resumedSession.plan, resumedSession.currentStep);
        this.planCreated = true;

        this.onProgress({
          type: 'plan_restored',
          plan: resumedSession.plan,
          currentStep: resumedSession.currentStep,
          completedSteps: resumedSession.completedSteps,
        });
      } else {
        // Create execution plan first
        this.onProgress({ type: 'planning', message: 'Creating execution plan...' });

        const planStart = Date.now();
        const plan = await this.planner.createPlan(
          this.primaryGoal,
          this.initialContext,
          this.workingDirectory
        );
        this.planCreated = true;
        this.metrics.recordPlanningTime(Date.now() - planStart, plan.totalSteps);

        // Save plan to persistence
        if (this.enablePersistence) {
          await this.statePersistence.setPlan(plan);
          await this.statePersistence.createCheckpoint('plan_created');
        }

        // Enable parallel execution if configured
        const parallelConfig = this.config.get('parallelExecution') || {};
        if (parallelConfig.enabled !== false) {
          this.planner.enableParallelMode();
        }

        this.onProgress({
          type: 'plan_created',
          plan: plan,
          summary: this.planner.getSummary(),
          executionStats: this.planner.getExecutionStats(),
        });

        // Review plan before execution
        this.onProgress({ type: 'plan_review_started', plan });
        const planReview = await this.supervisor.reviewPlan(plan, this.primaryGoal);

        this.onProgress({
          type: 'plan_review_complete',
          review: planReview,
        });

        if (!planReview.approved) {
          // Plan has issues - warn but continue (don't block execution)
          this.onProgress({
            type: 'plan_review_warning',
            issues: planReview.issues,
            missingSteps: planReview.missingSteps,
            suggestions: planReview.suggestions,
          });
        }
      }

      // Create adaptive execution profile based on goal
      this.currentExecutionProfile = this.adaptiveOptimizer.createExecutionProfile(
        this.primaryGoal,
        { complexity: this.planner.plan?.complexity || 'medium' }
      );

      this.onProgress({
        type: 'execution_profile_created',
        profile: this.currentExecutionProfile,
      });

      while (!this.shouldStop && !this.phaseManager.isTimeExpired() && !this.planner.isComplete()) {
        let iterationResult;
        let retries = 0;
        const maxRetries = this.config.get('maxRetries');

        // Check if current step should be decomposed (complex or taking too long)
        const stepToCheck = this.planner.getCurrentStep();
        if (stepToCheck && !stepToCheck.isSubtask && !stepToCheck.decomposedInto) {
          const stepElapsed = stepToCheck.startTime ? Date.now() - stepToCheck.startTime : 0;
          if (this.planner.shouldDecomposeStep(stepToCheck, stepElapsed)) {
            this.onProgress({
              type: 'step_decomposing',
              step: stepToCheck,
              reason: stepToCheck.complexity === 'complex' ? 'complex_step' : 'long_running',
            });

            const decomposition = await this.planner.decomposeComplexStep(
              stepToCheck,
              this.workingDirectory
            );

            if (decomposition && this.planner.injectSubtasks(decomposition)) {
              this.onProgress({
                type: 'step_decomposed',
                parentStep: stepToCheck,
                subtasks: decomposition.subtasks,
                parallelSafe: decomposition.parallelSafe,
              });
            }
          }
        }

        // Start iteration tracking
        this.metrics.startIteration();

        // Run iteration with smart error recovery
        const currentStep = this.planner.getCurrentStep();
        const operationId = `iteration_${this.iterationCount}_step_${currentStep?.number || 0}`;

        try {
          iterationResult = await this.errorRecovery.executeWithRetry(
            () => this.runIteration(),
            {
              operationId,
              maxRetries,
              onError: ({ error, errorEntry, recovery }) => {
                this.metrics.recordError('iteration_error', recovery.shouldRetry);
                this.onError({
                  type: 'iteration_error',
                  error: error.message,
                  category: recovery.category,
                  strategy: recovery.strategy,
                  retryCount: recovery.retryCount,
                  delay: recovery.delay,
                  willRetry: recovery.shouldRetry,
                });
              },
              onContextAction: async (action) => {
                // Handle context-related recovery actions
                if (action.action === 'reset') {
                  this.contextManager.reset();
                  this.onProgress({
                    type: 'context_reset',
                    reason: 'error_recovery',
                  });
                } else if (action.action === 'trim') {
                  this.contextManager.trimToRecent(action.keepRecent || 5);
                  this.onProgress({
                    type: 'context_trimmed',
                    reason: 'error_recovery',
                    keepRecent: action.keepRecent,
                  });
                }
              },
            }
          );
        } catch (recoveryError) {
          // Check if this is a recovery error with special handling
          if (recoveryError.strategy === RecoveryStrategy.SKIP_STEP && currentStep) {
            // Skip this step and continue
            this.onProgress({
              type: 'step_skipped',
              step: currentStep,
              reason: 'error_recovery',
              error: recoveryError.originalError?.message || recoveryError.message,
            });
            this.planner.skipStep(currentStep.number);
            this.metrics.recordStepExecution(currentStep.number, 'skipped', 0, {
              reason: 'error_recovery',
            });
            continue; // Skip to next iteration
          } else if (recoveryError.strategy === RecoveryStrategy.ESCALATE) {
            // Escalate to user
            this.onEscalation({
              type: 'error_escalation',
              error: recoveryError.originalError?.message || recoveryError.message,
              category: recoveryError.category,
              recovery: recoveryError.recovery,
              errorTrends: this.errorRecovery.getErrorTrends(),
            });
            // Allow continuation but log the issue
            iterationResult = {
              response: `Error escalated: ${recoveryError.message}`,
              escalated: true,
            };
          } else {
            // Re-throw for other strategies (ABORT, etc.)
            throw recoveryError.originalError || recoveryError;
          }
        }

        // End iteration tracking
        this.metrics.endIteration();

        // Check for adaptive strategy adjustments every 5 iterations
        if (this.iterationCount % 5 === 0 && this.currentExecutionProfile) {
          const currentMetrics = {
            recentErrorRate: this.errorRecovery.getErrorTrends().lastMinute / Math.max(1, 5),
            avgIterationTime: this.metrics.efficiency.avgStepTime,
            stuckIterations: this.getStuckIterationCount(),
            supervisionScore: this.getAverageSupervisionScore(),
          };

          const adjustments = this.adaptiveOptimizer.adjustStrategy(currentMetrics);
          if (adjustments && adjustments.length > 0) {
            this.onProgress({
              type: 'strategy_adjusted',
              adjustments,
              newProfile: this.currentExecutionProfile,
            });
          }
        }

        // Emit progress
        this.onProgress({
          type: 'iteration_complete',
          ...iterationResult,
          time: this.phaseManager.getTimeStatus(),
        });

        // Handle pending step verification
        if (this.pendingStepCompletion) {
          this.onProgress({
            type: 'step_verification_started',
            step: this.pendingStepCompletion.step,
          });

          const stepVerification = await this.supervisor.verifyStepCompletion(
            this.pendingStepCompletion.step,
            this.pendingStepCompletion.response
          );

          if (stepVerification.verified) {
            // Step verified - advance
            const completedStep = this.pendingStepCompletion.step;
            const stepDuration = completedStep.startTime
              ? Date.now() - completedStep.startTime
              : 0;

            this.planner.advanceStep();
            this.pendingStepCompletion = null;
            this.stepVerificationFailures = 0;

            // Record step metrics
            this.metrics.recordStepExecution(
              completedStep.number,
              'completed',
              stepDuration,
              { complexity: completedStep.complexity }
            );

            this.onProgress({
              type: 'step_complete',
              step: completedStep,
              progress: this.planner.getProgress(),
              verification: stepVerification,
              duration: stepDuration,
            });

            // Persist step completion
            if (this.enablePersistence) {
              await this.statePersistence.updateStepProgress(
                completedStep.number,
                'completed',
                { duration: stepDuration }
              );
              // Create checkpoint every 3 completed steps
              if (this.planner.getProgress().completed % 3 === 0) {
                await this.statePersistence.createCheckpoint(`step_${completedStep.number}_complete`);
              }
            }

            // Record task performance for adaptive learning
            const taskType = this.adaptiveOptimizer.classifyTask(completedStep.description);
            this.adaptiveOptimizer.recordTaskPerformance(taskType, {
              duration: stepDuration,
              success: true,
              iterations: 1, // TODO: track actual iterations per step
            });

            // Record strategy effectiveness
            if (this.currentExecutionProfile) {
              this.adaptiveOptimizer.recordStrategyEffectiveness(
                this.currentExecutionProfile.primaryStrategy,
                true,
                { duration: stepDuration }
              );
            }
          } else {
            // Step not verified - reject claim
            this.stepVerificationFailures++;
            const rejectedStep = this.pendingStepCompletion.step;
            this.pendingStepCompletion = null;

            this.onProgress({
              type: 'step_rejected',
              step: rejectedStep,
              reason: stepVerification.reason,
              failures: this.stepVerificationFailures,
            });

            // Tell Claude the step wasn't actually complete
            await this.client.continueConversation(
              `## Step Not Complete

Your claim that Step ${rejectedStep.number} ("${rejectedStep.description}") is complete was not verified.

Reason: ${stepVerification.reason}

Please continue working on this step and say "STEP COMPLETE" only when it is truly finished.`
            );
          }
        }

        // Handle pending sub-plan creation
        if (this.pendingSubPlan) {
          this.onProgress({
            type: 'subplan_creating',
            step: this.pendingSubPlan.step,
            reason: this.pendingSubPlan.reason,
          });

          const subPlan = await this.planner.createSubPlan(
            this.pendingSubPlan.step,
            this.pendingSubPlan.reason,
            this.workingDirectory
          );

          if (subPlan) {
            this.onProgress({
              type: 'subplan_created',
              parentStep: this.pendingSubPlan.step,
              subPlan: subPlan,
            });

            // Tell Claude about the new sub-plan
            const subPlanPrompt = `## Alternative Approach Required

The previous step was blocked: "${this.pendingSubPlan.reason}"

I've created an alternative approach with ${subPlan.totalSteps} sub-steps:
${subPlan.steps.map(s => `${s.number}. ${s.description}`).join('\n')}

Let's start with sub-step 1: ${subPlan.steps[0]?.description}

Begin working on this sub-step now.`;

            await this.client.continueConversation(subPlanPrompt);
          } else {
            // Sub-plan creation failed - mark step as failed and move on
            this.planner.failCurrentStep(this.pendingSubPlan.reason);
            this.planner.advanceStep();

            this.onProgress({
              type: 'step_failed',
              step: this.pendingSubPlan.step,
              reason: 'Sub-plan creation failed',
              progress: this.planner.getProgress(),
            });
          }

          this.pendingSubPlan = null;
        }

        // Handle pending completion verification
        if (this.pendingCompletion) {
          const verifyConfig = this.config.get('verification') || {};

          this.onProgress({
            type: 'verification_started',
            claim: this.pendingCompletion,
          });

          const verification = await this.verifier.verify(
            this.pendingCompletion.claim,
            this.workingDirectory
          );

          this.onVerification({
            iteration: this.iterationCount,
            claim: this.pendingCompletion,
            ...verification,
          });

          if (verification.passed) {
            // Verification passed - accept completion
            this.shouldStop = true;
            this.finalSummary = {
              summary: this.pendingCompletion.claim,
              detectedCompletion: true,
              verified: true,
              verificationLayers: verification.layers,
            };
            this.pendingCompletion = null;
          } else {
            // Verification failed - reject and continue
            this.verificationFailures++;
            this.pendingCompletion = null;

            const maxAttempts = verifyConfig.maxAttempts || 3;
            if (this.verificationFailures >= maxAttempts) {
              // Max false claims reached - escalate
              this.onEscalation({
                type: 'verification_limit',
                iteration: this.iterationCount,
                failures: this.verificationFailures,
                message: `Max false completion claims (${maxAttempts}) reached`,
              });
            }

            // Inject rejection prompt and continue working
            const rejectionPrompt = this.verifier.generateRejectionPrompt(verification);
            await this.client.continueConversation(rejectionPrompt);
          }
        }

        // Check if goals are complete
        if (this.goalTracker.isComplete()) {
          this.shouldStop = true;
        }

        // Adaptive delay between iterations
        // Success = no intervention needed (use supervision from iteration result)
        const iterationSuccess = !iterationResult?.supervision ||
          iterationResult.supervision.action === 'CONTINUE';
        const delay = this.getAdaptiveDelay(iterationSuccess);
        await this.sleep(delay);
      }

      // Handle time expiration
      if (this.phaseManager.isTimeExpired() && !this.shouldStop) {
        try {
          await this.client.continueConversation(
            'TIME EXPIRED. Summarize what was accomplished and list incomplete tasks.'
          );
        } catch (e) {
          // Ignore errors on final summary
        }
      }

      // Final verification: Goal verification + Smoke tests (if plan completed)
      let finalVerification = null;
      if (this.planner?.isComplete() && !this.abortReason) {
        this.onProgress({ type: 'final_verification_started' });

        // 1. Verify the original goal was achieved (not just steps)
        const goalVerification = await this.supervisor.verifyGoalAchieved(
          this.primaryGoal,
          this.planner.plan.steps,
          this.workingDirectory
        );

        this.onProgress({
          type: 'goal_verification_complete',
          result: goalVerification,
        });

        // 2. Run smoke tests
        const smokeTests = await this.verifier.runSmokeTests(
          this.primaryGoal,
          this.workingDirectory
        );

        this.onProgress({
          type: 'smoke_tests_complete',
          result: smokeTests,
        });

        finalVerification = {
          goalVerification,
          smokeTests,
          overallPassed: goalVerification.achieved && smokeTests.passed,
        };

        // Update final summary with verification results
        if (this.finalSummary) {
          this.finalSummary.goalVerification = goalVerification;
          this.finalSummary.smokeTests = smokeTests;
          this.finalSummary.fullyVerified = finalVerification.overallPassed;
        }

        // If verification failed, update status
        if (!finalVerification.overallPassed) {
          this.onProgress({
            type: 'final_verification_failed',
            goalVerification,
            smokeTests,
            reason: goalVerification.achieved
              ? `Smoke tests failed: ${smokeTests.summary}`
              : `Goal not achieved: ${goalVerification.reason}`,
          });
        } else {
          this.onProgress({
            type: 'final_verification_passed',
            goalVerification,
            smokeTests,
          });
        }
      }

      // End metrics session
      this.metrics.endSession();

      // Generate final report
      const finalReport = this.generateFinalReport(finalVerification);

      // Complete session persistence
      if (this.enablePersistence) {
        await this.statePersistence.completeSession({
          verified: finalVerification?.overallPassed,
          completedSteps: this.planner.getProgress().completed,
          totalSteps: this.planner.getProgress().total,
        });
      }

      this.onComplete(finalReport);
      return finalReport;

    } catch (error) {
      this.metrics.recordError('fatal_error', false);
      this.metrics.endSession();

      // Mark session as failed
      if (this.enablePersistence) {
        await this.statePersistence.failSession(error);
      }

      this.onError({
        type: 'fatal_error',
        error: error.message,
        stack: error.stack,
      });
      throw error;
    } finally {
      this.isRunning = false;
      this.phaseManager.stop();
    }
  }

  /**
   * Get count of iterations stuck on the same step
   */
  getStuckIterationCount() {
    const currentStep = this.planner?.getCurrentStep();
    if (!currentStep) return 0;

    // Count recent iterations on this step
    const recentIterations = this.metrics.timings.iterations.slice(-10);
    return recentIterations.length;
  }

  /**
   * Get average supervision score from recent checks
   */
  getAverageSupervisionScore() {
    const scores = this.metrics.supervision.scoreHistory;
    if (scores.length === 0) return 75; // Default

    const recentScores = scores.slice(-5);
    return recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
  }

  /**
   * Generate the final execution report
   */
  generateFinalReport(finalVerification = null) {
    const timeStatus = this.phaseManager.getTimeStatus();
    const progressSummary = this.goalTracker.getProgressSummary();
    const supervisorStats = this.supervisor.getStats();
    const phaseReport = this.phaseManager.getStatusReport();
    const planProgress = this.planner?.getProgress();

    // Determine final status - use planner completion if available
    let status;
    if (this.abortReason) {
      status = 'aborted';
    } else if (this.planner?.isComplete()) {
      // Check if final verification passed
      if (finalVerification && !finalVerification.overallPassed) {
        status = 'verification_failed';
      } else {
        status = 'completed';
      }
    } else if (this.goalTracker.isComplete()) {
      status = 'completed';
    } else if (timeStatus.isExpired) {
      status = 'time_expired';
    } else {
      status = 'stopped';
    }

    return {
      status,
      abortReason: this.abortReason,
      summary: this.finalSummary,
      goal: {
        primary: this.goalTracker.primaryGoal,
        subGoals: this.goalTracker.subGoals,
        progress: planProgress?.percentComplete || progressSummary.overallProgress,
        milestones: this.goalTracker.completedMilestones,
      },
      plan: this.planner?.plan ? {
        analysis: this.planner.plan.analysis,
        steps: this.planner.plan.steps,
        totalSteps: this.planner.plan.totalSteps,
        completed: planProgress?.completed || 0,
        failed: planProgress?.failed || 0,
      } : null,
      time: {
        elapsed: timeStatus.elapsed,
        limit: this.phaseManager.formatDuration(this.phaseManager.timeLimit),
        percentUsed: timeStatus.percentTimeUsed,
      },
      session: {
        id: this.client.getSessionId(),
        iterations: this.iterationCount,
        messageCount: this.client.getHistory().length,
      },
      supervision: supervisorStats,
      verification: {
        enabled: (this.config.get('verification') || {}).enabled !== false,
        failures: this.verificationFailures,
        stats: this.verifier?.getStats() || null,
        finalStatus: this.finalSummary?.verified ? 'verified' : 'unverified',
      },
      finalVerification: finalVerification ? {
        goalAchieved: finalVerification.goalVerification?.achieved,
        confidence: finalVerification.goalVerification?.confidence,
        functional: finalVerification.goalVerification?.functional,
        recommendation: finalVerification.goalVerification?.recommendation,
        gaps: finalVerification.goalVerification?.gaps,
        smokeTestsPassed: finalVerification.smokeTests?.passed,
        smokeTestsSummary: finalVerification.smokeTests?.summary,
        smokeTestsRun: finalVerification.smokeTests?.tests?.length || 0,
        overallPassed: finalVerification.overallPassed,
      } : null,
      phases: phaseReport.phases,
      checkpoints: phaseReport.checkpoints,
      cacheStats: this.contextManager.getCacheStats(),
      tokenStats: this.contextManager.getTokenStats(),
      clientMetrics: this.getClientMetrics(),
      performanceMetrics: this.metrics.getSummary(),
      performanceTrends: this.metrics.getTrends(),
    };
  }

  /**
   * Stop the runner gracefully
   */
  stop() {
    this.shouldStop = true;
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate adaptive delay based on recent iteration outcomes
   * Speeds up when things are going well, slows down on errors
   */
  getAdaptiveDelay(success = true) {
    const delayConfig = this.config.get('iterationDelay') || {};

    // If adaptive delays disabled, use default
    if (delayConfig.adaptive === false) {
      return delayConfig.default || 2000;
    }

    const minimum = delayConfig.minimum || 500;
    const afterSuccess = delayConfig.afterSuccess || 1000;
    const afterError = delayConfig.afterError || 3000;

    if (success) {
      this.consecutiveSuccesses++;
      this.consecutiveErrors = 0;

      // Speed up after consecutive successes (down to minimum)
      // Each success reduces delay by 100ms, down to minimum
      const reduction = Math.min(this.consecutiveSuccesses - 1, 5) * 100;
      return Math.max(minimum, afterSuccess - reduction);
    } else {
      this.consecutiveErrors++;
      this.consecutiveSuccesses = 0;

      // Slow down after errors (exponential backoff)
      // Each error increases delay by 500ms
      const increase = Math.min(this.consecutiveErrors - 1, 5) * 500;
      return afterError + increase;
    }
  }

  /**
   * Get client metrics for monitoring
   */
  getClientMetrics() {
    return {
      worker: this.client.getMetrics(),
      supervisor: this.supervisorClient?.getMetrics() || null,
      planner: this.plannerClient?.getMetrics() || null,
    };
  }
}

export default AutonomousRunnerCLI;
