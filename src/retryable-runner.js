/**
 * Retryable Autonomous Runner
 * Wraps AutonomousRunnerCLI in an outer retry loop that continues
 * until HIGH confidence success or timeout expires.
 */

import { AutonomousRunnerCLI } from './autonomous-runner-cli.js';
import { Config } from './config.js';

export class RetryableAutonomousRunner {
  constructor(options = {}) {
    this.config = new Config(options.config);

    // Retry configuration
    this.maxAttempts = options.maxAttempts || 100;
    this.overallTimeLimit = this.config.getTimeLimit(options.timeLimit || '4h');

    // Working directory and verbosity
    this.workingDirectory = options.workingDirectory || process.cwd();
    this.verbose = options.verbose || false;

    // State
    this.attemptHistory = [];
    this.startTime = null;
    this.isRunning = false;
    this.shouldStop = false;
    this.currentRunner = null;

    // Callbacks (forwarded from options)
    this.onProgress = options.onProgress || (() => {});
    this.onMessage = options.onMessage || (() => {});
    this.onError = options.onError || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onSupervision = options.onSupervision || (() => {});
    this.onEscalation = options.onEscalation || (() => {});
    this.onVerification = options.onVerification || (() => {});

    // Store original goal/subGoals for retry
    this.primaryGoal = null;
    this.subGoals = [];
    this.initialContext = '';
  }

  /**
   * Initialize with goal and options (same signature as AutonomousRunnerCLI)
   */
  async initialize(options) {
    this.primaryGoal = options.primaryGoal;
    this.subGoals = options.subGoals || [];
    this.initialContext = options.initialContext || '';

    // Override time limit if provided in initialize
    if (options.timeLimit) {
      this.overallTimeLimit = this.config.getTimeLimit(options.timeLimit);
    }

    // Override working directory if provided
    if (options.workingDirectory) {
      this.workingDirectory = options.workingDirectory;
    }

    return this;
  }

