/**
 * plan-reviewer.js - Plan review functionality for the Supervisor
 *
 * Handles LLM-based review of execution plans before work begins.
 * Reviews plans for completeness, correctness, and goal alignment.
 */

import {
  PLAN_REVIEW_SCHEMA,
  parsePlanReviewText,
} from './assessment-schemas.js';
import { withVerificationFallback } from './error-utils.js';

/**
 * PlanReviewer - Reviews execution plans using LLM
 */
export class PlanReviewer {
  /**
   * @param {Object} client - Claude client for LLM calls
   * @param {Object} options - Configuration options
   * @param {boolean} options.useStructuredOutput - Use JSON schema for structured output
   * @param {boolean} options.readOnlyTools - Restrict to read-only tools
   */
  constructor(client, options = {}) {
    this.client = client;
    this.useStructuredOutput = options.useStructuredOutput !== false;
    this.readOnlyTools = options.readOnlyTools !== false;
  }

  /**
   * Build the prompt for plan review
   * @param {Object} plan - The execution plan to review
   * @param {string} originalGoal - The original goal the plan should achieve
   * @returns {string} The prompt for plan review
   */
  buildReviewPrompt(plan, originalGoal) {
    if (this.useStructuredOutput) {
      return `Review this execution plan for goal: "${originalGoal}"

Plan:
${plan.steps.map(s => `${s.number}. ${s.description} [${s.complexity}]`).join('\n')}

Check: Addresses goal? Missing steps? Logical order? Right granularity?`;
    }

    return `You are reviewing an execution plan before it begins.

## ORIGINAL GOAL
${originalGoal}

## PROPOSED PLAN
Analysis: ${plan.analysis || 'None provided'}

Steps:
${plan.steps.map(s => `${s.number}. ${s.description} [${s.complexity}]`).join('\n')}

## YOUR TASK

Critically review this plan. Consider:
1. Does it fully address the original goal?
2. Are any critical steps missing?
3. Is the order logical?
4. Are steps too vague or too granular?
5. Are there any obvious blockers or risks?

Respond in EXACTLY this format:

APPROVED: [YES/NO]
ISSUES: [comma-separated list of problems, or "none"]
MISSING_STEPS: [comma-separated list of missing steps, or "none"]
SUGGESTIONS: [comma-separated improvements, or "none"]`;
  }

  /**
   * Review an execution plan
   * @param {Object} plan - The execution plan with steps array
   * @param {string} originalGoal - The goal the plan should achieve
   * @returns {Promise<Object>} Review result with approved, issues, missingSteps, suggestions
   */
  async reviewPlan(plan, originalGoal) {
    const prompt = this.buildReviewPrompt(plan, originalGoal);
    const fallback = { approved: true, issues: [], missingSteps: [], suggestions: [] };

    return withVerificationFallback(async () => {
      const callOptions = {
        newSession: true,
        timeout: 2 * 60 * 1000, // 2 min
        model: 'sonnet',
        noSessionPersistence: true,
      };

      if (this.useStructuredOutput) {
        callOptions.jsonSchema = PLAN_REVIEW_SCHEMA;
      }

      if (this.readOnlyTools) {
        callOptions.disallowedTools = ['Edit', 'Write', 'Bash', 'NotebookEdit'];
      }

      const result = await this.client.sendPrompt(prompt, callOptions);

      // Use structured output if available
      if (result.structuredOutput) {
        return {
          approved: result.structuredOutput.approved ?? true,
          issues: result.structuredOutput.issues || [],
          missingSteps: result.structuredOutput.missingSteps || [],
          suggestions: result.structuredOutput.suggestions || [],
          raw: result.structuredOutput,
        };
      }

      // Fall back to text parsing
      return parsePlanReviewText(result.response || '');
    }, fallback, { logPrefix: '[PlanReviewer] Plan review failed:' });
  }

  /**
   * Create a formatted summary of the review result
   * @param {Object} review - The review result
   * @returns {string} Human-readable summary
   */
  formatReviewSummary(review) {
    const lines = [];

    lines.push(`Plan ${review.approved ? '✓ APPROVED' : '✗ NOT APPROVED'}`);

    if (review.issues.length > 0) {
      lines.push('\nIssues:');
      review.issues.forEach(issue => lines.push(`  - ${issue}`));
    }

    if (review.missingSteps.length > 0) {
      lines.push('\nMissing Steps:');
      review.missingSteps.forEach(step => lines.push(`  - ${step}`));
    }

    if (review.suggestions.length > 0) {
      lines.push('\nSuggestions:');
      review.suggestions.forEach(sug => lines.push(`  - ${sug}`));
    }

    if (review.error) {
      lines.push(`\n⚠️ Review had error: ${review.error}`);
    }

    return lines.join('\n');
  }
}

export default PlanReviewer;
