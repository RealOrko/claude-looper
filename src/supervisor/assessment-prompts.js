/**
 * Assessment Prompts
 * Builds prompts for LLM-based assessment of worker responses
 */

/**
 * Progress indicators for fast assessment
 */
export const PROGRESS_INDICATORS = [
  /STEP\s+COMPLETE/i,
  /successfully\s+(created|implemented|wrote|added|fixed|updated)/i,
  /completed?\s+(the|this)?\s*(step|task|implementation)/i,
  /✓|✔|done|finished/i,
];

/**
 * Blocker indicators that prevent fast assessment
 */
export const BLOCKER_INDICATORS = [
  /STEP\s+BLOCKED/i,
  /error|exception|failed|cannot|unable/i,
  /stuck|blocked|problem/i,
];

/**
 * Tool usage indicators for ultra-fast assessment
 */
export const TOOL_USAGE_INDICATORS = [
  /Read tool|Write tool|Edit tool|Bash tool|Glob tool|Grep tool/i,
  /reading file|writing file|editing file|running command/i,
  /searching for|found \d+ files|found \d+ matches/i,
  /Let me (read|write|edit|run|search|check|look)/i,
  /I'll (read|write|edit|run|search|check|create|update)/i,
];

/**
 * Error indicators that block ultra-fast assessment
 */
export const ERROR_INDICATORS = [
  /error:|exception:|failed to|cannot|unable to/i,
  /STEP\s+BLOCKED/i,
  /permission denied/i,
];

/**
 * Build supervision history section for prompt
 * @param {Array} assessmentHistory - Recent assessments
 * @param {number} consecutiveIssues - Count of consecutive issues
 * @param {Object} thresholds - Escalation thresholds
 * @returns {string} Formatted history section
 */
export function buildSupervisionHistory(assessmentHistory, consecutiveIssues, thresholds) {
  const recent = assessmentHistory.slice(-3);
  if (recent.length === 0) {
    return 'No previous assessments.';
  }

  const history = recent.map((entry, i) => {
    const a = entry.assessment;
    return `  ${i + 1}. [${a.action}] Score: ${a.score}/100 - ${a.reason || 'No reason given'}`;
  }).join('\n');

  let warning = '';
  if (consecutiveIssues >= thresholds.critical) {
    warning = '\n⚠️ CRITICAL: Next issue will trigger session termination!';
  } else if (consecutiveIssues >= thresholds.intervene) {
    warning = '\n⚠️ WARNING: Pattern of drift detected - escalation imminent';
  } else if (consecutiveIssues >= thresholds.warn) {
    warning = '\n⚠️ ALERT: Multiple consecutive issues detected';
  }

  return `${history}\nConsecutive issues: ${consecutiveIssues}/${thresholds.abort}${warning}`;
}

/**
 * Build structured output assessment prompt
 * @param {Object} params - Prompt parameters
 * @returns {string} Formatted prompt
 */
export function buildStructuredPrompt(params) {
  const { response, recentActions, primaryGoal, currentPhase, consecutiveIssues, thresholds, hasSubGoals } = params;

  return `SUPERVISOR: Evaluate AI assistant progress.

GOAL: ${primaryGoal}
${hasSubGoals ? `CURRENT PHASE: ${currentPhase}` : ''}
CONSECUTIVE ISSUES: ${consecutiveIssues}/${thresholds.abort}

ASSISTANT OUTPUT:
${response}

RECENT ACTIONS: ${recentActions.length > 0 ? recentActions.join('; ') : 'None'}

SCORING: 90-100=advancing goal, 70-89=acceptable, 50-69=tangential, 30-49=off-track, 0-29=lost
ACTIONS: CONTINUE(70+), REMIND(50-69), CORRECT(30-49 or ${thresholds.warn}+ issues), REFOCUS(<30 or ${thresholds.intervene}+ issues)`;
}

