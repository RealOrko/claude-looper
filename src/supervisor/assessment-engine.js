/**
 * Assessment Engine
 * Handles LLM-based assessment of worker responses with fast-path optimizations
 */

import {
  ASSESSMENT_SCHEMA,
  MAX_ASSESSMENT_HISTORY,
  normalizeStructuredAssessment,
  parseTextAssessment,
} from '../assessment-schemas.js';

import {
  buildSupervisionHistory,
  buildStructuredPrompt,
  buildTextPrompt,
  canUseFastAssessment,
  canUseUltraFastAssessment,
} from './assessment-prompts.js';

export class AssessmentEngine {
  constructor(client, options = {}) {
    this.client = client;
    this.useStructuredOutput = options.useStructuredOutput !== false;
    this.readOnlyTools = options.readOnlyTools !== false;
    this.maxResponseLength = options.maxResponseLength || 5000;
    this.skipForSimpleSteps = options.skipForSimpleSteps || false;

    this.assessmentHistory = [];
    this.consecutiveIssues = 0;
    this.lastRelevantAction = Date.now();
  }

  /**
   * Build supervisor memory section for assessment prompt
   */
  buildSupervisionHistory(thresholds) {
    return buildSupervisionHistory(this.assessmentHistory, this.consecutiveIssues, thresholds);
  }

  /**
   * Build the supervisor assessment prompt
   */
  buildAssessmentPrompt(response, recentActions, goalTracker, thresholds) {
    const truncatedResponse = response.substring(0, this.maxResponseLength);
    const currentPhase = this.getCurrentPhase(goalTracker);
    const hasSubGoals = goalTracker.subGoals.length > 0;

    if (this.useStructuredOutput) {
      return buildStructuredPrompt({
        response: truncatedResponse,
        recentActions,
        primaryGoal: goalTracker.primaryGoal,
        currentPhase,
        consecutiveIssues: this.consecutiveIssues,
        thresholds,
        hasSubGoals,
      });
    }

    return buildTextPrompt({
      response: truncatedResponse,
      recentActions,
      primaryGoal: goalTracker.primaryGoal,
      subGoals: goalTracker.subGoals,
      currentPhase,
      supervisionHistory: this.buildSupervisionHistory(thresholds),
      thresholds,
      hasSubGoals,
    });
  }

  /**
   * Get current phase description
   */
  getCurrentPhase(goalTracker) {
    const current = goalTracker.subGoals[goalTracker.currentPhase];
    return current ? current.description : goalTracker.primaryGoal;
  }

  /**
   * Check if we can use fast-path assessment (skip LLM call)
   */
  canUseFastAssessment(response) {
    return canUseFastAssessment(response, this.assessmentHistory, this.consecutiveIssues);
  }

  /**
   * Ultra-fast assessment for tool-usage responses
   */
  canUseUltraFastAssessment(response) {
    return canUseUltraFastAssessment(response, this.consecutiveIssues);
  }

  /**
   * Assess the worker's response
   */
  async assess(response, recentActions = [], options = {}) {
    const { goalTracker, thresholds, complexity } = options;

    if (this.skipForSimpleSteps && complexity === 'simple') {
      return this.createSkippedAssessment('Skipped - simple complexity step');
    }

    if (this.canUseUltraFastAssessment(response)) {
      return this.createFastAssessment(90, 'Ultra-fast: Active tool usage detected', 'ultraFastPath');
    }

    if (this.canUseFastAssessment(response)) {
      return this.createFastAssessment(85, 'Fast-path: Clear progress detected', 'fastPath');
    }

    return this.performLLMAssessment(response, recentActions, goalTracker, thresholds);
  }

  createSkippedAssessment(reason) {
    return { relevant: true, productive: true, progressing: true, score: 80, action: 'CONTINUE', reason, skipped: true };
  }

  createFastAssessment(score, reason, pathType) {
    return { relevant: true, productive: true, progressing: true, score, action: 'CONTINUE', reason, [pathType]: true };
  }

  async performLLMAssessment(response, recentActions, goalTracker, thresholds) {
    const prompt = this.buildAssessmentPrompt(response, recentActions, goalTracker, thresholds);

    try {
      const callOptions = {
        newSession: true,
        timeout: 3 * 60 * 1000,
        model: 'sonnet',
        noSessionPersistence: true,
      };

      if (this.useStructuredOutput) {
        callOptions.jsonSchema = ASSESSMENT_SCHEMA;
      }

      if (this.readOnlyTools) {
        callOptions.disallowedTools = ['Edit', 'Write', 'Bash', 'NotebookEdit'];
      }

      const result = await this.client.sendPrompt(prompt, callOptions);

      const assessment = result.structuredOutput
        ? normalizeStructuredAssessment(result.structuredOutput)
        : parseTextAssessment(result.response);

      this.recordAssessment(assessment, response, !!result.structuredOutput);

      return assessment;

    } catch (error) {
      console.error('[AssessmentEngine] Assessment failed:', error.message);
      return { relevant: true, productive: true, progressing: true, score: 70, action: 'CONTINUE', reason: 'Assessment unavailable - continuing', error: error.message };
    }
  }

  /**
   * Record an assessment in history
   */
  recordAssessment(assessment, response, usedStructuredOutput) {
    this.assessmentHistory.push({
      timestamp: Date.now(),
      assessment,
      responseSnippet: response.substring(0, 100),
      usedStructuredOutput,
    });

    if (this.assessmentHistory.length > MAX_ASSESSMENT_HISTORY) {
      this.assessmentHistory = this.assessmentHistory.slice(-MAX_ASSESSMENT_HISTORY);
    }

    if (assessment.action !== 'CONTINUE') {
      this.consecutiveIssues++;
    } else {
      this.consecutiveIssues = 0;
      this.lastRelevantAction = Date.now();
    }
  }

  getAverageScore() {
    if (this.assessmentHistory.length === 0) return null;
    const scores = this.assessmentHistory.map(a => a.assessment.score);
    return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
  }

  getHistory() {
    return this.assessmentHistory;
  }

  reset() {
    this.assessmentHistory = [];
    this.consecutiveIssues = 0;
    this.lastRelevantAction = Date.now();
  }
}

export default AssessmentEngine;
