/**
 * Plan Quality Assessment Module
 *
 * Provides quality scoring and assessment for execution plans.
 */

// Quality thresholds
export const PLAN_QUALITY_THRESHOLD = 70;  // Minimum score for plan approval

// Plan limits
export const MAX_PLAN_STEPS = 15;
export const MIN_PLAN_STEPS = 2;
export const MAX_SUBPLAN_STEPS = 5;

/**
 * Plan quality assessment result
 */
export class PlanQualityAssessment {
  constructor(plan) {
    this.planId = plan.id;
    this.score = 0;
    this.issues = [];
    this.strengths = [];
    this.approved = false;
    this.suggestions = [];
    this.timestamp = Date.now();
  }

  addIssue(severity, description) {
    this.issues.push({ severity, description });
  }

  addStrength(description) {
    this.strengths.push(description);
  }

  addSuggestion(description) {
    this.suggestions.push(description);
  }

  calculateScore() {
    // Base score
    let score = 100;

    // Deduct for issues
    for (const issue of this.issues) {
      if (issue.severity === 'critical') score -= 30;
      else if (issue.severity === 'major') score -= 15;
      else if (issue.severity === 'minor') score -= 5;
    }

    // Ensure score is in valid range
    this.score = Math.max(0, Math.min(100, score));
    this.approved = this.score >= PLAN_QUALITY_THRESHOLD;

    return this.score;
  }
}

/**
 * Action verbs that indicate actionable steps
 */
const ACTION_VERBS = [
  'create', 'implement', 'add', 'update', 'fix', 'refactor',
  'test', 'configure', 'setup', 'build', 'write', 'modify',
  'remove', 'delete', 'integrate'
];

/**
 * Indicators that suggest testability
 */
const TESTABLE_INDICATORS = ['test', 'verify', 'validate', 'check', 'ensure'];

/**
 * Assess the quality of a plan
 * @param {Object} plan - The execution plan to assess
 * @returns {PlanQualityAssessment} Assessment result
 */
export function assessPlanQuality(plan) {
  const assessment = new PlanQualityAssessment(plan);

  // Check for minimum steps
  if (plan.steps.length < MIN_PLAN_STEPS) {
    assessment.addIssue('major', `Plan has only ${plan.steps.length} steps, minimum is ${MIN_PLAN_STEPS}`);
  }

  // Check for overly complex plans
  if (plan.steps.length > MAX_PLAN_STEPS) {
    assessment.addIssue('minor', `Plan exceeds ${MAX_PLAN_STEPS} steps, may be too granular`);
  }

  // Check step quality
  for (const step of plan.steps) {
    assessStepQuality(step, assessment);
  }

  // Check for analysis
  if (!plan.analysis || plan.analysis.length < 20) {
    assessment.addIssue('minor', 'Plan analysis is missing or too brief');
  } else {
    assessment.addStrength('Plan includes thoughtful analysis');
  }

  // Check complexity distribution
  assessComplexityDistribution(plan, assessment);

  // Calculate final score
  assessment.calculateScore();

  // Add suggestions based on issues
  addSuggestionsFromIssues(assessment);

  return assessment;
}

/**
 * Assess quality of a single step
 * @param {Object} step - The plan step
 * @param {PlanQualityAssessment} assessment - Assessment to add issues/strengths to
 */
function assessStepQuality(step, assessment) {
  // Check for vague descriptions
  if (step.description.length < 15) {
    assessment.addIssue('minor', `Step ${step.number} has a very short description`);
  }

  // Check for action verbs
  const hasActionVerb = ACTION_VERBS.some(verb =>
    step.description.toLowerCase().startsWith(verb) ||
    step.description.toLowerCase().includes(` ${verb} `)
  );
  if (!hasActionVerb) {
    assessment.addIssue('minor', `Step ${step.number} may not be actionable (no clear action verb)`);
  }

  // Check for testability indicators
  if (step.complexity !== 'simple') {
    const hasTestable = TESTABLE_INDICATORS.some(ind =>
      step.description.toLowerCase().includes(ind)
    );
    if (hasTestable) {
      assessment.addStrength(`Step ${step.number} includes verification`);
    }
  }
}

/**
 * Assess complexity distribution of plan steps
 * @param {Object} plan - The execution plan
 * @param {PlanQualityAssessment} assessment - Assessment to add issues/strengths to
 */
function assessComplexityDistribution(plan, assessment) {
  const complexityCount = {
    simple: plan.steps.filter(s => s.complexity === 'simple').length,
    medium: plan.steps.filter(s => s.complexity === 'medium').length,
    complex: plan.steps.filter(s => s.complexity === 'complex').length,
  };

  if (complexityCount.complex > plan.steps.length * 0.5) {
    assessment.addIssue('major', 'More than 50% of steps are complex - consider breaking them down');
  }

  if (complexityCount.simple + complexityCount.medium > 0) {
    assessment.addStrength('Plan has a mix of complexity levels');
  }
}

/**
 * Add suggestions based on identified issues
 * @param {PlanQualityAssessment} assessment - Assessment to add suggestions to
 */
function addSuggestionsFromIssues(assessment) {
  if (assessment.issues.length > 0) {
    if (assessment.issues.some(i => i.description.includes('complex'))) {
      assessment.addSuggestion('Break complex steps into smaller, more manageable tasks');
    }
    if (assessment.issues.some(i => i.description.includes('actionable'))) {
      assessment.addSuggestion('Start each step with a clear action verb');
    }
  }
}

export default {
  PlanQualityAssessment,
  assessPlanQuality,
  PLAN_QUALITY_THRESHOLD,
  MAX_PLAN_STEPS,
  MIN_PLAN_STEPS,
  MAX_SUBPLAN_STEPS,
};
