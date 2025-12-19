/**
 * Supervisor - LLM-based assessment of worker Claude's progress
 * Uses a separate Claude session to evaluate if work is on-track
 * Implements escalation system for drift recovery
 */

import {
  DEFAULT_ESCALATION_THRESHOLDS,
  DEFAULT_STAGNATION_THRESHOLD,
} from './assessment-schemas.js';

import { PlanReviewer } from './plan-reviewer.js';
import { StepVerifier } from './step-verifier.js';
import { AssessmentEngine } from './supervisor/assessment-engine.js';
import { generateCorrection, checkStagnation } from './supervisor/correction-generator.js';
import { detectRepetitiveBehavior, suggestAutoRecovery } from './supervisor/repetition-detector.js';

export class Supervisor {
  constructor(client, goalTracker, config = null) {
    this.client = client;
    this.goalTracker = goalTracker;
    this.config = config;
    this.previousAction = null;
    this.totalCorrections = 0;

    // Supervisor configuration
    const supervisorConfig = config?.get('supervisor') || {};
    this.useStructuredOutput = supervisorConfig.useStructuredOutput !== false;
    this.readOnlyTools = supervisorConfig.readOnlyTools !== false;
    this.maxResponseLength = supervisorConfig.maxResponseLength || 5000;
    this.skipForSimpleSteps = supervisorConfig.skipForSimpleSteps || false;

    // Initialize assessment engine
    this.assessmentEngine = new AssessmentEngine(client, {
      useStructuredOutput: this.useStructuredOutput,
      readOnlyTools: this.readOnlyTools,
      maxResponseLength: this.maxResponseLength,
      skipForSimpleSteps: this.skipForSimpleSteps,
    });

    // Initialize sub-modules
    this.planReviewer = new PlanReviewer(client, {
      useStructuredOutput: this.useStructuredOutput,
      readOnlyTools: this.readOnlyTools,
    });

    this.stepVerifier = new StepVerifier(client, {
      useStructuredOutput: this.useStructuredOutput,
      readOnlyTools: this.readOnlyTools,
      maxResponseLength: this.maxResponseLength,
      skipForSimpleSteps: this.skipForSimpleSteps,
    });
  }

  // Accessors for assessment engine state
  get assessmentHistory() { return this.assessmentEngine.assessmentHistory; }
  get consecutiveIssues() { return this.assessmentEngine.consecutiveIssues; }
  get lastRelevantAction() { return this.assessmentEngine.lastRelevantAction; }

  getThresholds() {
    return this.config?.get('escalationThresholds') || DEFAULT_ESCALATION_THRESHOLDS;
  }

  getStagnationThreshold() {
    return this.config?.get('stagnationThreshold') || DEFAULT_STAGNATION_THRESHOLD;
  }

  getCurrentPhase() {
    const current = this.goalTracker.subGoals[this.goalTracker.currentPhase];
    return current ? current.description : this.goalTracker.primaryGoal;
  }

  async assess(response, recentActions = [], options = {}) {
    return this.assessmentEngine.assess(response, recentActions, {
      ...options,
      goalTracker: this.goalTracker,
      thresholds: this.getThresholds(),
    });
  }

  determineAction(assessment) {
    const thresholds = this.getThresholds();
    const issues = this.consecutiveIssues;

    if (issues >= thresholds.abort) return 'ABORT';
    if (issues >= thresholds.critical) return 'CRITICAL';
    if (issues >= thresholds.intervene && assessment.action !== 'REFOCUS') return 'REFOCUS';
    if (issues >= thresholds.warn && assessment.action === 'CONTINUE') return 'CORRECT';

    return assessment.action;
  }

  getAverageScore() {
    return this.assessmentEngine.getAverageScore();
  }

  generateCorrectionPrompt(assessment) {
    // Track corrections for non-continue actions
    if (['CORRECT', 'REFOCUS', 'CRITICAL'].includes(assessment.action)) {
      this.totalCorrections++;
    }

    return generateCorrection(assessment, {
      goal: this.goalTracker.primaryGoal,
      phase: this.getCurrentPhase(),
      thresholds: this.getThresholds(),
      consecutiveIssues: this.consecutiveIssues,
      totalCorrections: this.totalCorrections,
      avgScore: this.getAverageScore(),
    });
  }

  checkStagnationStatus() {
    return checkStagnation(this.lastRelevantAction, this.getStagnationThreshold(), {
      primaryGoal: this.goalTracker.primaryGoal,
      consecutiveIssues: this.consecutiveIssues,
      thresholds: this.getThresholds(),
    });
  }

  getRepetitiveBehavior() {
    return detectRepetitiveBehavior(this.assessmentHistory);
  }

  getAutoRecovery(repetitiveAnalysis, currentStep = null) {
    return suggestAutoRecovery(repetitiveAnalysis, {
      currentStep,
      primaryGoal: this.goalTracker.primaryGoal,
    });
  }

  async check(response, recentActions = [], options = {}) {
    const { currentStep = null } = options;
    const assessment = await this.assess(response, recentActions, options);
    const finalAction = this.determineAction(assessment);
    const escalated = finalAction !== assessment.action;

    const finalAssessment = { ...assessment, originalAction: assessment.action, action: finalAction, escalated };
    this.previousAction = finalAction;

    const correction = this.generateCorrectionPrompt(finalAssessment);
    const stagnation = this.checkStagnationStatus();
    const repetitiveAnalysis = this.getRepetitiveBehavior();
    const autoRecovery = this.getAutoRecovery(repetitiveAnalysis, currentStep);

    let prompt = null;
    if (autoRecovery) prompt = autoRecovery.prompt;
    else if (correction) prompt = correction;
    else if (stagnation.isStagnant) prompt = stagnation.prompt;

    return { assessment: finalAssessment, correction, stagnation, repetitiveAnalysis, autoRecovery, needsIntervention: prompt !== null, prompt, consecutiveIssues: this.consecutiveIssues, escalated };
  }

  async reviewPlan(plan, originalGoal) { return this.planReviewer.reviewPlan(plan, originalGoal); }
  async verifyStepCompletion(step, responseContent) { return this.stepVerifier.verifyStepCompletion(step, responseContent); }
  async verifyGoalAchieved(originalGoal, completedSteps, workingDirectory) { return this.stepVerifier.verifyGoalAchieved(originalGoal, completedSteps, workingDirectory); }

  getStats() {
    const thresholds = this.getThresholds();
    const actionCounts = this.assessmentHistory.reduce((counts, entry) => {
      const action = entry.assessment.action;
      counts[action] = (counts[action] || 0) + 1;
      return counts;
    }, {});

    return {
      totalAssessments: this.assessmentHistory.length,
      consecutiveIssues: this.consecutiveIssues,
      totalCorrections: this.totalCorrections,
      lastRelevantAction: this.lastRelevantAction,
      recentScores: this.assessmentHistory.slice(-5).map(a => a.assessment.score),
      averageScore: this.getAverageScore(),
      actionCounts,
      thresholds,
      escalationStatus: this.getEscalationStatus(),
    };
  }

  getEscalationStatus() {
    const thresholds = this.getThresholds();
    const issues = this.consecutiveIssues;
    if (issues >= thresholds.abort) return 'ABORT';
    if (issues >= thresholds.critical) return 'CRITICAL';
    if (issues >= thresholds.intervene) return 'INTERVENE';
    if (issues >= thresholds.warn) return 'WARN';
    return 'OK';
  }
}

export default Supervisor;