  /**
   * Main retry loop - runs until HIGH confidence success or timeout
   */
  async run() {
    this.isRunning = true;
    this.shouldStop = false;
    this.startTime = Date.now();
    this.attemptHistory = [];

    this.onProgress({
      type: 'retry_loop_started',
      maxAttempts: this.maxAttempts,
      overallTimeLimit: this.overallTimeLimit,
      goal: this.primaryGoal,
    });

    let lastReport = null;

    for (let attempt = 1; attempt <= this.maxAttempts && !this.shouldStop; attempt++) {
      // Check time budget
      const attemptTimeLimit = this.calculateAttemptTimeLimit(attempt);
      if (attemptTimeLimit <= 0) {
        this.onProgress({
          type: 'time_exhausted',
          attemptNumber: attempt - 1,
          totalAttempts: this.attemptHistory.length,
        });
        break;
      }

      // Build context from previous failures
      const failureContext = this.buildFailureContext();

      this.onProgress({
        type: 'attempt_starting',
        attemptNumber: attempt,
        maxAttempts: this.maxAttempts,
        timeRemaining: this.overallTimeLimit - (Date.now() - this.startTime),
        timeLimitForAttempt: attemptTimeLimit,
        hasFailureContext: !!failureContext && failureContext !== this.initialContext,
      });

      // Create fresh runner for this attempt
      this.currentRunner = new AutonomousRunnerCLI({
        workingDirectory: this.workingDirectory,
        verbose: this.verbose,
        config: this.config.settings,
        onProgress: (data) => this.onProgress({ ...data, attemptNumber: attempt }),
        onMessage: (data) => this.onMessage({ ...data, attemptNumber: attempt }),
        onError: (data) => this.onError({ ...data, attemptNumber: attempt }),
        onComplete: () => {}, // Handle in outer loop
        onSupervision: (data) => this.onSupervision({ ...data, attemptNumber: attempt }),
        onEscalation: (data) => this.onEscalation({ ...data, attemptNumber: attempt }),
        onVerification: (data) => this.onVerification({ ...data, attemptNumber: attempt }),
      });

      // Convert ms back to time string for the inner runner
      const attemptTimeLimitStr = this.msToTimeString(attemptTimeLimit);

      await this.currentRunner.initialize({
        primaryGoal: this.primaryGoal,
        subGoals: this.subGoals,
        timeLimit: attemptTimeLimitStr,
        workingDirectory: this.workingDirectory,
        initialContext: failureContext || this.initialContext,
      });

      const attemptStart = Date.now();
      try {
        lastReport = await this.currentRunner.run();
      } catch (error) {
        lastReport = this.createErrorReport(error, attempt);
        this.onError({
          type: 'attempt_error',
          attemptNumber: attempt,
          error: error.message,
        });
      }
      const attemptDuration = Date.now() - attemptStart;

      // Extract attempt info
      const confidence = lastReport?.finalVerification?.goalVerification?.confidence || 'UNKNOWN';
      const completedSteps = lastReport?.plan?.steps?.filter(s => s.status === 'completed') || [];
      const failedSteps = lastReport?.plan?.steps?.filter(s => s.status === 'failed' || s.status === 'blocked') || [];
      const gaps = lastReport?.finalVerification?.goalVerification?.gaps;

      // Record attempt
      this.attemptHistory.push({
        attemptNumber: attempt,
        startTime: attemptStart,
        endTime: Date.now(),
        duration: attemptDuration,
        report: lastReport,
        status: lastReport?.status,
        confidence,
        completedSteps,
        failedSteps,
        gaps,
        recommendation: lastReport?.finalVerification?.goalVerification?.recommendation,
      });

      const willRetry = this.shouldRetry(lastReport) && attempt < this.maxAttempts;

      this.onProgress({
        type: 'attempt_completed',
        attemptNumber: attempt,
        status: lastReport?.status,
        confidence,
        passed: lastReport?.finalVerification?.overallPassed,
        completedSteps: completedSteps.length,
        failedSteps: failedSteps.length,
        willRetry,
        duration: attemptDuration,
      });

      // Check if we should stop retrying
      if (!this.shouldRetry(lastReport)) {
        break;
      }
    }

    this.isRunning = false;
    this.currentRunner = null;

    // Build final combined report
    const finalReport = this.buildFinalReport(lastReport);

    this.onProgress({
      type: 'retry_loop_completed',
      totalAttempts: this.attemptHistory.length,
      finalStatus: finalReport.status,
      finalConfidence: finalReport.finalVerification?.goalVerification?.confidence,
      overallSuccess: finalReport.finalVerification?.overallPassed,
      totalDuration: Date.now() - this.startTime,
    });

    this.onComplete(finalReport);
    return finalReport;
  }

  /**
   * Build context from previous failed attempts
   */
  buildFailureContext() {
    if (this.attemptHistory.length === 0) {
      return this.initialContext;
    }

    const sections = [];

    // Include original context if present
    if (this.initialContext) {
      sections.push(this.initialContext);
      sections.push('');
    }

    sections.push('## Previous Attempt Summary');
    sections.push('');

    for (const attempt of this.attemptHistory) {
      sections.push(`### Attempt ${attempt.attemptNumber}`);
      sections.push(`Status: ${attempt.status || 'unknown'}`);
      sections.push(`Confidence: ${attempt.confidence}`);

      if (attempt.completedSteps.length > 0) {
        const stepDescs = attempt.completedSteps
          .map(s => s.description || `Step ${s.number}`)
          .slice(0, 5); // Limit to avoid context bloat
        sections.push(`Completed (${attempt.completedSteps.length}): ${stepDescs.join(', ')}${attempt.completedSteps.length > 5 ? '...' : ''}`);
      }

      if (attempt.failedSteps.length > 0) {
        const failedDescs = attempt.failedSteps
          .map(s => `${s.description || `Step ${s.number}`}${s.failReason ? ` (${s.failReason})` : ''}`)
          .slice(0, 3);
        sections.push(`Failed/Blocked: ${failedDescs.join(', ')}${attempt.failedSteps.length > 3 ? '...' : ''}`);
      }

      if (attempt.gaps) {
        sections.push(`Gaps identified: ${attempt.gaps}`);
      }

      if (attempt.recommendation) {
        sections.push(`Recommendation: ${attempt.recommendation}`);
      }

      sections.push('');
    }

    sections.push('## Your Task');
    sections.push('Build on what was accomplished in previous attempts. Focus on:');
    sections.push('1. Fixing any failures or blocked steps');
    sections.push('2. Closing identified gaps');
    sections.push('3. Achieving HIGH confidence verification');
    sections.push('');

    return sections.join('\n');
  }

