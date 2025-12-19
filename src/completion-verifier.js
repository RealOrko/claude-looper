/**
 * Completion Verifier - Multi-layer verification of completion claims
 * Prevents Claude from falsely claiming task completion
 *
 * Delegates parsing and validation to:
 * - evidence-parser.js: Evidence extraction and evaluation
 * - verification-strategies.js: Artifact/test validation
 */

import {
  parseEvidence,
  evaluateEvidence,
  buildChallengePrompt,
  isReadOnlyTask,
} from './evidence-parser.js';
import {
  getDefaultVerificationConfig,
  verifyArtifacts,
  runValidation,
  generateRejectionPrompt,
} from './verification-strategies.js';

const MAX_VERIFICATION_HISTORY = 20;

export class CompletionVerifier {
  constructor(client, goalTracker, config) {
    this.client = client;
    this.goalTracker = goalTracker;
    this.config = config;
    this.verificationHistory = [];
  }

  addToHistory(result) {
    this.verificationHistory.push(result);
    if (this.verificationHistory.length > MAX_VERIFICATION_HISTORY) {
      this.verificationHistory = this.verificationHistory.slice(-MAX_VERIFICATION_HISTORY);
    }
  }

  getVerificationConfig() {
    return getDefaultVerificationConfig(this.config);
  }

  /**
   * Main verification entry point
   */
  async verify(completionClaim, workingDirectory, planProgress = null) {
    const result = {
      passed: false,
      layers: {
        planProgress: null,
        challenge: null,
        artifacts: null,
        validation: null,
      },
      evidence: null,
      failures: [],
      timestamp: Date.now(),
    };

    const verifyConfig = this.getVerificationConfig();

    // Layer 0: Plan Progress Check
    if (planProgress) {
      const minProgress = verifyConfig.minPlanProgress;
      result.layers.planProgress = {
        passed: planProgress.percentComplete >= minProgress,
        completed: planProgress.completed,
        total: planProgress.total,
        percentComplete: planProgress.percentComplete,
        minRequired: minProgress,
      };

      if (!result.layers.planProgress.passed) {
        result.failures.push(
          `Plan only ${planProgress.percentComplete}% complete (${planProgress.completed}/${planProgress.total} steps). ` +
          `Minimum ${minProgress}% required to accept completion claims.`
        );
        this.addToHistory(result);
        return result;
      }
    }

    // Layer 1: LLM Challenge
    result.layers.challenge = await this.challengeCompletion(completionClaim);
    if (!result.layers.challenge.passed) {
      result.failures.push('Failed LLM challenge - insufficient or vague evidence provided');
      this.addToHistory(result);
      return result;
    }
    result.evidence = result.layers.challenge.evidence;

    // Layer 2: Artifact Inspection
    if (result.evidence.files.length > 0) {
      result.layers.artifacts = await verifyArtifacts(
        result.evidence.files,
        workingDirectory
      );
      if (!result.layers.artifacts.passed) {
        const missing = result.layers.artifacts.missing;
        const empty = result.layers.artifacts.empty;
        if (missing.length > 0) {
          result.failures.push(`Missing files: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`);
        }
        if (empty.length > 0) {
          result.failures.push(`Empty files: ${empty.join(', ')}`);
        }
        this.addToHistory(result);
        return result;
      }
    } else if (verifyConfig.requireArtifacts && !isReadOnlyTask(result.evidence)) {
      result.layers.artifacts = { passed: false, verified: [], missing: [], empty: [] };
      result.failures.push('No file artifacts mentioned - completion claim lacks evidence');
      this.addToHistory(result);
      return result;
    } else {
      result.layers.artifacts = { passed: true, verified: [], missing: [], empty: [], skipped: true };
    }

    // Layer 3: Test Validation
    if (verifyConfig.runTests) {
      result.layers.validation = await runValidation(
        result.evidence,
        workingDirectory,
        this.config
      );
      if (!result.layers.validation.passed) {
        result.failures.push(`Validation failed: ${result.layers.validation.error || 'Tests did not pass'}`);
        this.addToHistory(result);
        return result;
      }
    } else {
      result.layers.validation = { passed: true, skipped: true, testsRun: [], testsFailed: [] };
    }

    result.passed = true;
    this.addToHistory(result);
    return result;
  }

  /**
   * Layer 1: Challenge Claude to provide concrete evidence
   */
  async challengeCompletion(completionClaim) {
    const result = {
      passed: false,
      evidence: null,
      response: null,
    };

    try {
      const goal = this.goalTracker.primaryGoal;
      const subGoals = this.goalTracker.subGoals;
      const challengePrompt = buildChallengePrompt(completionClaim, goal, subGoals);

      const response = await this.client.continueConversation(challengePrompt);
      result.response = response.response;

      const evidence = parseEvidence(response.response);
      result.evidence = evidence;
      result.passed = evaluateEvidence(evidence);
    } catch (error) {
      result.error = error.message;
      result.passed = false;
    }

    return result;
  }

  /**
   * Generate rejection prompt when verification fails
   */
  generateRejectionPrompt(verificationResult) {
    return generateRejectionPrompt(verificationResult);
  }

  /**
   * Get verification statistics
   */
  getStats() {
    const total = this.verificationHistory.length;
    const passed = this.verificationHistory.filter(v => v.passed).length;
    const failed = total - passed;

    return {
      totalVerifications: total,
      passed,
      failed,
      passRate: total > 0 ? Math.round((passed / total) * 100) : null,
      recentResults: this.verificationHistory.slice(-5).map(v => ({
        passed: v.passed,
        failures: v.failures,
        timestamp: v.timestamp,
      })),
    };
  }
}

export default CompletionVerifier;
