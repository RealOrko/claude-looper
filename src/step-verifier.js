/**
 * step-verifier.js - Step and goal verification for the Supervisor
 *
 * Handles LLM-based verification of:
 * - Individual step completion claims
 * - Final goal achievement
 */

import {
  STEP_VERIFICATION_SCHEMA,
  GOAL_VERIFICATION_SCHEMA,
  parseStepVerificationText,
  parseGoalVerificationText,
} from './assessment-schemas.js';
import { withVerificationFallback } from './error-utils.js';

/**
 * StepVerifier - Verifies step completions and goal achievement using LLM
 */
export class StepVerifier {
  /**
   * @param {Object} client - Claude client for LLM calls
   * @param {Object} options - Configuration options
   * @param {boolean} options.useStructuredOutput - Use JSON schema for structured output
   * @param {boolean} options.readOnlyTools - Restrict to read-only tools
   * @param {number} options.maxResponseLength - Max response length to analyze
   * @param {boolean} options.skipForSimpleSteps - Skip verification for simple steps
   */
  constructor(client, options = {}) {
    this.client = client;
    this.useStructuredOutput = options.useStructuredOutput !== false;
    this.readOnlyTools = options.readOnlyTools !== false;
    this.maxResponseLength = options.maxResponseLength || 5000;
    this.skipForSimpleSteps = options.skipForSimpleSteps || false;
  }

  /**
   * Build the prompt for step verification
   * @param {Object} step - The step to verify
   * @param {string} responseContent - The response to analyze
   * @returns {string} The verification prompt
   */
  buildStepVerificationPrompt(step, responseContent) {
    const truncatedResponse = responseContent.substring(0, this.maxResponseLength);

    if (this.useStructuredOutput) {
      return `Verify step completion: "${step.description}" [${step.complexity}]

Response:
${truncatedResponse}

Did assistant complete this step with concrete actions and evidence?`;
    }

    return `You are verifying whether a step was actually completed.

## STEP TO VERIFY
Step ${step.number}: ${step.description}
Complexity: ${step.complexity}

## ASSISTANT'S RESPONSE
${truncatedResponse}

## YOUR TASK
Did the assistant actually complete this step? Look for:
- Concrete actions taken (not just plans)
- Evidence the step's objective was achieved
- Actual output, file changes, or results

Respond in EXACTLY this format:
VERIFIED: [YES/NO]
REASON: [one sentence explanation]`;
  }

  /**
   * Verify that a step was actually completed
   * @param {Object} step - The step to verify
   * @param {string} responseContent - The worker's response claiming completion
   * @returns {Promise<Object>} Verification result with verified, reason
   */
  async verifyStepCompletion(step, responseContent) {
    // Skip verification for simple steps if configured
    if (this.skipForSimpleSteps && step.complexity === 'simple') {
      return {
        verified: true,
        reason: 'Skipped - simple complexity step',
        skipped: true,
      };
    }

    const prompt = this.buildStepVerificationPrompt(step, responseContent);
    const fallback = { verified: true, reason: 'Verification unavailable - trusting claim' };

    return withVerificationFallback(async () => {
      const callOptions = {
        newSession: true,
        timeout: 90 * 1000, // 90 sec
        model: 'sonnet',
        noSessionPersistence: true,
      };

      if (this.useStructuredOutput) {
        callOptions.jsonSchema = STEP_VERIFICATION_SCHEMA;
      }

      if (this.readOnlyTools) {
        callOptions.disallowedTools = ['Edit', 'Write', 'Bash', 'NotebookEdit'];
      }

      const result = await this.client.sendPrompt(prompt, callOptions);

      // Use structured output if available
      if (result.structuredOutput) {
        return {
          verified: result.structuredOutput.verified ?? true,
          reason: result.structuredOutput.reason || 'No reason provided',
        };
      }

      // Fall back to text parsing
      return parseStepVerificationText(result.response || '');
    }, fallback, { logPrefix: '[StepVerifier] Step verification failed:' });
  }

