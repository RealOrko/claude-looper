/**
 * assessment-schemas.js - JSON schemas for structured supervisor outputs
 *
 * Defines the structured output schemas used by the Supervisor to ensure
 * consistent, parseable responses from LLM-based assessment calls.
 */

/**
 * Schema for regular progress assessments
 * Used to evaluate if worker Claude is on-track with the goal
 */
export const ASSESSMENT_SCHEMA = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean', description: 'Is work relevant to the goal?' },
    relevantReason: { type: 'string', description: 'Why relevant or not' },
    productive: { type: 'boolean', description: 'Is assistant taking concrete actions?' },
    productiveReason: { type: 'string', description: 'Why productive or not' },
    progressing: { type: 'boolean', description: 'Is there forward momentum?' },
    progressingReason: { type: 'string', description: 'Why progressing or not' },
    score: { type: 'integer', minimum: 0, maximum: 100, description: 'Alignment score 0-100' },
    action: { type: 'string', enum: ['CONTINUE', 'REMIND', 'CORRECT', 'REFOCUS'], description: 'Recommended action' },
    reason: { type: 'string', description: 'One sentence summary' },
  },
  required: ['relevant', 'productive', 'progressing', 'score', 'action', 'reason'],
};

/**
 * Schema for plan review responses
 * Used when supervisor reviews an execution plan before work begins
 */
export const PLAN_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    approved: { type: 'boolean', description: 'Is the plan approved?' },
    issues: { type: 'array', items: { type: 'string' }, description: 'Problems with the plan' },
    missingSteps: { type: 'array', items: { type: 'string' }, description: 'Steps that should be added' },
    suggestions: { type: 'array', items: { type: 'string' }, description: 'Improvements to consider' },
  },
  required: ['approved', 'issues', 'missingSteps', 'suggestions'],
};

/**
 * Schema for step completion verification
 * Used to verify that a step was actually completed (not just claimed)
 */
export const STEP_VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    verified: { type: 'boolean', description: 'Was the step actually completed?' },
    reason: { type: 'string', description: 'Explanation' },
  },
  required: ['verified', 'reason'],
};

/**
 * Schema for final goal verification
 * Used at the end of a session to verify the original goal was achieved
 */
export const GOAL_VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    achieved: { type: 'boolean', description: 'Was the goal achieved?' },
    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'], description: 'Confidence level' },
    functional: { type: 'string', enum: ['YES', 'NO', 'UNKNOWN'], description: 'Is the result functional?' },
    recommendation: { type: 'string', enum: ['ACCEPT', 'REJECT', 'NEEDS_TESTING'], description: 'Final recommendation' },
    gaps: { type: 'string', description: 'Gaps between goal and result, or null if none' },
    reason: { type: 'string', description: 'Detailed explanation' },
  },
  required: ['achieved', 'confidence', 'recommendation', 'reason'],
};

/**
 * Valid actions that can be taken based on assessment
 */
export const VALID_ACTIONS = ['CONTINUE', 'REMIND', 'CORRECT', 'REFOCUS'];

/**
 * Actions that are forced by escalation logic (not LLM suggested)
 */
export const ESCALATION_ACTIONS = ['CRITICAL', 'ABORT'];

/**
 * All possible action types
 */
export const ALL_ACTIONS = [...VALID_ACTIONS, ...ESCALATION_ACTIONS];

/**
 * Default escalation thresholds
 */
export const DEFAULT_ESCALATION_THRESHOLDS = {
  warn: 2,
  intervene: 3,
  critical: 4,
  abort: 5,
};

/**
 * Default stagnation threshold in milliseconds (15 minutes)
 */
export const DEFAULT_STAGNATION_THRESHOLD = 15 * 60 * 1000;

/**
 * Maximum assessment history to retain (prevents unbounded memory growth)
 */
export const MAX_ASSESSMENT_HISTORY = 50;

/**
 * Normalize a structured assessment from LLM to consistent format
 * @param {Object} structured - Raw structured output from LLM
 * @returns {Object} Normalized assessment object
 */
export function normalizeStructuredAssessment(structured) {
  return {
    relevant: structured.relevant ?? true,
    relevantReason: structured.relevantReason || '',
    productive: structured.productive ?? true,
    productiveReason: structured.productiveReason || '',
    progressing: structured.progressing ?? true,
    progressingReason: structured.progressingReason || '',
    score: Math.min(100, Math.max(0, structured.score ?? 50)),
    action: VALID_ACTIONS.includes(structured.action)
      ? structured.action
      : 'CONTINUE',
    reason: structured.reason || '',
    raw: structured,
  };
}