  /**
   * Determine if another retry attempt should be made
   */
  shouldRetry(report) {
    if (!report) {
      // No report means error occurred - might be worth retrying
      return this.hasTimeRemaining();
    }

    // Only stop if HIGH confidence AND goal was actually achieved
    const fv = report.finalVerification;
    if (fv?.confidence === 'HIGH' && fv?.goalAchieved) {
      return false;
    }

    // Never retry on abort (supervisor escalation)
    if (report.status === 'aborted') {
      return false;
    }

    // If overall verification passed (even with MEDIUM confidence), don't retry
    if (report.finalVerification?.overallPassed) {
      return false;
    }

    // Retry on other statuses if time remains
    return this.hasTimeRemaining();
  }

  /**
   * Calculate time budget for this attempt
   * Uses progressive allocation: 50%, 30%, 50% of remaining
   */
  calculateAttemptTimeLimit(attemptNumber) {
    const elapsed = Date.now() - this.startTime;
    const remaining = this.overallTimeLimit - elapsed;

    // Minimum 5 minutes for an attempt to be worthwhile
    const minTime = 5 * 60 * 1000;

    if (remaining < minTime) {
      return 0;
    }

    // Progressive allocation factors
    const factors = { 1: 0.5, 2: 0.3, 3: 0.5 };
    const factor = factors[Math.min(attemptNumber, 3)] || 0.5;

    return Math.max(minTime, Math.floor(remaining * factor));
  }

  /**
   * Check if overall time budget has time remaining
   */
  hasTimeRemaining() {
    if (!this.startTime) return true;
    const minTime = 5 * 60 * 1000; // 5 minutes minimum
    return (Date.now() - this.startTime) < (this.overallTimeLimit - minTime);
  }

  /**
   * Convert milliseconds to time string (e.g., "30m", "2h")
   */
  msToTimeString(ms) {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    if (remainingMins === 0) {
      return `${hours}h`;
    }
    // Return in minutes for precision
    return `${minutes}m`;
  }

  /**
   * Build final report with retry information
   */
  buildFinalReport(lastReport) {
    if (!lastReport) {
      return {
        status: 'error',
        error: 'No successful attempt completed',
        retryInfo: this.buildRetryInfo(),
      };
    }

    return {
      ...lastReport,
      retryInfo: this.buildRetryInfo(),
    };
  }

  /**
   * Build retry info summary
   */
  buildRetryInfo() {
    return {
      totalAttempts: this.attemptHistory.length,
      totalDuration: this.startTime ? Date.now() - this.startTime : 0,
      maxAttempts: this.maxAttempts,
      attemptSummaries: this.attemptHistory.map(a => ({
        attemptNumber: a.attemptNumber,
        duration: a.duration,
        status: a.status,
        confidence: a.confidence,
        completedSteps: a.completedSteps.length,
        failedSteps: a.failedSteps.length,
        gaps: a.gaps,
      })),
    };
  }

  /**
   * Create error report for failed attempt
   */
  createErrorReport(error, attemptNumber) {
    return {
      status: 'error',
      error: error.message,
      attemptNumber,
      finalVerification: null,
      plan: null,
    };
  }

  /**
   * Stop the retry loop gracefully
   */
  stop() {
    this.shouldStop = true;
    if (this.currentRunner) {
      this.currentRunner.stop();
    }
  }
}

export default RetryableAutonomousRunner;