  /**
   * Build the prompt for goal verification
   * @param {string} originalGoal - The original goal
   * @param {Array} completedSteps - Array of completed steps
   * @param {string} workingDirectory - The working directory
   * @returns {string} The goal verification prompt
   */
  buildGoalVerificationPrompt(originalGoal, completedSteps, workingDirectory) {
    const stepsSummary = completedSteps
      .map(s => `${s.status === 'completed' ? '✓' : '✗'} ${s.number}. ${s.description}`)
      .join('\n');

    if (this.useStructuredOutput) {
      return `FINAL VERIFICATION - Was goal achieved?

GOAL: ${originalGoal}

COMPLETED STEPS:
${stepsSummary}

WORKING DIR: ${workingDirectory}

Critical review: Does work achieve goal? Any gaps? Functional result? Human would be satisfied?`;
    }

    return `You are performing FINAL VERIFICATION that a goal was truly achieved.

## ORIGINAL GOAL
${originalGoal}

## COMPLETED STEPS
${stepsSummary}

## WORKING DIRECTORY
${workingDirectory}

## YOUR TASK

This is the final check before declaring success. Be CRITICAL and thorough.

Consider:
1. Does the work done actually achieve the ORIGINAL GOAL?
2. Are there any gaps between what was done and what was asked?
3. Would a human reviewing this work be satisfied?
4. Is the result functional and complete, not just "done"?

Think about edge cases and what could still be missing.

Respond in EXACTLY this format:

GOAL_ACHIEVED: [YES/NO]
CONFIDENCE: [HIGH/MEDIUM/LOW]
GAPS: [list any gaps between goal and result, or "none"]
FUNCTIONAL: [YES/NO/UNKNOWN] - Would this actually work if used?
RECOMMENDATION: [ACCEPT/REJECT/NEEDS_TESTING]
REASON: [one paragraph explanation]`;
  }

  /**
   * Final verification that the original goal was achieved
   * @param {string} originalGoal - The original goal
   * @param {Array} completedSteps - Array of step objects with status
   * @param {string} workingDirectory - The working directory path
   * @returns {Promise<Object>} Verification result
   */
  async verifyGoalAchieved(originalGoal, completedSteps, workingDirectory) {
    const prompt = this.buildGoalVerificationPrompt(originalGoal, completedSteps, workingDirectory);
    let isTimeout = false;

    const fallback = {
      achieved: false,
      confidence: 'LOW',
      functional: 'UNKNOWN',
      recommendation: 'NEEDS_TESTING',
      verificationError: true,
    };

    const result = await withVerificationFallback(async () => {
      const callOptions = {
        newSession: true,
        timeout: 2 * 60 * 1000, // 2 min
        model: 'sonnet',
        noSessionPersistence: true,
      };

      if (this.useStructuredOutput) {
        callOptions.jsonSchema = GOAL_VERIFICATION_SCHEMA;
      }

      if (this.readOnlyTools) {
        callOptions.disallowedTools = ['Edit', 'Write', 'Bash', 'NotebookEdit'];
      }

      const result = await this.client.sendPrompt(prompt, callOptions);

      // Use structured output if available
      if (result.structuredOutput) {
        const so = result.structuredOutput;
        return {
          achieved: so.achieved ?? false,
          confidence: so.confidence || 'UNKNOWN',
          functional: so.functional || 'UNKNOWN',
          recommendation: so.recommendation || 'UNKNOWN',
          gaps: so.gaps && so.gaps.toLowerCase() !== 'none' ? so.gaps : null,
          reason: so.reason || 'No reason provided',
          raw: so,
        };
      }

      // Fall back to text parsing
      return parseGoalVerificationText(result.response || '');
    }, fallback, {
      logPrefix: '[StepVerifier] Goal verification failed:',
      onError: (error) => { isTimeout = error.message?.includes('timed out'); },
    });

    // Handle timeout specially - achieved is null if timeout
    if (result.fallbackUsed) {
      if (isTimeout) {
        result.achieved = null;
        result.verificationTimeout = true;
      } else {
        result.verificationTimeout = false;
      }
    }

    return result;
  }

  /**
   * Format a goal verification result as human-readable summary
   * @param {Object} result - The goal verification result
   * @returns {string} Formatted summary
   */
  formatGoalVerificationSummary(result) {
    const lines = [];

    const status = result.achieved === true ? '✓ ACHIEVED'
      : result.achieved === false ? '✗ NOT ACHIEVED'
      : '? INCONCLUSIVE';

    lines.push(`Goal ${status}`);
    lines.push(`Confidence: ${result.confidence}`);
    lines.push(`Functional: ${result.functional}`);
    lines.push(`Recommendation: ${result.recommendation}`);

    if (result.gaps) {
      lines.push(`\nGaps: ${result.gaps}`);
    }

    lines.push(`\nReason: ${result.reason}`);

    if (result.error) {
      lines.push(`\n⚠️ Verification error: ${result.error}`);
    }

    return lines.join('\n');
  }
}

export default StepVerifier;