/**
 * Parse a text-based assessment response (fallback when structured output unavailable)
 * @param {string} text - Raw text response from LLM
 * @returns {Object} Parsed assessment object
 */
export function parseTextAssessment(text) {
  const assessment = {
    relevant: true,
    productive: true,
    progressing: true,
    score: 50,
    action: 'CONTINUE',
    reason: '',
    raw: text,
  };

  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim().toUpperCase();

    if (trimmed.startsWith('RELEVANT:')) {
      assessment.relevant = trimmed.includes('YES');
      assessment.relevantReason = line.split('-')[1]?.trim();
    }
    else if (trimmed.startsWith('PRODUCTIVE:')) {
      assessment.productive = trimmed.includes('YES');
      assessment.productiveReason = line.split('-')[1]?.trim();
    }
    else if (trimmed.startsWith('PROGRESSING:')) {
      assessment.progressing = trimmed.includes('YES');
      assessment.progressingReason = line.split('-')[1]?.trim();
    }
    else if (trimmed.startsWith('SCORE:')) {
      const match = line.match(/(\d+)/);
      if (match) {
        assessment.score = Math.min(100, Math.max(0, parseInt(match[1], 10)));
      }
    }
    else if (trimmed.startsWith('ACTION:')) {
      const action = trimmed.split(':')[1]?.trim();
      if (VALID_ACTIONS.includes(action)) {
        assessment.action = action;
      }
    }
    else if (trimmed.startsWith('REASON:')) {
      assessment.reason = line.substring(line.indexOf(':') + 1).trim();
    }
  }

  return assessment;
}

/**
 * Parse a plan review response from text
 * @param {string} text - Raw text response from LLM
 * @returns {Object} Parsed plan review object
 */
export function parsePlanReviewText(text) {
  const approved = text.toUpperCase().includes('APPROVED: YES');

  const issuesMatch = text.match(/ISSUES:\s*(.+?)(?:\n|$)/i);
  const missingMatch = text.match(/MISSING_STEPS:\s*(.+?)(?:\n|$)/i);
  const suggestionsMatch = text.match(/SUGGESTIONS:\s*(.+?)(?:\n|$)/i);

  const parseList = (match) => {
    if (!match || match[1].toLowerCase().trim() === 'none') return [];
    return match[1].split(',').map(s => s.trim()).filter(s => s);
  };

  return {
    approved,
    issues: parseList(issuesMatch),
    missingSteps: parseList(missingMatch),
    suggestions: parseList(suggestionsMatch),
    raw: text,
  };
}

/**
 * Parse a step verification response from text
 * @param {string} text - Raw text response from LLM
 * @returns {Object} Parsed verification object
 */
export function parseStepVerificationText(text) {
  const verified = text.toUpperCase().includes('VERIFIED: YES');
  const reasonMatch = text.match(/REASON:\s*(.+?)(?:\n|$)/i);
  const reason = reasonMatch ? reasonMatch[1].trim() : 'No reason provided';

  return { verified, reason };
}

/**
 * Parse a goal verification response from text
 * @param {string} text - Raw text response from LLM
 * @returns {Object} Parsed goal verification object
 */
export function parseGoalVerificationText(text) {
  const achieved = text.toUpperCase().includes('GOAL_ACHIEVED: YES');
  const confidenceMatch = text.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);
  const functionalMatch = text.match(/FUNCTIONAL:\s*(YES|NO|UNKNOWN)/i);
  const recommendationMatch = text.match(/RECOMMENDATION:\s*(ACCEPT|REJECT|NEEDS_TESTING)/i);
  const gapsMatch = text.match(/GAPS:\s*(.+?)(?:\n|$)/i);
  const reasonMatch = text.match(/REASON:\s*(.+?)(?:\n\n|$)/is);

  return {
    achieved,
    confidence: confidenceMatch ? confidenceMatch[1].toUpperCase() : 'UNKNOWN',
    functional: functionalMatch ? functionalMatch[1].toUpperCase() : 'UNKNOWN',
    recommendation: recommendationMatch ? recommendationMatch[1].toUpperCase() : 'UNKNOWN',
    gaps: gapsMatch && gapsMatch[1].toLowerCase().trim() !== 'none'
      ? gapsMatch[1].trim() : null,
    reason: reasonMatch ? reasonMatch[1].trim() : 'No reason provided',
    raw: text,
  };
}