/**
 * Build text format assessment prompt
 * @param {Object} params - Prompt parameters
 * @returns {string} Formatted prompt
 */
export function buildTextPrompt(params) {
  const { response, recentActions, primaryGoal, subGoals, currentPhase, supervisionHistory, thresholds, hasSubGoals } = params;

  const subGoalsSection = hasSubGoals ? `## SUB-GOALS
${subGoals.map((g, i) => `${i + 1}. [${g.status}] ${g.description}`).join('\n')}

## CURRENT PHASE
Working on: ${currentPhase}` : '';

  return `You are a SUPERVISOR evaluating an AI assistant working autonomously.

## ASSIGNED GOAL
${primaryGoal}

${subGoalsSection}

## SUPERVISION HISTORY
${supervisionHistory}

## ASSISTANT'S LATEST RESPONSE
${response}

## RECENT ACTIONS
${recentActions.length > 0 ? recentActions.map(a => `- ${a}`).join('\n') : 'None recorded yet'}

## YOUR TASK

Evaluate whether the assistant is making progress toward the goal.

Consider:
- Is this work directly relevant to the goal, OR a necessary prerequisite?
- Is the assistant taking concrete actions (not just planning endlessly)?
- Is there forward momentum?
- Has the assistant gone off on a tangent?
- Did the assistant follow any previous correction given?

## SCORING GUIDE

SCORE: [0-100] where:
  - 90-100: Directly advancing the goal with concrete actions
  - 70-89: Related work, acceptable progress
  - 50-69: Tangential, needs gentle redirection
  - 30-49: Off-track, needs clear correction
  - 0-29: Completely lost, requires hard intervention

ACTION: Choose based on score AND history:
  - CONTINUE (score 70+): On track, no intervention needed
  - REMIND (score 50-69): Gentle nudge to refocus
  - CORRECT (score 30-49 OR ${thresholds.warn}+ consecutive issues): Clear redirection required
  - REFOCUS (score <30 OR ${thresholds.intervene}+ consecutive issues): Hard intervention needed

Respond in EXACTLY this format:

RELEVANT: [YES/NO] - [one sentence why]
PRODUCTIVE: [YES/NO] - [one sentence why]
PROGRESSING: [YES/NO] - [one sentence why]
SCORE: [0-100]
ACTION: [CONTINUE/REMIND/CORRECT/REFOCUS]
REASON: [one sentence summary]`;
}

/**
 * Check if fast assessment can be used
 * @param {string} response - Worker response
 * @param {Array} assessmentHistory - Assessment history
 * @param {number} consecutiveIssues - Consecutive issues count
 * @returns {boolean} Whether fast assessment is applicable
 */
export function canUseFastAssessment(response, assessmentHistory, consecutiveIssues) {
  if (assessmentHistory.length < 2) return false;

  const lastAssessment = assessmentHistory[assessmentHistory.length - 1]?.assessment;
  if (!lastAssessment || lastAssessment.action !== 'CONTINUE' || lastAssessment.score < 75) {
    return false;
  }

  if (consecutiveIssues > 0) return false;

  const hasProgressIndicator = PROGRESS_INDICATORS.some(pattern => pattern.test(response));
  if (!hasProgressIndicator) return false;

  return !BLOCKER_INDICATORS.some(pattern => pattern.test(response));
}

/**
 * Check if ultra-fast assessment can be used
 * @param {string} response - Worker response
 * @param {number} consecutiveIssues - Consecutive issues count
 * @returns {boolean} Whether ultra-fast assessment is applicable
 */
export function canUseUltraFastAssessment(response, consecutiveIssues) {
  if (consecutiveIssues > 0) return false;

  const hasToolUsage = TOOL_USAGE_INDICATORS.some(pattern => pattern.test(response));
  if (!hasToolUsage) return false;

  if (ERROR_INDICATORS.some(pattern => pattern.test(response))) return false;
  if (response.length < 50) return false;

  return true;
}
