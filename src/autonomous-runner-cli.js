/**
 * Autonomous Runner using Claude Code CLI
 * Uses your Max subscription - no API key required
 */

import { ClaudeCodeClient } from './claude-code-client.js';
import { GoalTracker } from './goal-tracker.js';
import { Supervisor } from './supervisor.js';
import { PhaseManager } from './phase-manager.js';
import { Config } from './config.js';
import { CompletionVerifier } from './completion-verifier.js';
import { Planner } from './planner.js';

export class AutonomousRunnerCLI {
  constructor(options = {}) {
    this.config = new Config(options.config);

    this.client = new ClaudeCodeClient({
      cwd: options.workingDirectory || process.cwd(),
      skipPermissions: true,
      verbose: options.verbose || false,
      model: 'opus', // Use Opus for worker
    });

    this.goalTracker = null;
    this.supervisor = null;
    this.phaseManager = null;
    this.verifier = null;
    this.planner = null;

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

    // Initialize components
    this.goalTracker = new GoalTracker(primaryGoal, subGoals);

    // Create separate client for supervisor to avoid session ID conflicts
    this.supervisorClient = new ClaudeCodeClient({
      cwd: workingDirectory,
      skipPermissions: true,
      verbose: false,
    });
    this.supervisor = new Supervisor(this.supervisorClient, this.goalTracker, this.config);

    // Create separate client for planner
    this.plannerClient = new ClaudeCodeClient({
      cwd: workingDirectory,
      skipPermissions: true,
      verbose: false,
      model: 'sonnet', // Use Sonnet for planning (fast but capable)
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
    if (lastResponse) {
      supervisionResult = await this.supervisor.check(
        lastResponse.content,
        this.recentActions
      );

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

    this.onProgress({
      type: 'started',
      time: this.phaseManager.getTimeStatus(),
    });

    try {
      // Create execution plan first
      this.onProgress({ type: 'planning', message: 'Creating execution plan...' });

      const plan = await this.planner.createPlan(
        this.primaryGoal,
        this.initialContext,
        this.workingDirectory
      );
      this.planCreated = true;

      this.onProgress({
        type: 'plan_created',
        plan: plan,
        summary: this.planner.getSummary(),
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

      while (!this.shouldStop && !this.phaseManager.isTimeExpired() && !this.planner.isComplete()) {
        let iterationResult;
        let retries = 0;
        const maxRetries = this.config.get('maxRetries');

        // Run iteration with retry logic
        while (retries < maxRetries) {
          try {
            iterationResult = await this.runIteration();
            break;
          } catch (error) {
            retries++;
            this.onError({
              type: 'iteration_error',
              error: error.message,
              retry: retries,
            });

            if (retries >= maxRetries) {
              throw error;
            }

            await this.sleep(this.config.get('retryDelay'));
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
            this.planner.advanceStep();
            this.pendingStepCompletion = null;
            this.stepVerificationFailures = 0;

            this.onProgress({
              type: 'step_complete',
              step: completedStep,
              progress: this.planner.getProgress(),
              verification: stepVerification,
            });
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

        // Brief pause between iterations
        await this.sleep(2000);
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

      // Generate final report
      const finalReport = this.generateFinalReport(finalVerification);
      this.onComplete(finalReport);
      return finalReport;

    } catch (error) {
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
}

export default AutonomousRunnerCLI;
